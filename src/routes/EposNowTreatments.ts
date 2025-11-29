import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { cacheResponse, cacheIdsViaAll } from "../lib/cache-middleware.js";
import { parsePagination } from "../../utils/helpers.js";

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
  cacheResponse({
    key: (c) => {
      const page = Number(c.req.query("page") || 1);
      const per = Number(c.req.query("perPage") || c.req.query("per") || 20);
      return `eposNowTreatments:page:${page}:per:${per}`;
    },
    ttlSeconds: 300,
  }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

    const { page, perPage, start, end } = parsePagination(c);

    const { data, error, count } = await supabase
      .from("EposNowTreatment")
      .select("*", { count: "exact" })
      .range(start, end);

    if (error) return c.json({ error: error.message }, 500);

    const eposNowTreatments = Array.isArray(data) ? data : [];
    const total = typeof count === "number" ? count : eposNowTreatments.length;
    const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;

    return c.json({
      eposNowTreatments,
      meta: {
        total,
        page,
        perPage,
        totalPages,
      },
    });
  }
);

// Place this before the :id route to avoid route conflicts
eposNowTreatments.get(
  "/byCategory",
  cacheIdsViaAll({
    key: (c) => {
      const page = Number(c.req.query("page") || 1);
      const per = Number(c.req.query("perPage") || c.req.query("per") || 20);
      return `eposNowTreatments:byCategory:${c.req.query(
        "category"
      )}:page:${page}:per:${per}`;
    },
    allKey: "eposNowTreatments:all",
    ttlSeconds: 120,
    // On hit, build the same response shape as the handler
    responseFromResolved: (c, resolved) => ({
      category: c.req.query("categoryId"),
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
    if (!category) return c.json({ error: "category is required" }, 400);

    const { page, perPage, start, end } = parsePagination(c);

    const { data, error, count } = await supabase
      .from("EposNowTreatment")
      .select("*", { count: "exact" })
      .eq("EposCategoryId", category)
      .range(start, end);

    if (error) return c.json({ error: error.message }, 500);

    const items = Array.isArray(data) ? data : [];
    const total = typeof count === "number" ? count : items.length;
    const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;

    return c.json({
      category,
      items,
      meta: {
        total,
        page,
        perPage,
        totalPages,
      },
    });
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
  let products: any[] = [];
  try {
    products = JSON.parse(text);
  } catch (err) {
    return c.json(
      { error: "Failed to parse Epos Now response", details: String(err) },
      500
    );
  }

  // pagination params for external product list
  const { page, perPage, start, end } = parsePagination(c);
  const total = products.length;
  const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;
  const paged = products.slice(start, end + 1);

  return c.json({
    data: paged,
    meta: {
      total,
      page,
      perPage,
      totalPages,
    },
  });
});

eposNowTreatments.post("insertTreatmentsByEposCategory", async (c) => {
  if (!supabase) return c.json({ error: "Supabase not configured" }, 500);
  if (!EPOS_NOW_URL) {
    return c.json({ error: "EPOS_NOW_URL not configured" }, 500);
  }

  const body = await c.req.json();

  const eposCategoryId = body.eposCategoryId;
  if (typeof eposCategoryId !== "number") {
    return c.json({ error: "Invalid eposCategoryId" }, 400);
  }

  // fetch properly and check status
  const res = await fetch(EPOS_NOW_URL + "/Product", {
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
  const text = await res.text();
  const productsForCategory = JSON.parse(text).filter(
    (p: any) => p.CategoryId === eposCategoryId
  );

  if (!Array.isArray(productsForCategory) || productsForCategory.length === 0) {
    return c.json({ message: "No treatments to assign to category" });
  }

  if (!Array.isArray(productsForCategory) || productsForCategory.length === 0) {
    return c.json({ message: "No treatments to upsert" });
  }

  // Build payloads for upsert and use Name as the conflict target
  const payloads = productsForCategory.map((t: any) => ({
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

eposNowTreatments.post("/insertNewTreatments", async (c) => {
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

export default eposNowTreatments;
