import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { cacheResponse, cacheInvalidate, buildCacheKey, } from "../lib/cache-middleware.js";
import { rateLimit } from "../lib/rate-limit-middleware.js";
import { parsePagination } from "../../utils/helpers.js";
const googleReviews = new Hono();
config({ path: ".env" });
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const placeId = process.env.DIVA_SALON_GOOGLE_PLACE_ID;
googleReviews.get("/", cacheResponse({
    key: (c) => {
        const page = Number(c.req.query("page") || 1);
        const per = Number(c.req.query("perPage") || c.req.query("per") || 20);
        const min = c.req.query("minRating") || c.req.query("min") || "";
        const from = c.req.query("dateFrom") || c.req.query("from") || "";
        const to = c.req.query("dateTo") || c.req.query("to") || "";
        return buildCacheKey("googleReviews", {
            page,
            per,
            min,
            from,
            to,
        });
    },
    ttlSeconds: 300,
}), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const { page, perPage, start, end } = parsePagination(c);
    // parse optional minRating filter (1..5)
    const minRaw = c.req.query("minRating") || c.req.query("min");
    const minRating = typeof minRaw === "string" && minRaw.trim() !== ""
        ? Math.min(5, Math.max(1, Number(minRaw)))
        : undefined;
    // parse optional date range (accept ISO or yyyy-mm-dd). Use UTC ISO strings for query.
    const dateFromRaw = (c.req.query("dateFrom") ||
        c.req.query("from") ||
        "").trim();
    const dateToRaw = (c.req.query("dateTo") || c.req.query("to") || "").trim();
    let dateFromIso;
    let dateToIso;
    if (dateFromRaw) {
        const parsed = Date.parse(dateFromRaw);
        if (Number.isNaN(parsed)) {
            return c.json({ error: "Invalid dateFrom", value: dateFromRaw }, 400);
        }
        dateFromIso = new Date(parsed).toISOString();
    }
    if (dateToRaw) {
        const parsed = Date.parse(dateToRaw);
        if (Number.isNaN(parsed)) {
            return c.json({ error: "Invalid dateTo", value: dateToRaw }, 400);
        }
        // If user supplies a date without time (e.g., 2025-11-29) they likely expect inclusive end of day.
        // To be conservative we keep provided timestamp as-is. If you want end-of-day, adjust here.
        dateToIso = new Date(parsed).toISOString();
    }
    let query = supabase.from("GooglePlaceReview").select(`
          *,
          GoogleReviewText( text, languageCode ),
          GoogleAuthorAttribution ( uri, photoUri, displayName )
        `, { count: "exact" });
    if (minRating !== undefined && !Number.isNaN(minRating)) {
        query = query.gte("rating", minRating);
    }
    if (dateFromIso) {
        query = query.gte("publishTime", dateFromIso);
    }
    if (dateToIso) {
        query = query.lte("publishTime", dateToIso);
    }
    const { data, error, count } = await query
        .order("publishTime", { ascending: false })
        .range(start, end);
    if (error)
        return c.json({ error: error.message }, 500);
    const normalized = Array.isArray(data)
        ? data.map((row) => ({
            ...row,
            GoogleReviewText: Array.isArray(row.GoogleReviewText)
                ? row.GoogleReviewText[0] ?? null
                : row.GoogleReviewText ?? null,
            GoogleAuthorAttribution: Array.isArray(row.GoogleAuthorAttribution)
                ? row.GoogleAuthorAttribution[0] ?? null
                : row.GoogleAuthorAttribution ?? null,
        }))
        : [];
    const total = typeof count === "number" ? count : normalized.length;
    const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;
    return c.json({
        googleReviews: normalized,
        meta: {
            total,
            page,
            perPage,
            totalPages,
            minRating: minRating ?? null,
            dateFrom: dateFromIso ?? null,
            dateTo: dateToIso ?? null,
        },
    });
});
// Fetch from Google, upsert children, then upsert parent with FKs
googleReviews.post("/fetchReviewsFromGoogle", rateLimit({
    limit: 3,
    windowSec: 12 * 60 * 60, // 12 hours
    prefix: "rl:google",
    key: () => "global", // global cap for this endpoint; switch to client IP if needed
}), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    if (!GOOGLE_PLACES_API_KEY || !placeId) {
        return c.json({
            error: "Missing GOOGLE_PLACES_API_KEY or DIVA_SALON_GOOGLE_PLACE_ID",
        }, 500);
    }
    const url = `https://places.googleapis.com/v1/places/${placeId}?fields=id,displayName,reviews&key=${GOOGLE_PLACES_API_KEY}`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return c.json({
                error: errorData?.message || `Google Places error ${response.status}`,
            }, 502);
        }
        const result = await response.json();
        const reviews = Array.isArray(result?.reviews)
            ? result.reviews
            : [];
        if (reviews.length === 0) {
            return c.json({ message: "No reviews returned from Google", count: 0 });
        }
        // Process each review with per-item error handling
        const results = await Promise.all(reviews.map(async (review) => {
            try {
                const text = review.text;
                const authorAttribution = review.authorAttribution;
                const { count, error: existsError } = await supabase
                    .from("GooglePlaceReview")
                    .select("name", { count: "exact", head: true })
                    .eq("name", review.name);
                if (existsError) {
                    throw new Error(`Failed to check existing review: ${existsError.message}`);
                }
                if (count && count > 0) {
                    return { status: "skipped", name: review.name };
                }
                const { data: reviewId, error: reviewError } = await supabase
                    .from("GooglePlaceReview")
                    .upsert({
                    name: review.name,
                    rating: review.rating,
                    publishTime: review.publishTime,
                    flagContentUri: review.flagContentUri,
                    googleMapsUri: review.googleMapsUri,
                })
                    .select("id")
                    .single();
                if (!reviewId || reviewError) {
                    throw new Error(`Failed to upsert review: ${reviewError?.message || "unknown"}`);
                }
                if (text?.text || text?.languageCode) {
                    const { error: reviewTextError } = await supabase
                        .from("GoogleReviewText")
                        .upsert({
                        text: text?.text,
                        languageCode: text?.languageCode,
                        GooglePlaceReviewId: reviewId.id,
                    })
                        .select("id")
                        .single();
                    if (reviewTextError) {
                        throw new Error(`Failed to upsert review text: ${reviewTextError.message}`);
                    }
                }
                if (authorAttribution?.displayName ||
                    authorAttribution?.uri ||
                    authorAttribution?.photoUri) {
                    const { error: authorAttributionError } = await supabase
                        .from("GoogleAuthorAttribution")
                        .upsert({
                        displayName: authorAttribution?.displayName,
                        uri: authorAttribution?.uri,
                        photoUri: authorAttribution?.photoUri,
                        GooglePlaceReviewId: reviewId.id,
                    })
                        .select("id")
                        .single();
                    if (authorAttributionError) {
                        throw new Error(`Failed to upsert author attribution: ${authorAttributionError.message}`);
                    }
                }
                return { status: "ok", name: review.name };
            }
            catch (err) {
                console.error("Review processing error:", review?.name, err);
                return {
                    status: "error",
                    name: review?.name,
                    error: err?.message || String(err),
                };
            }
        }));
        // Invalidate caches
        void cacheInvalidate("googleReviews:*").catch(() => { });
        const inserted = results.filter((r) => r.status === "ok").length;
        const skipped = results.filter((r) => r.status === "skipped").length;
        const failed = results.filter((r) => r.status === "error");
        return c.json({
            message: "Reviews processed",
            total: reviews.length,
            inserted,
            skipped,
            failed: failed.length,
            errors: failed.slice(0, 10), // limit payload size
        });
    }
    catch (e) {
        return c.json({ error: e?.message || "Failed to fetch or store reviews" }, 500);
    }
});
export default googleReviews;
