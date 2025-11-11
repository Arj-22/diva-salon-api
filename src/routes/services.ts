import { createClient } from "@supabase/supabase-js";
import { Hono } from "hono";

const services = new Hono();

services.get("/", async (c) => {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data, error } = await supabase.from("eposNowTreatments").select("*");

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ treatments: data });
});

export default services;
