import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import {
  buildCacheKey,
  cacheInvalidate,
  cacheResponse,
} from "../lib/cache-middleware.js";
import { TreatmentSubCategoryInsertSchema } from "../../utils/schemas/TreatmentSubCategorySchema.js";
import { formatZodError, parsePagination } from "../../utils/helpers.js";

const treatmentSubCategories = new Hono();
config({ path: ".env" });

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// GET / -> paginated + cached
treatmentSubCategories.get(
  "/",
  cacheResponse({
    key: (c) => {
      const page = Number(c.req.query("page") || 1);
      const per = Number(c.req.query("perPage") || c.req.query("per") || 20);
      const organisation_id = c.get("organisation_id");
      return buildCacheKey("treatmentSubCategories", {
        page,
        per,
        organisation_id,
      });
    },
    ttlSeconds: 300,
  }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

    const { page, perPage, start, end } = parsePagination(c);

    //@ts-ignore
    const organisation_id = c.get("organisation_id");
    const { data, error, count } = await supabase
      .from("TreatmentSubCategory")
      .select("*", { count: "exact" })
      .eq("organisation_id", organisation_id)
      .range(start, end);

    if (error) return c.json({ error: error.message }, 500);

    const items = Array.isArray(data) ? data : [];
    const total = typeof count === "number" ? count : items.length;
    const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;

    return c.json({
      treatmentSubCategories: items,
      meta: {
        total,
        page,
        perPage,
        totalPages,
      },
    });
  },
);

treatmentSubCategories.get(
  "/:id{[0-9]+}",
  cacheResponse({
    key: (c) =>
      buildCacheKey("treatmentSubCategories", {
        route: "byId",
        id: c.req.param("id"),
        organisation_id: c.get("organisation_id"),
      }),
    ttlSeconds: 300,
  }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);
    //@ts-ignore
    const organisation_id = c.get("organisation_id");

    const id = Number(c.req.param("id"));
    const { data, error } = await supabase
      .from("TreatmentSubCategory")
      .select("*")
      .eq("id", id)
      .eq("organisation_id", organisation_id)
      .single();
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ treatmentSubCategory: data });
  },
);

// POST / -> validate body and format errors
treatmentSubCategories.post("/", async (c) => {
  if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

  const body = await c.req.json();
  //@ts-ignore
  const organisation_id = c.get("organisation_id");
  const parsed = await TreatmentSubCategoryInsertSchema.safeParseAsync(body);
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }

  const { data, error } = await supabase
    .from("TreatmentSubCategory")
    .insert({ ...parsed.data, organisation_id })
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);

  void cacheInvalidate("treatmentSubCategories:*").catch(() => {});
  return c.json({ treatmentSubCategory: data }, 201);
});

treatmentSubCategories.patch("/:id{[0-9]+}", async (c) => {
  if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

  //@ts-ignore
  const organisation_id = c.get("organisation_id");
  const id = Number(c.req.param("id"));
  if (isNaN(id)) {
    return c.json({ error: "Invalid ID" }, 400);
  }
  const body = await c.req.json();

  // Validate partial update
  const parsed =
    await TreatmentSubCategoryInsertSchema.partial().safeParseAsync(body);
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }

  const { data, error } = await supabase
    .from("TreatmentSubCategory")
    .update({ ...parsed.data, organisation_id })
    .eq("id", id)
    .select()
    .single();

  if (error) return c.json({ error: error.message }, 500);

  void cacheInvalidate("treatmentSubCategories:*").catch(() => {});
  return c.json({
    message: "Treatment subcategory updated",
    treatmentSubCategory: data,
  });
});

export default treatmentSubCategories;
