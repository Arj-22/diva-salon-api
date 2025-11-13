import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { cacheResponse, cacheInvalidate } from "../lib/cache-middleware.js";

const googleReviews = new Hono();
config({ path: ".env" });

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const placeId = process.env.DIVA_SALON_GOOGLE_PLACE_ID;

googleReviews.get(
  "/",
  cacheResponse({ key: "googleReviews:all", ttlSeconds: 300 }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);
    const { data, error } = await supabase
      .from("GooglePlaceReview")
      .select(
        `
          *,
          GoogleReviewText( text, languageCode ),
          GoogleAuthorAttribution ( uri, photoUri, displayName )
        `
      )
      .order("publishTime", { ascending: false });
    if (error) return c.json({ error: error.message }, 500);

    const normalized = Array.isArray(data)
      ? data.map((row: any) => ({
          ...row,
          GoogleReviewText: Array.isArray(row.GoogleReviewText)
            ? row.GoogleReviewText[0] ?? null
            : row.GoogleReviewText ?? null,
          GoogleAuthorAttribution: Array.isArray(row.GoogleAuthorAttribution)
            ? row.GoogleAuthorAttribution[0] ?? null
            : row.GoogleAuthorAttribution ?? null,
        }))
      : data;
    return c.json({ googleReviews: normalized });
  }
);

// Fetch from Google, upsert children, then upsert parent with FKs
googleReviews.post("/fetchReviewsFromGoogle", async (c) => {
  if (!supabase) return c.json({ error: "Supabase not configured" }, 500);
  if (!GOOGLE_PLACES_API_KEY || !placeId) {
    return c.json(
      { error: "Missing GOOGLE_PLACES_API_KEY or DIVA_SALON_GOOGLE_PLACE_ID" },
      500
    );
  }

  const url = `https://places.googleapis.com/v1/places/${placeId}?fields=id,displayName,reviews&key=${GOOGLE_PLACES_API_KEY}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return c.json(
        {
          error: errorData?.message || `Google Places error ${response.status}`,
        },
        502
      );
    }

    const result = await response.json();
    const reviews: any[] = Array.isArray(result?.reviews) ? result.reviews : [];
    if (reviews.length === 0) {
      return c.json({ message: "No reviews returned from Google", count: 0 });
    }

    reviews.map(async (review) => {
      const text = review.text;
      const authorAttribution = review.authorAttribution;
      const { count, error: textCountError } = await supabase
        .from("GooglePlaceReview")
        .select("name", { count: "exact", head: true })
        .eq("name", review.name);
      if (textCountError) {
        console.error("Failed to count existing reviews:", textCountError);
        return;
      }
      if (count && count > 0) {
        // Review already exists, skip
        console.log("Review already exists, skipping:", review.name);
        return;
      }
      const { data: reviewId, error: reviewError } = await supabase
        .from("GooglePlaceReview")
        .upsert({
          name: review.name,
          // relativePublishTimeDescription: review.relativePublishTimeDescription,
          rating: review.rating,
          publishTime: review.publishTime,
          flagContentUri: review.flagContentUri,
          googleMapsUri: review.googleMapsUri,
        })
        .select("id")
        .single();

      if (!reviewId || reviewError) {
        console.error("Failed to upsert review:", reviewError);
        return;
      }
      const { data: ReviewTextId, error: reviewTextError } = await supabase
        .from("GoogleReviewText")
        .upsert({
          text: text.text,
          languageCode: text.languageCode,
          GooglePlaceReviewId: reviewId.id,
        })
        .select("id")
        .single();

      if (!ReviewTextId || reviewTextError) {
        console.error("Failed to upsert review text:", reviewTextError);
        return;
      }

      const { data: authorAttributionId, error: authorAttributionError } =
        await supabase
          .from("GoogleAuthorAttribution")
          .upsert({
            displayName: authorAttribution?.displayName,
            uri: authorAttribution?.uri,
            photoUri: authorAttribution?.photoUri,
            GooglePlaceReviewId: reviewId.id,
          })
          .select("id")
          .single();

      if (!authorAttributionId || authorAttributionError) {
        console.error(
          "Failed to upsert Author Attribution:",
          authorAttributionError
        );
        return;
      }
    });

    // Invalidate caches
    void cacheInvalidate("googleReviews:*").catch(() => {});

    return c.json({
      message: "Reviews fetched and stored",
    });
  } catch (e: any) {
    return c.json(
      { error: e?.message || "Failed to fetch or store reviews" },
      500
    );
  }
});

export default googleReviews;
