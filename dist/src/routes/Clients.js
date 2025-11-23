import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { cacheResponse } from "../lib/cache-middleware.js";
const clients = new Hono();
config({ path: ".env" });
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;
clients.get("/", cacheResponse({ key: "clients:all", ttlSeconds: 300 }), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const { data, error } = await supabase.from("Client").select(`*`);
    if (error)
        return c.json({ error: error.message }, 500);
    return c.json({ clients: data });
});
export default clients;
