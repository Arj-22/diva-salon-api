import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import {
  buildCacheKey,
  cacheInvalidate,
  cacheResponse,
} from "../lib/cache-middleware.js";
import { formatZodError, parsePagination } from "../../utils/helpers.js";
import {
  ClientSchema,
  ClientUpdateSchema,
  type ClientInput,
} from "../../utils/schemas/ClientSchema.js";
import { validateClient } from "../lib/validation-middleware.js";

const clients = new Hono();
config({ path: ".env" });

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

clients.post("/", validateClient(), async (c) => {
  if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = ClientSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }

  const clientInput: ClientInput = parsed.data;

  const payload = {
    name: clientInput.name,
    email: clientInput.email ?? null,
    phoneNumber: clientInput.phoneNumber ?? null,
  };

  const { data, error } = await supabase
    .from("Client")
    .insert(payload)
    .select("id,name,email,phoneNumber")
    .single();

  if (error || !data) {
    const isConflict = error?.code === "23505";
    return c.json(
      {
        error: isConflict ? "Client already exists" : "Failed to create client",
        details: error?.message,
      },
      isConflict ? 409 : 500
    );
  }

  return c.json({ client: data }, 201);
});

clients.get(
  "/",
  cacheResponse({
    key: (c) => {
      const page = Number(c.req.query("page") || 1);
      const per = Number(c.req.query("perPage") || c.req.query("per") || 20);
      return buildCacheKey("clients", {
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
      .from("Client")
      .select("*", { count: "exact" })
      .range(start, end);

    if (error) return c.json({ error: error.message }, 500);

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
  }
);

clients.get("/:id", async (c) => {
  if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

  const id = c.req.param("id");
  if (!id) return c.json({ error: "Client ID is required" }, 400);

  const { data, error } = await supabase
    .from("Client")
    .select("*")
    .eq("id", id)
    .single();

  if (error?.code === "PGRST116" || error?.message?.includes("No rows")) {
    return c.json({ error: "Client not found" }, 404);
  }

  if (error) {
    return c.json(
      { error: "Failed to fetch client", details: error.message },
      500
    );
  }

  return c.json({ client: data }, 200);
});

clients.patch("/:id", async (c) => {
  if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

  const id = c.req.param("id");
  if (!id) return c.json({ error: "Client ID is required" }, 400);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = ClientUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.name !== undefined) {
    updates.name = parsed.data.name;
  }
  if (parsed.data.email !== undefined) {
    updates.email = parsed.data.email;
  }
  if (parsed.data.firstName !== undefined) {
    updates.firstName = parsed.data.firstName;
  }
  if (parsed.data.lastName !== undefined) {
    updates.lastName = parsed.data.lastName;
  }
  if (parsed.data.phoneNumber !== undefined) {
    updates.phoneNumber = parsed.data.phoneNumber;
  }
  const { data, error } = await supabase
    .from("Client")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error?.code === "PGRST116" || error?.message?.includes("No rows")) {
    return c.json({ error: "Client not found" }, 404);
  }

  if (error) {
    return c.json(
      { error: "Failed to update client", details: error.message },
      500
    );
  }
  cacheInvalidate(`clients:*`);

  return c.json({ client: data }, 200);
});

export default clients;
