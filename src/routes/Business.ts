import { createClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { config } from "dotenv";
import { buildCacheKey, cacheResponse } from "../lib/cache-middleware.js";
import { parsePagination } from "../../utils/helpers.js";

const business = new Hono();

config({ path: ".env" });

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

business.get(
  "/",
  cacheResponse({
    key: (c) => {
      const page = Number(c.req.query("page") || 1);
      const per = Number(c.req.query("perPage") || c.req.query("per") || 20);
      const organisationId = c.get("organisation_id");

      return buildCacheKey("businesses", {
        page,
        per,
        organisationId,
      });
    },
    ttlSeconds: 300,
  }),
  async (c) => {
    if (!supabase) return c.text("Supabase not configured", 500);

    const { page, perPage, start, end } = parsePagination(c);
    //@ts-ignore
    // const organisation_id = c.get("organisation_id");
    const { data, count, error } = await supabase
      .from("Business")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })

      .range(start, end);

    if (error) {
      console.error("Error fetching business data:", error);
      return c.json({ error: "Failed to fetch business data" }, 500);
    }
    const rows = Array.isArray(data) ? data : [];
    const total = typeof count === "number" ? count : rows.length;
    const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;

    return c.json({
      business: rows,
      meta: { total, page, perPage, totalPages },
    });
  },
);

business.get("/openingHours", async (c) => {
  if (!supabase) return c.text("Supabase not configured", 500);
  //@ts-ignore
  const organisation_id = c.get("organisation_id");

  const { data, error } = await supabase
    .from("OpeningHours")
    .select("id, Day, opens_at, closes_at, is_closed, created_at, updated_at")
    .eq("organisation_id", organisation_id);

  if (error) {
    console.error("Error fetching opening hours:", error);
    return c.json({ error: "Failed to fetch opening hours" }, 500);
  }

  return c.json({ openingHours: data });
});

business.post("/openingHours", async (c) => {
  if (!supabase) return c.text("Supabase not configured", 500);
  //@ts-ignore
  const organisation_id = c.get("organisation_id");
  const body = await c.req.json();

  const { data, error } = await supabase
    .from("OpeningHours")
    .insert({
      organisation_id: organisation_id,
      Day: body.Day,
      opens_at: body.opens_at,
      closes_at: body.closes_at,
      isClosed: body.isClosed,
    })
    .select()
    .single();

  if (error) {
    console.error("Error updating opening hours:", error);
    return c.json({ error: "Failed to update opening hours" }, 500);
  }

  return c.json({ openingHours: data });
});
business.patch("/openingHours", async (c) => {
  if (!supabase) return c.text("Supabase not configured", 500);
  //@ts-ignore
  const organisation_id = c.get("organisation_id");
  const body = await c.req.json();
  const openingHours = body?.openingHours;

  if (!Array.isArray(openingHours) || openingHours.length === 0) {
    return c.json({ error: "openingHours array is required" }, 400);
  }

  const rows = openingHours.map((row: any) => ({
    organisation_id,
    Day: row.Day,
    opens_at: row.opens_at,
    closes_at: row.closes_at,
    is_closed:
      typeof row.is_closed === "boolean"
        ? row.is_closed
        : Boolean(row.isClosed),
    updated_at: new Date().toISOString(),
  }));

  const { data, error } = await supabase
    .from("OpeningHours")
    .update(rows)
    .select()
    .eq("organisation_id", organisation_id)
    .eq("Day", rows[0].Day)
    .order("Day");

  if (error) {
    console.error("Error updating opening hours:", error);
    return c.json({ error: "Failed to update opening hours" }, 500);
  }

  return c.json({ openingHours: data });
});

export default business;
