import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { cacheResponse, cacheIdsViaAll } from "../lib/cache-middleware.js";
import { json } from "zod";
import type { EposNowTreatment } from "../lib/types.js";
import { flattenCategories } from "../../utils/helpers.js";

const eposNowTreatments = new Hono();
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

// GET / -> cache full payload at a stable key
eposNowTreatments.get(
  "/",
  cacheResponse({ key: "eposNowTreatments:all", ttlSeconds: 300 }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);
    const { data, error } = await supabase.from("EposNowTreatment").select("*");
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ eposNowTreatments: data });
  }
);

// Place this before the :id route to avoid route conflicts
eposNowTreatments.get(
  "/byCategory",
  cacheIdsViaAll({
    key: (c) => `eposNowTreatments:byCategory:${c.req.query("category")}`,
    allKey: "eposNowTreatments:all",
    ttlSeconds: 120,
    // On hit, build the same response shape as the handler
    responseFromResolved: (c, resolved) => ({
      category: c.req.query("category"),
      items: resolved,
    }),
    // On miss, extract IDs from the handler's response
    idsFromResponse: (data) =>
      Array.isArray(data?.items) ? data.items.map((i: any) => i.id) : [],
    // Optional: specify where to read full items from the "all" payload
    allItemsSelector: (all: any) => all?.EposNowTreatments ?? [],
  }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

    const category = c.req.query("category");
    const limit = Number(c.req.query("limit") ?? 50);
    if (!category) return c.json({ error: "category is required" }, 400);

    const { data, error } = await supabase
      .from("EposNowTreatment")
      .select("*")
      .eq("CategoryId", category)
      .limit(limit);

    if (error) return c.json({ error: error.message }, 500);
    return c.json({ category, items: data });
  }
);

// Numeric id route (after specific routes)
eposNowTreatments.get(
  "/:id{[0-9]+}",
  cacheResponse({
    key: (c) => `eposNowTreatments:id:${c.req.param("id")}`,
    ttlSeconds: 300,
  }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid id" }, 400);

    const { data, error } = await supabase
      .from("EposNowTreatment")
      .select("*")
      .eq("id", id)
      .single();

    if (error) return c.json({ error: error.message }, 500);
    return c.json({ eposNowTreatments: data });
  }
);

eposNowTreatments.get("/getEposProducts", async (c) => {
  // fetch properly and check status
  const res = await fetch(EPOS_NOW_URL + "/Product", {
    method: "GET",
    headers: {
      Authorization: `Basic WVBSUTdONFZFMEpZWVZTVkk1OUNGTUZYRzBYRDgxVk06QjVHSlE4UjdJWlFUT1IwSUNPNkw2UVU4UkVVRVVET1c=`,
      "Content-type": "application/xml",
    },
  });

  console.log(res);

  if (!res || !res.ok) {
    const text = res ? await res.text().catch(() => "") : "";
    return c.json(
      { error: "Failed to fetch treatments from Epos Now", details: text },
      500
    );
  }

  const text = await res.text();
  return c.json({ data: text });
});

eposNowTreatments.post("/upsertEposTreatments", async (c) => {
  // This is a placeholder for the actual implementation
  // You would typically call an external API to fetch treatments
  // and then upsert them into your Supabase database

  if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

  // fetch properly and check status
  const res = await fetch(EPOS_NOW_URL + "/Product", {
    method: "GET",
    headers: {
      Authorization: `Basic ${process.env.AUTHORIZATION_TOKEN}`,
      "Content-type": "application/xml",
    },
  });

  if (!res || !res.ok) {
    const text = res ? await res.text().catch(() => "") : "";
    return c.json(
      { error: "Failed to fetch treatments from Epos Now", details: text },
      500
    );
  }

  const text = await res.text();
  let treatments: any[] = [];
  try {
    treatments = JSON.parse(text);
  } catch (err) {
    return c.json(
      { error: "Failed to parse Epos Now response", details: String(err) },
      500
    );
  }

  if (!Array.isArray(treatments) || treatments.length === 0) {
    return c.json({ message: "No treatments to upsert" });
  }

  // Build payloads for upsert and use Name as the conflict target
  const payloads = treatments.map((t: any) => ({
    EposNowId: t.Id,
    Name: t.Name,
    Description: t.Description ?? null,
    SalePriceIncTax: t.IsSalePriceIncTax ? t.SalePrice : null,
    SalePriceExTax: !t.IsSalePriceIncTax ? t.SalePrice : null,
    EposCategoryId: t.CategoryId ?? null,
    updated_at: new Date().toISOString(),
  }));

  // Upsert in a single call using Name to determine conflicts
  const { data: upserted, error: upsertError } = await supabase
    .from("EposNowTreatment")
    .upsert(payloads)
    .select();

  if (upsertError) {
    return c.json(
      { error: "Failed to upsert treatments", details: upsertError.message },
      500
    );
  }

  return c.json({
    message: "Epos Now treatments upserted successfully.",
    upsertedCount: Array.isArray(upserted) ? upserted.length : 0,
  });
});

eposNowTreatments.post("/upsertCategories", async (c) => {
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

  const categories = JSON.parse(await res.text());

  if (!Array.isArray(categories) || categories.length === 0) {
    return c.json({ message: "No categories to upsert" });
  }

  const flattened = flattenCategories(categories);

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

  // Upsert in a single call using EposNowId to determine conflicts
  const { data: upserted, error: upsertError } = await supabase
    .from("EposNowCategory")
    .upsert(payloads)
    .select();

  if (upsertError) {
    return c.json(
      { error: "Failed to upsert categories", details: upsertError.message },
      500
    );
  }
  return c.json({ message: "Categories upserted successfully." });
});

export default eposNowTreatments;
