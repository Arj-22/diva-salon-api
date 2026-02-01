import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { buildCacheKey, cacheResponse } from "../lib/cache-middleware.js";
import { parsePagination } from "../../utils/helpers.js";

const staff = new Hono();

config({ path: ".env" });

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// Clerk webhook endpoint
staff.get(
  "/",
  cacheResponse({
    key: (c) => {
      const page = Number(c.req.query("page") || 1);
      const per = Number(c.req.query("perPage") || c.req.query("per") || 20);
      const organisation_id = c.get("organisation_id");

      return buildCacheKey("staff", {
        page,
        per,
        organisation_id,
      });
    },
    ttlSeconds: 300,
  }),
  async (c) => {
    if (!supabase) return c.text("Supabase not configured", 500);
    //@ts-ignore
    const organisation_id = c.get("organisation_id");
    const { page, perPage, start, end } = parsePagination(c);
    try {
      const { data, error, count } = await supabase
        .from("Staff")
        .select("*", { count: "exact" })
        .eq("organisation_id", organisation_id)
        .range(start, end);

      if (error) {
        console.error("Error fetching staff data:", error);
        return c.json({ error: "Failed to fetch staff data" }, 500);
      }

      const items = Array.isArray(data) ? data : [];
      const total = typeof count === "number" ? count : items.length;
      const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;
      return c.json(
        {
          staff: data,
          meta: {
            total,
            page,
            perPage,
            totalPages,
          },
        },
        200,
      );
    } catch (err) {
      console.error("Staff route error:", err);
      return c.json({ error: "Failed to fetch staff data" }, 500);
    }
  },
);

staff.get("/:id", async (c) => {
  if (!supabase) return c.text("Supabase not configured", 500);
  const id = c.req.param("id");
  //@ts-ignore
  const organisation_id = c.get("organisation_id");

  try {
    const { data: staffMember, error } = await supabase
      .from("Staff")
      .select("*")
      .eq("id", id)
      .eq("organisation_id", organisation_id)
      .single();

    if (error) {
      console.error("Error fetching staff member:", error);
      return c.json({ error: "Failed to fetch staff member" }, 500);
    }

    return c.json({ staff: staffMember }, 200);
  } catch (err) {
    console.error("Staff member route error:", err);
    return c.json({ error: "Failed to fetch staff member" }, 500);
  }
});

export default staff;
