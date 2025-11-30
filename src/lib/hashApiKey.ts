import crypto from "crypto";
import argon2 from "argon2";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

/**
 * Options for creating / hashing an API key.
 */
export type CreateApiKeyOptions = {
  /**
   * Number of random bytes for the token portion (default 32 => 256 bits).
   */
  tokenBytes?: number;

  /**
   * Argon2 hashing options. These will be forwarded to argon2.hash().
   * Defaults are reasonably strong for typical servers; tune for your environment.
   */
  argon2Options?: {
    memoryCost?: number; // in kibibytes
    timeCost?: number;
    parallelism?: number;
  };
};

/**
 * Result returned when creating a new API key and hashing it for storage.
 * - fullKey: plaintext key to be shown once to the caller (store it securely client-side).
 * - hashedKey: value you should persist in the database (never store fullKey).
 * - keyId & token: the parts if you need them separately.
 */
export type CreatedApiKey = {
  keyId: string;
  token: string;
  fullKey: string;
  hashedKey: string;
};

config({ path: ".env" });

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

/**
 * Build the full key string from parts.
 * Format: ak_<keyId>_<token>
 */
export function buildFullKey(keyId: string, token: string) {
  return `ak_${keyId}_${token}`;
}

/**
 * Create a new API key (keyId + random token), hash it with Argon2id, and
 * return both the plaintext (fullKey) and the hashed value to persist.
 *
 * IMPORTANT:
 * - Show fullKey to the end user exactly once (at creation). Do NOT log it.
 * - Persist only hashedKey in your database.
 */
export async function createHashedApiKey(
  opts: CreateApiKeyOptions = {}
): Promise<CreatedApiKey> {
  const tokenBytes = typeof opts.tokenBytes === "number" ? opts.tokenBytes : 32;
  const argon2Opts = opts.argon2Options ?? {
    memoryCost: 2 ** 16,
    timeCost: 3,
    parallelism: 1,
  };

  const keyId = crypto.randomUUID();
  const buf = crypto.randomBytes(tokenBytes);
  // base64url is URL-safe and avoids +/= characters
  const token = buf.toString("base64url");

  const fullKey = buildFullKey(keyId, token);

  const hashedKey = await argon2.hash(fullKey, {
    type: argon2.argon2id,
    memoryCost: argon2Opts.memoryCost,
    timeCost: argon2Opts.timeCost,
    parallelism: argon2Opts.parallelism,
  });

  return { keyId, token, fullKey, hashedKey };
}

/**
 * Hash an existing fullKey (useful if you need to migrate or re-hash).
 * Returns the Argon2id hash string you can store in DB.
 */
export async function hashApiKey(
  fullKey: string,
  opts: CreateApiKeyOptions = {}
): Promise<string> {
  const argon2Opts = opts.argon2Options ?? {
    memoryCost: 2 ** 16,
    timeCost: 3,
    parallelism: 1,
  };
  return argon2.hash(fullKey, {
    type: argon2.argon2id,
    memoryCost: argon2Opts.memoryCost,
    timeCost: argon2Opts.timeCost,
    parallelism: argon2Opts.parallelism,
  });
}

/**
 * Example usage (do not call in production inline; put behind admin auth):
 *
 * const { keyId, fullKey, hashedKey } = await createHashedApiKey();
 * // persist { keyId, hashedKey, owner_id, scopes, expires_at, ... } to DB
 * // return fullKey to the caller once
 *
 * NOTE: fullKey should only be shown once. If you need to display it again
 * provide a mechanism to revoke & re-issue a rotated key instead.
 */

/**
 * parseFullKey.ts
 *
 * Small helper to parse and validate API keys in the format:
 *   ak_<keyId>_<token>
 *
 * - keyId is expected to be a UUID (36 chars with dashes) produced by crypto.randomUUID()
 * - token is the URL-safe base64 string produced by createHashedApiKey()
 *
 * The function throws an Error when the format is invalid (so existing code that
 * expects parseFullKey to throw will continue to work).
 */

export function parseFullKey(fullKey: string): {
  keyId: string;
  token: string;
} {
  if (typeof fullKey !== "string" || fullKey.length === 0) {
    throw new Error("Invalid API key format");
  }

  // Match: ak_<uuid>_<token>
  // uuid: 8-4-4-4-12 hex digits (36 chars including dashes)
  // token: one or more URL-safe base64 characters (A-Z a-z 0-9 - _)
  const re =
    /^ak_([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})_([A-Za-z0-9\-_]+)$/;
  const m = re.exec(fullKey);
  if (!m) {
    throw new Error("Invalid API key format");
  }

  const [, keyId, token] = m;
  return { keyId, token };
}

/**
 * Safe "try-parse" variant if you prefer not to use exceptions:
 * const parsed = tryParseFullKey(s);
 * if (!parsed) { ...invalid... } else { use parsed.keyId ... }
 */
export function tryParseFullKey(
  fullKey: string
): { keyId: string; token: string } | null {
  try {
    return parseFullKey(fullKey);
  } catch {
    return null;
  }
}

export const verifyApiKey = async (apiKey: string) => {
  let keyId: string;

  if (!supabase) {
    return { error: "Supabase client not configured" };
  }
  try {
    const parsed = parseFullKey(apiKey);
    keyId = parsed.keyId;

    // console.log("Parsed keyId:", keyId, "from apiKey:", apiKey);
  } catch (err) {
    return { valid: false, error: "invalid_format" };
  }

  const { data, error } = await supabase
    .from("ApiKeys")
    .select("hashedKey")
    .eq("keyId", keyId) // Extract keyId from full key
    .single();

  if (error || !data) {
    return { valid: false, error: "API key not found" };
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
    return { valid: false, error: "invalid_key" };
  }

  return { valid: true };
};
