import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { buildCacheKey, cacheResponse } from "../lib/cache-middleware.js";
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
        return buildCacheKey("clients", {
            page,
            per,
        });
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
clients.get("/by-ids", cacheResponse({
    key: (c) => {
        const ids = c.req.query("ids") || "";
        return buildCacheKey("clients", { byIds: ids });
    },
    ttlSeconds: 300,
}), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const idsParam = c.req.query("ids");
    if (!idsParam) {
        return c.json({ error: "Missing 'ids' query parameter" }, 400);
    }
    const ids = idsParam
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
    if (ids.length === 0) {
        return c.json({ error: "No valid IDs provided" }, 400);
    }
    const { data, error } = await supabase
        .from("Client")
        .select("*")
        .in("id", ids);
    if (error)
        return c.json({ error: error.message }, 500);
    return c.json({ clients: data || [] });
});
clients.get("/:id", cacheResponse({
    key: (c) => {
        const id = c.req.param("id");
        return buildCacheKey("clients", { id });
    },
    ttlSeconds: 300,
}), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const id = c.req.param("id");
    const { data, error } = await supabase
        .from("Client")
        .select("*")
        .eq("id", id)
        .single();
    if (error)
        return c.json({ error: error.message }, 500);
    if (!data)
        return c.json({ error: "Client not found" }, 404);
    return c.json(data);
});
export default clients;
