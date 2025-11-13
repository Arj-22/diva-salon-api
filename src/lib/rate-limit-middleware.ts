import { config } from "dotenv";
import type { Context, Next } from "hono";
import { getRedisClient } from "./redisClient.js"; // use CacheManager wrapper

export interface RateLimitOptions {
  limit: number;
  windowSec: number;
  prefix?: string;
  key?: (c: Context) => string; // identifier (default: global)
}

config();

// In-memory fallback store
const mem = new Map<string, { count: number; resetAt: number }>();

function routeKey(c: Context) {
  const base = `http://${c.req.header("host") || "localhost"}`;
  const url = new URL(c.req.url, base);
  return `${c.req.method}:${url.pathname}`;
}

export function rateLimit(opts: RateLimitOptions) {
  const { limit, windowSec, prefix = "rl", key } = opts;

  return async (c: Context, next: Next) => {
    const id = (key?.(c) ?? "global") || "global";
    const rKey = `${prefix}:${routeKey(c)}:${id}`;

    try {
      const redis = await getRedisClient();
      let count = 0;
      let ttl;

      if (redis) {
        count = await redis.incr(rKey);
        if (count === 1) {
          await redis.expire(rKey, windowSec);
          ttl = windowSec;
        } else {
          const t = await redis.ttl(rKey);
          ttl = t > 0 ? t : windowSec;
        }
      } else {
        // memory fallback
        const now = Math.floor(Date.now() / 1000);
        const entry = mem.get(rKey);
        if (!entry || entry.resetAt <= now) {
          mem.set(rKey, { count: 1, resetAt: now + windowSec });
          count = 1;
          ttl = windowSec;
        } else {
          entry.count += 1;
          count = entry.count;
          ttl = entry.resetAt - now;
        }
      }

      const remaining = Math.max(0, limit - count);
      const resetAt =
        Math.floor(Date.now() / 1000) + (ttl > 0 ? ttl : windowSec);

      c.header("X-RateLimit-Limit", String(limit));
      c.header("X-RateLimit-Remaining", String(remaining));
      c.header("X-RateLimit-Reset", String(resetAt));

      if (count > limit) {
        c.header("Retry-After", String(ttl > 0 ? ttl : windowSec));
        return c.json(
          {
            error: `Too Many Requests, you can only call this ${limit} times every ${windowSec} seconds.`,
          },
          429
        );
      }

      await next();
    } catch (e) {
      console.error("rateLimit middleware error:", e);
      return next(); // fail-open on errors
    }
  };
}
