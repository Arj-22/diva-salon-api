import crypto from "crypto";
import argon2 from "argon2";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { cacheApiKey, getHashedKeyFromCache } from "./cache-middleware.js";
config({ path: ".env" });
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;
/**
 * Build the full key string from parts.
 * Format: ak_<keyId>_<token>
 */
export function buildFullKey(keyId, token) {
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
export async function createHashedApiKey(opts = {}) {
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
export async function hashApiKey(fullKey, opts = {}) {
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
export function parseFullKey(fullKey) {
    if (typeof fullKey !== "string" || fullKey.length === 0) {
        throw new Error("Invalid API key format");
    }
    // Match: ak_<uuid>_<token>
    // uuid: 8-4-4-4-12 hex digits (36 chars including dashes)
    // token: one or more URL-safe base64 characters (A-Z a-z 0-9 - _)
    const re = /^ak_([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})_([A-Za-z0-9\-_]+)$/;
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
export function tryParseFullKey(fullKey) {
    try {
        return parseFullKey(fullKey);
    }
    catch {
        return null;
    }
}
export const verifyApiKey = async (apiKey) => {
    let keyId;
    if (!supabase) {
        return { error: "Supabase client not configured" };
    }
    try {
        const parsed = parseFullKey(apiKey);
        keyId = parsed.keyId;
    }
    catch (err) {
        return { valid: false, error: "invalid_format" };
    }
    const cachedHashedKey = await getHashedKeyFromCache(keyId);
    if (cachedHashedKey) {
        let ok = false;
        try {
            ok = await argon2.verify(cachedHashedKey, apiKey);
        }
        catch (err) {
            console.error("verifyApiKey (cache): argon2.verify error", err);
            ok = false;
        }
        if (ok) {
            return { valid: true };
        }
    }
    const { data, error } = await supabase
        .from("ApiKeys")
        .select("hashedKey, organisation_id")
        .eq("keyId", keyId)
        .single();
    if (error || !data) {
        return { valid: false, error: "API key not found" };
    }
    const hashedKey = data.hashedKey;
    let ok = false;
    try {
        ok = await argon2.verify(hashedKey, apiKey);
    }
    catch (err) {
        console.error("verifyApiKey: argon2.verify error", err);
        ok = false;
    }
    if (!ok) {
        return { valid: false, error: "invalid_key" };
    }
    cacheApiKey(keyId, hashedKey).catch((err) => {
        console.error("cacheApiKey error:", err);
    });
    return { valid: true, organisationId: data.organisation_id };
};
const API_KEY_ENCRYPTION_KEY = process.env.API_KEY_ENCRYPTION_KEY ?? "";
const ENCRYPTION_ALGO = "aes-256-gcm";
const encryptionKeyBuffer = API_KEY_ENCRYPTION_KEY.length > 0
    ? Buffer.from(API_KEY_ENCRYPTION_KEY, "base64")
    : null;
function requireEncryptionKey() {
    if (!encryptionKeyBuffer || encryptionKeyBuffer.length !== 32) {
        throw new Error("API_KEY_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
    }
    return encryptionKeyBuffer;
}
function encryptFullKey(fullKey) {
    const key = requireEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, key, iv);
    const ciphertext = Buffer.concat([
        cipher.update(fullKey, "utf8"),
        cipher.final(),
    ]);
    return {
        ciphertext: ciphertext.toString("base64"),
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
    };
}
function decryptFullKey(payload) {
    const key = requireEncryptionKey();
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, key, Buffer.from(payload.iv, "base64"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(payload.ciphertext, "base64")),
        decipher.final(),
    ]);
    return decrypted.toString("utf8");
}
export async function storeFullApiKeySecret(params) {
    if (!supabase)
        throw new Error("Supabase client not configured");
    const expiresAt = params.ttlMs === undefined || params.ttlMs === null
        ? null
        : new Date(Date.now() + params.ttlMs).toISOString();
    const encrypted = encryptFullKey(params.fullKey);
    const { error } = await supabase.from("ApiKeySecrets").insert({
        keyId: params.keyId,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        created_at: new Date().toISOString(),
        expires_at: expiresAt,
    });
    if (error) {
        console.error("storeFullApiKeySecret: Supabase insert error:", error);
        throw new Error(`Failed to store API key secret: ${error.message}`);
    }
    return { expiresAt };
}
export async function retrieveFullApiKeySecret(keyId, consume = false) {
    if (!supabase)
        throw new Error("Supabase client not configured");
    const { data, error } = await supabase
        .from("ApiKeySecrets")
        .select("ciphertext, iv, tag, expires_at")
        .eq("keyId", keyId)
        .maybeSingle();
    if (error)
        throw new Error(`Failed to load API key secret: ${error.message}`);
    if (!data) {
        return null;
    }
    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
        await supabase.from("ApiKeySecrets").delete().eq("keyId", keyId);
        return null;
    }
    const fullKey = decryptFullKey({
        ciphertext: data.ciphertext,
        iv: data.iv,
        tag: data.tag,
    });
    if (consume) {
        await supabase.from("ApiKeySecrets").delete().eq("keyId", keyId);
    }
    return { fullKey, expiresAt: data.expires_at };
}
