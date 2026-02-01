import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { cacheResponse } from "../lib/cache-middleware.js";
import {
  createHashedApiKey,
  parseFullKey,
  storeFullApiKeySecret,
  retrieveFullApiKeySecret,
} from "../lib/hashApiKey.js";
import argon2 from "argon2";
import { apiKeyAuth } from "../lib/api-key-auth-middleware.js";
const apiKeys = new Hono();
config({ path: ".env" });

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const ADMIN_API_KEY_EXPORT_SECRET = process.env.ADMIN_API_KEY_EXPORT_SECRET;

apiKeys.get(
  "/",
  apiKeyAuth(),
  cacheResponse({ ttlSeconds: 300 }),
  async (c) => {
    if (!supabase) {
      return c.json(
        { error: "Supabase client not configured" },
        { status: 500 },
      );
    }

    const { data, error } = await supabase
      .from("api_keys")
      .select("id, name, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      return c.json({ error: error.message }, { status: 500 });
    }

    return c.json({ apiKeys: data });
  },
);

apiKeys.post("/", apiKeyAuth(), async (c) => {
  if (!supabase) {
    return c.json({ error: "Supabase client not configured" }, { status: 500 });
  }
  const body = await c.req.json();

  if (!body.organisation_id) {
    return c.json({ error: "organisation_id is required" }, { status: 400 });
  }

  const { keyId, fullKey, hashedKey } = await createHashedApiKey();

  const { data, error } = await supabase
    .from("ApiKeys")
    .insert([
      {
        keyId: keyId,
        hashedKey: hashedKey,
        organisation_id: body.organisation_id,
      },
    ])
    .select()
    .single();

  if (error) {
    return c.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return c.json({ error: "Failed to create API key" }, { status: 500 });
  }

  await storeFullApiKeySecret({
    keyId: keyId,
    fullKey: fullKey,
  });

  return c.json(
    {
      message: "API key created successfully",
      apiKey: fullKey, // Return the full key only once
    },
    { status: 201 },
  );
});

apiKeys.post("/verifyKey", apiKeyAuth(), async (c) => {
  const { apiKey } = await c.req.json();
  if (!apiKey) {
    return c.json(
      { valid: false, error: "API key is required" },
      { status: 400 },
    );
  }

  if (!supabase) {
    return c.json({ error: "Supabase client not configured" }, { status: 500 });
  }

  let keyId: string;
  try {
    const parsed = parseFullKey(apiKey);
    keyId = parsed.keyId;
  } catch (err) {
    return c.json({ valid: false, error: "invalid_format" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("ApiKeys")
    .select("hashedKey")
    .eq("keyId", keyId) // Extract keyId from full key
    .single();

  if (error || !data) {
    return c.json(
      { valid: false, error: "API key not found" },
      { status: 404 },
    );
  }

  const hashedKey = data.hashedKey;

  let ok = false;
  try {
    ok = await argon2.verify(hashedKey, apiKey);
  } catch (err) {
    // argon2.verify throws on malformed hashes or internal errors
    console.error("verifyApiKey: argon2.verify error", err);
    ok = false;
  }

  if (!ok) {
    return c.json({ valid: false, error: "invalid_key" }, { status: 401 });
  }

  return c.json({ valid: true });
});

apiKeys.get("/plaintext", apiKeyAuth(), async (c) => {
  if (!supabase) {
    return c.json({ error: "Supabase client not configured" }, { status: 500 });
  }
  if (!ADMIN_API_KEY_EXPORT_SECRET) {
    return c.json({ error: "Export secret not configured" }, { status: 500 });
  }
  const provided = c.req.header("x-admin-export-secret");
  if (provided !== ADMIN_API_KEY_EXPORT_SECRET) {
    return c.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase.from("ApiKeySecrets").select("keyId");

  if (error) {
    return c.json({ error: error.message }, { status: 500 });
  }

  const keys: Array<{
    keyId: string;
    fullKey: string;
    expiresAt: string;
  }> = [];

  for (const row of data ?? []) {
    const secret = await retrieveFullApiKeySecret(row.keyId, false);
    if (secret) {
      keys.push({
        keyId: row.keyId,
        fullKey: secret.fullKey,
        expiresAt: secret.expiresAt,
      });
    }
  }

  return c.json({ keys });
});

export default apiKeys;
