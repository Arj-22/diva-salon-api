import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { Hono } from "hono";

const services = new Hono();
config();
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "Supabase env vars missing. Set SUPABASE_URL and SUPABASE_ANON_KEY."
  );
}

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

services.get("/", async (c) => {
  if (!supabase) {
    return c.json(
      { error: "Server misconfigured: missing Supabase env vars" },
      500
    );
  }

  const { data, error } = await supabase.from("EposNowTreatment").select("*");
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ EposNowTreatments: data });
});

export default services;
