import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { cacheResponse, cacheIdsViaAll } from "../lib/cache-middleware.js";
const eposNowTreatments = new Hono();
config({ path: ".env" });
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;
// GET / -> cache full payload at a stable key
eposNowTreatments.get("/", cacheResponse({ key: "eposNowTreatments:all", ttlSeconds: 300 }), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const { data, error } = await supabase.from("EposNowTreatment").select("*");
    if (error)
        return c.json({ error: error.message }, 500);
    return c.json({ eposNowTreatments: data });
});
// Place this before the :id route to avoid route conflicts
eposNowTreatments.get("/byCategory", cacheIdsViaAll({
    key: (c) => `eposNowTreatments:byCategory:${c.req.query("category")}`,
    allKey: "eposNowTreatments:all",
    ttlSeconds: 120,
    // On hit, build the same response shape as the handler
    responseFromResolved: (c, resolved) => ({
        category: c.req.query("category"),
        items: resolved,
    }),
    // On miss, extract IDs from the handler's response
    idsFromResponse: (data) => Array.isArray(data?.items) ? data.items.map((i) => i.id) : [],
    // Optional: specify where to read full items from the "all" payload
    allItemsSelector: (all) => all?.EposNowTreatments ?? [],
}), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const category = c.req.query("category");
    const limit = Number(c.req.query("limit") ?? 50);
    if (!category)
        return c.json({ error: "category is required" }, 400);
    const { data, error } = await supabase
        .from("EposNowTreatment")
        .select("*")
        .eq("CategoryId", category)
        .limit(limit);
    if (error)
        return c.json({ error: error.message }, 500);
    return c.json({ category, items: data });
});
// Numeric id route (after specific routes)
eposNowTreatments.get("/:id{[0-9]+}", cacheResponse({
    key: (c) => `eposNowTreatments:id:${c.req.param("id")}`,
    ttlSeconds: 300,
}), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id))
        return c.json({ error: "Invalid id" }, 400);
    const { data, error } = await supabase
        .from("EposNowTreatment")
        .select("*")
        .eq("id", id)
        .single();
    if (error)
        return c.json({ error: error.message }, 500);
    return c.json({ eposNowTreatments: data });
});
export default eposNowTreatments;
