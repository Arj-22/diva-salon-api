import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { cacheInvalidate, cacheResponse } from "../lib/cache-middleware.js";
import { TreatmentInsertSchema } from "../../utils/schemas/TreatmentSchema.js";
import { formatZodError } from "../../utils/helpers.js";

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
  "/active",
  cacheResponse({ key: "treatments:active", ttlSeconds: 300 }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);
    const { data, error } = await supabase
      .from("Treatment")
      .select(
        `* ,EposNowTreatment(Name, SalePriceExTax, SalePriceIncTax),  TreatmentCategory (name, description) ,TreatmentSubCategory (name, description)`
      )
      .eq("showOnWeb", true);
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ treatments: data });
  }
);

treatments.get(
  "/groupedByCategory",
  cacheResponse({ key: "treatments:groupedByCategory", ttlSeconds: 300 }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

    const { data, error } = await supabase.from("Treatment").select(`
        *,
        EposNowTreatment(Name, SalePriceExTax, SalePriceIncTax),
        TreatmentCategory(id, name, description, href),
        TreatmentSubCategory(name, description)
      `);

    if (error) return c.json({ error: error.message }, 500);

    const rows = Array.isArray(data) ? data : [];
    // Group by category (uncategorized bucket if missing)
    const groups = new Map<string | number, any>();

    for (const row of rows) {
      const cat = (row as any).TreatmentCategory || null;
      const key = cat?.id ?? "uncategorized";

      if (!groups.has(key)) {
        groups.set(key, {
          id: cat?.id ?? null,
          name: cat?.name ?? "Uncategorized",
          href: cat?.href ?? null,
          description: cat?.description ?? null,
          treatments: [] as any[],
        });
      }

      // Avoid duplicating the category object inside each treatment
      const { TreatmentCategory, ...treatment } = row as any;
      groups.get(key).treatments.push(treatment);
    }

    // Sort categories by name (Uncategorized last)
    const categories = Array.from(groups.values()).sort((a, b) => {
      if (a.id === null) return 1;
      if (b.id === null) return -1;
      return String(a.name).localeCompare(String(b.name));
    });

    return c.json(categories);
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
      .eq("treatmentCategoryId", treatmentCategoryId);
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
  const parsed = await TreatmentInsertSchema.safeParseAsync(body);
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }

  const { data, error } = await supabase
    .from("Treatment")
    .insert(parsed.data)
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);

  void cacheInvalidate("treatments:*").catch(() => {});
  return c.json({ treatment: data }, 201);
});

treatments.post("/createForEposTreatments", async (c) => {
  if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

  const { data: eposTreatments, error: eposError } = await supabase
    .from("EposNowTreatment")
    .select("*");

  if (eposError) {
    return c.json({ error: eposError.message }, 500);
  }

  let createdCount = 0;

  // Fetch all existing eposNowTreatmentId values once
  const { data: existingTreatments, error: existingError } = await supabase
    .from("Treatment")
    .select("eposNowTreatmentId");

  if (existingError) {
    return c.json({ error: existingError.message }, 500);
  }

  const existingIds = new Set(
    (existingTreatments ?? []).map(t => t.eposNowTreatmentId)
  );

  for (const eposTreatment of eposTreatments) {
    // Use EposNowId for comparison, as used in insert
    if (existingIds.has(eposTreatment.EposNowId)) {
      continue;
    }

    const { data: newTreatment, error: insertError } = await supabase
      .from("Treatment")
      .insert({
        description: eposTreatment.Description,
        eposNowTreatmentId: eposTreatment.EposNowId,
        imageUrl: eposTreatment.ImageUrl ?? null,
      })
      .select()
      .single();

    if (insertError) {
      console.error(
        `Failed to create treatment for EposNowTreatment ID ${eposTreatment.Id}: ${insertError.message}`
      );
      continue;
    }

    createdCount++;
  }

  void cacheInvalidate("treatments:*").catch(() => {});
  return c.json({
    message: `Created ${createdCount} treatments for Epos Now treatments.`,
  });
});

treatments.patch("/:id{[0-9]+}", async (c) => {
  if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

  const idParam = c.req.param("id");
  const treatmentId = Number(idParam);
  if (isNaN(treatmentId)) {
    return c.json({ error: "Invalid ID" }, 400);
  }
  const body = await c.req.json();

  // Partial for updates
  const parsed = await TreatmentInsertSchema.partial().safeParseAsync(body);
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }

  const { data, error } = await supabase
    .from("Treatment")
    .update(parsed.data)
    .eq("id", treatmentId)
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);

  void cacheInvalidate("treatments:*").catch(() => {});
  return c.json({
    message: "Treatment updated successfully",
    treatment: data,
  });
});

export default treatments;
