import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { cacheInvalidate, cacheResponse } from "../lib/cache-middleware.js";
import {
  TreatmentCategoryInsertSchema,
  TreatmentCategoryUpdateSchema,
} from "../../utils/schemas/TreatmentCategorySchema.js";
import { formatZodError } from "../../utils/helpers.js";

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
  "/active",
  cacheResponse({ key: "treatmentCategories:active", ttlSeconds: 300 }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);
    const { data, error } = await supabase
      .from("TreatmentCategory")
      .select(`*`)
      .eq("showOnWeb", true);
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

  const parsed = await TreatmentCategoryInsertSchema.safeParseAsync(body);
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }

  const { data, error } = await supabase
    .from("TreatmentCategory")
    .insert(parsed.data)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);

  void cacheInvalidate("treatmentCategories:*").catch(() => {});
  return c.json({ treatmentCategory: data }, 201);
});

treatmentCategories.patch("/:id{[0-9]+}", async (c) => {
  if (!supabase) return c.json({ error: "Supabase not configured" }, 500);
  const body = await c.req.json();

  const parsed = await TreatmentCategoryUpdateSchema.safeParseAsync(body);
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }

  const { data, error } = await supabase
    .from("TreatmentCategory")
    .update(parsed.data)
    .eq("id", Number(c.req.param("id")))
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);

  void cacheInvalidate("treatmentCategories:*").catch(() => {});
  return c.json({
    message: "Treatment category updated",
    treatmentCategory: data,
  });
});

treatmentCategories.post("/createCatsForEposCats", async (c) => {
  if (!supabase) return c.json({ error: "Supabase not configured" }, 500);
  const { data: eposCategories, error: eposError } = await supabase
    .from("EposNowCategory")
    .select("*");

  if (eposError) {
    return c.json({ error: eposError.message }, 500);
  }

  if (!eposCategories || eposCategories.length === 0) {
    return c.json({ message: "No Epos Now categories found." });
  }

  const createdCategories = [];
  for (const eposCat of eposCategories) {
    const { data: existingCat } = await supabase
      .from("TreatmentCategory")
      .select("*")
      .eq("eposNowCategoryId", eposCat.CategoryIdEpos)
      .single();

    if (existingCat) {
      continue; // Skip if already exists
    }

    const { data: newCat, error: insertError } = await supabase
      .from("TreatmentCategory")
      .insert({
        name: eposCat.Name,
        description: eposCat.Description,
        eposNowCategoryId: eposCat.CategoryIdEpos,
        imageUrl: eposCat.ImageUrl,
      })
      .select()
      .single();

    if (insertError) {
      return c.json({ error: insertError.message }, 500);
    }

    createdCategories.push(newCat);
  }

  void cacheInvalidate("treatmentCategories:*").catch(() => {});
  return c.json({
    message: "Epos Now categories processed.",
    createdCount: createdCategories.length,
    createdCategories,
  });
});

export default treatmentCategories;
