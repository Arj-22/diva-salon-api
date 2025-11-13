import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { cacheInvalidate, cacheResponse } from "../lib/cache-middleware.js";

const treatmentCategories = new Hono();
config({ path: ".env" });

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// GET / -> cache full payload at a stable key
treatmentCategories.get(
  "/",
  cacheResponse({ key: "treatmentCategories:all", ttlSeconds: 300 }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);
    const { data, error } = await supabase
      .from("TreatmentCategory")
      .select(`*`);
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ treatmentCategories: data });
  }
);

treatmentCategories.get(
  "/:id{[0-9]+}",
  cacheResponse({
    key: (c) => `treatmentCategories:id:${c.req.param("id")}`,
    ttlSeconds: 300,
  }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

    const id = Number(c.req.param("id"));
    const { data, error } = await supabase
      .from("TreatmentCategory")
      .select("*")
      .eq("id", id)
      .single();
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ treatmentCategory: data });
  }
);

treatmentCategories.post("/", async (c) => {
  if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

  const body = await c.req.json();
  const { data, error } = await supabase
    .from("TreatmentCategory")
    .insert(body)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  void cacheInvalidate("treatmentCategories:*").catch(() => {});
  return c.json({ treatmentCategory: data });
});
export default treatmentCategories;
