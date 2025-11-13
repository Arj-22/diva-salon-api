import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { cacheInvalidate, cacheResponse } from "../lib/cache-middleware.js";

const treatments = new Hono();
config({ path: ".env" });

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

treatments.get(
  "/",
  cacheResponse({ key: "treatments:all", ttlSeconds: 300 }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);
    const { data, error } = await supabase
      .from("Treatment")
      .select(
        `* ,EposNowTreatment(Name, SalePriceExTax, SalePriceIncTax),  TreatmentCategory (name, description) ,TreatmentSubCategory (name, description)`
      );
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ treatments: data });
  }
);

treatments.get(
  "/byCategory/:treatmentCategoryId{[0-9]+}",
  cacheResponse({
    key: (c) => `treatments:id:${c.req.param("treatmentCategoryId")}`,
    ttlSeconds: 300,
  }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

    const treatmentCategoryId = Number(c.req.param("treatmentCategoryId"));
    const { data, error } = await supabase
      .from("Treatment")
      .select(
        `* ,EposNowTreatment(Name, SalePriceExTax, SalePriceIncTax),  TreatmentCategory (name, description) ,TreatmentSubCategory (name, description)`
      )
      .eq("TreatmentCategoryId", treatmentCategoryId);
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ treatments: data });
  }
);

treatments.get(
  "/byCategorySlug/:treatmentCategorySlug",
  cacheResponse({
    key: (c) =>
      `treatments:categorySlug:${c.req.param("treatmentCategorySlug")}`,
    ttlSeconds: 300,
  }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

    const treatmentCategorySlug = c.req.param("treatmentCategorySlug");
    const { data, error } = await supabase
      .from("Treatment")
      .select(
        `*,
       EposNowTreatment(Name, SalePriceExTax, SalePriceIncTax),
       TreatmentCategory!inner(id, name, description, href),
       TreatmentSubCategory(name, description)`
      )
      .eq("TreatmentCategory.href", treatmentCategorySlug);

    if (error) return c.json({ error: error.message }, 500);
    return c.json({ treatments: data });
  }
);

treatments.post("/", async (c) => {
  if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

  const body = await c.req.json();
  const { data, error } = await supabase
    .from("Treatment")
    .insert(body)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  void cacheInvalidate("treatments:*").catch(() => {});
  return c.json({ treatment: data });
});

export default treatments;
