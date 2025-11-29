import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { cacheResponse } from "../lib/cache-middleware.js";
import { parsePagination } from "../../utils/helpers.js";
const clients = new Hono();
config({ path: ".env" });
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;
clients.get("/", cacheResponse({
    key: (c) => {
        const page = Number(c.req.query("page") || 1);
        const per = Number(c.req.query("perPage") || c.req.query("per") || 20);
        return `clients:all:page:${page}:per:${per}`;
    },
    ttlSeconds: 300,
}), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const { page, perPage, start, end } = parsePagination(c);
    const { data, error, count } = await supabase
        .from("Client")
        .select("*", { count: "exact" })
        .range(start, end);
    if (error)
        return c.json({ error: error.message }, 500);
    const items = Array.isArray(data) ? data : [];
    const total = typeof count === "number" ? count : items.length;
    const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;
    return c.json({
        clients: items,
        meta: {
            total,
            page,
            perPage,
            totalPages,
        },
    });
});
export default clients;
