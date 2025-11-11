import type { Context, Next } from "hono";
import { cache as redisCache } from "./redisClient";

type KeyBuilder = string | ((c: Context) => string);

export interface CacheOptions {
  // Cache key or builder (defaults to METHOD:URL+query)
  key?: KeyBuilder;
  // TTL in seconds (default 300)
  ttlSeconds?: number;
  // Only cache for these HTTP methods (default: ["GET"])
  methods?: string[];
  // Set to true to skip caching (can also be toggled at runtime via skipCache)
  skip?: boolean;
}

/**
 * Cache middleware:
 * - If a cached entry exists, returns it immediately.
 * - Otherwise, it intercepts c.json(...) and stores the returned object.
 */
export function cacheResponse(options: CacheOptions = {}) {
  const { key, ttlSeconds = 300, methods = ["GET"], skip = false } = options;

  return async (c: Context, next: Next) => {
    // Respect allowed methods
    if (!methods.includes(c.req.method)) {
      return next();
    }

    // Compute cache key
    const url = new URL(c.req.url);
    const computedKey =
      typeof key === "function"
        ? key(c)
        : key ??
          `${c.req.method}:${url.pathname}${
            url.search ? `?${url.searchParams.toString()}` : ""
          }`;

    // Check cache
    if (!skip) {
      const cached = await redisCache.get(computedKey);
      if (cached !== null) {
        return c.json(cached);
      }
    }

    // Intercept c.json to store object on the way out
    const originalJson = c.json.bind(c);

    c.set("cache:key", computedKey);
    c.set("cache:ttl", ttlSeconds);

    // Allow handlers to opt-out dynamically with skipCache(c, true)
    c.json = async (data: any, status?: number) => {
      const dynamicSkip = Boolean(c.get("cache:skip"));
      if (!skip && !dynamicSkip) {
        // Best-effort; failures just log inside CacheManager
        await redisCache.set(computedKey, data, ttlSeconds);
      }
      return originalJson(data, status);
    };

    await next();
  };
}

/**
 * Helper: override the cache key during a request.
 */
export function setCacheKey(c: Context, key: string) {
  c.set("cache:key", key);
}

/**
 * Helper: skip caching for the current request.
 */
export function skipCache(c: Context, value = true) {
  c.set("cache:skip", value);
}

/**
 * Helper: manually put an object into cache.
 */
export async function cachePut(key: string, value: any, ttlSeconds = 300) {
  return redisCache.set(key, value, ttlSeconds);
}

/**
 * Helper: invalidate keys by pattern (e.g., "GET:/services*").
 */
export async function cacheInvalidate(pattern: string) {
  return redisCache.invalidatePattern(pattern);
}
