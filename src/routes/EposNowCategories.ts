import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { buildCacheKey, cacheResponse } from "../lib/cache-middleware.js";
import { flattenCategories, parsePagination } from "../../utils/helpers.js";

const eposNowCategories = new Hono();
config({ path: ".env" });

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const EPOS_NOW_URL = process.env.EPOS_NOW_URL;

eposNowCategories.get(
  "/",
  cacheResponse({
    key: (c) => {
      const page = Number(c.req.query("page") || 1);
      const per = Number(c.req.query("perPage") || c.req.query("per") || 20);
      return buildCacheKey("eposNowCategories", {
        page,
        per,
      });
    },
    ttlSeconds: 300,
  }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

    const { page, perPage, start, end } = parsePagination(c);
    const { data, error, count } = await supabase
      .from("EposNowCategory")
      .select("*", { count: "exact" })
      .range(start, end);

    if (error) return c.json({ error: error.message }, 500);

    const items = Array.isArray(data) ? data : [];
    const total = typeof count === "number" ? count : items.length;
    const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;

    return c.json({
      eposNowCategories: items,
      meta: {
        total,
        page,
        perPage,
        totalPages,
      },
    });
  }
);

eposNowCategories.post("/insertNewCategories", async (c) => {
  if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

  // fetch properly and check status
  const res = await fetch(EPOS_NOW_URL + "/Category", {
    method: "GET",
    headers: {
      Authorization: `Basic ${process.env.AUTHORIZATION_TOKEN}`,
      // "Content-type": "application/xml",
    },
  });

  if (!res || !res.ok) {
    const text = res ? await res.text().catch(() => "") : "";
    return c.json(
      { error: "Failed to fetch treatments from Epos Now", details: text },
      500
    );
  }

  const eposCategories = JSON.parse(await res.text());

  if (!Array.isArray(eposCategories) || eposCategories.length === 0) {
    return c.json({ message: "No categories to upsert" });
  }

  const flattened = flattenCategories(eposCategories);

  const payloads = flattened.map((cat) => ({
    CategoryIdEpos: cat.Id,
    Name: cat.Name,
    Description: cat.Description ?? null,
    ParentId: cat.ParentId ?? null,
    RootParentId: cat.RootParentId ?? null,
    ShowOnTill: cat.ShowOnTill,
    ImageUrl: cat.ImageUrl ?? null,
    updated_at: new Date().toISOString(),
  }));

  const { data: categoryIds, error: categoryIdError } = await supabase
    .from("EposNowCategory")
    .select("CategoryIdEpos");

  if (categoryIdError) {
    return c.json(
      {
        error: "Failed to fetch existing category IDs",
        details: categoryIdError.message,
      },
      500
    );
  }

  const categoryIdsList = categoryIds?.map((cat) => cat.CategoryIdEpos) || [];

  const categoriesToInsert = payloads.filter(
    (cat) => !categoryIdsList.includes(cat.CategoryIdEpos)
  );

  if (categoriesToInsert.length === 0) {
    return c.json({ message: "No new categories to insert." });
  }

  const { data: upserted, error: upsertError } = await supabase
    .from("EposNowCategory")
    .upsert(categoriesToInsert)
    .select();

  if (upsertError) {
    return c.json(
      { error: "Failed to upsert categories", details: upsertError.message },
      500
    );
  }
  return c.json({
    message: "Categories upserted successfully.",
    categoriesAdded: upserted,
  });
});
export default eposNowCategories;
