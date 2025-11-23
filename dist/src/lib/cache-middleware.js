import { cache as redisCache } from "./redisClient.js"; // use CacheManager wrapper
/**
 * Cache middleware:
 * - If a cached entry exists, returns it immediately.
 * - Otherwise, it intercepts c.json(...) and stores the returned object.
 */
export function cacheResponse(options = {}) {
    const { key, ttlSeconds = 300, methods = ["GET"], skip = false } = options;
    const allowed = new Set(methods.map((m) => m.toUpperCase()));
    return async (c, next) => {
        if (!allowed.has(c.req.method)) {
            await next();
            return;
        }
        const base = `http://${c.req.header("host") || "localhost"}`;
        const url = new URL(c.req.url, base);
        const computedKey = typeof key === "function"
            ? key(c)
            : key ??
                `${c.req.method}:${url.pathname}${url.search ? `?${url.searchParams.toString()}` : ""}`;
        if (!skip) {
            try {
                const cached = await redisCache.get(computedKey);
                if (cached !== null) {
                    return c.json(cached);
                }
            }
            catch (err) {
                console.error("Cache get error:", err);
            }
        }
        const originalJson = c.json.bind(c);
        c.set("cache:key", computedKey);
        c.set("cache:ttl", ttlSeconds);
        c.json = ((data, status, headers) => {
            const dynamicSkip = Boolean(c.get("cache:skip"));
            if (!skip && !dynamicSkip) {
                // CacheManager.set handles JSON.stringify and TTL via SETEX
                void redisCache
                    .set(computedKey, data, ttlSeconds)
                    .catch((e) => console.error("Cache set error:", e));
            }
            return originalJson(data, status, headers);
        });
        await next();
    };
}
export function setCacheKey(c, key) {
    c.set("cache:key", key);
}
export function skipCache(c, value = true) {
    c.set("cache:skip", value);
}
export async function cachePut(key, value, ttlSeconds = 300) {
    return redisCache.set(key, value, ttlSeconds);
}
export async function cacheInvalidate(pattern) {
    return redisCache.invalidatePattern(pattern);
}
/**
 * Cache only IDs for a filtered endpoint, and resolve to full objects by reading
 * the already-cached "all services" payload.
 *
 * On hit:
 *  - reads IDs from its own key
 *  - reads full list from allKey
 *  - resolves matching objects and returns the built response
 *
 * On miss:
 *  - lets the handler run
 *  - intercepts c.json to extract IDs via idsFromResponse(data) and stores them
 */
export function cacheIdsViaAll(options) {
    const { key, ttlSeconds = 300, methods = ["GET"], skip = false, allKey, allItemsSelector, idField = "id", responseFromResolved, idsFromResponse, } = options;
    const allowed = new Set(methods.map((m) => m.toUpperCase()));
    // Default extractor for your current payload shape: { EposNowTreatments: [...] }
    const defaultAllSel = (payload) => {
        if (!payload)
            return [];
        if (Array.isArray(payload))
            return payload;
        if (Array.isArray(payload.EposNowTreatments))
            return payload.EposNowTreatments;
        if (Array.isArray(payload.items))
            return payload.items;
        return [];
    };
    return async (c, next) => {
        if (!allowed.has(c.req.method)) {
            await next();
            return;
        }
        const base = `http://${c.req.header("host") || "localhost"}`;
        const url = new URL(c.req.url, base);
        const computedKey = typeof key === "function"
            ? key(c)
            : key ??
                `${c.req.method}:${url.pathname}${url.search ? `?${url.searchParams.toString()}` : ""}`;
        if (!skip) {
            try {
                const cachedIds = await redisCache.get(computedKey);
                if (cachedIds && Array.isArray(cachedIds)) {
                    const allPayload = await redisCache.get(allKey);
                    const allItems = (allItemsSelector ?? defaultAllSel)(allPayload);
                    if (Array.isArray(allItems) && allItems.length > 0) {
                        const idSet = new Set(cachedIds.map((v) => String(v)));
                        const resolved = allItems.filter((it) => idSet.has(String(it?.[idField])));
                        const response = responseFromResolved(c, resolved, cachedIds);
                        return c.json(response);
                    }
                    // If we cannot resolve due to missing full list, fall through to handler
                }
            }
            catch (err) {
                console.error("IDs cache get/resolve error:", err);
            }
        }
        // Miss path: intercept response to store IDs only
        const originalJson = c.json.bind(c);
        c.json = ((data, status, headers) => {
            const dynamicSkip = Boolean(c.get("cache:skip"));
            if (!skip && !dynamicSkip) {
                try {
                    const ids = idsFromResponse(data);
                    if (Array.isArray(ids) && ids.length >= 0) {
                        void redisCache
                            .set(computedKey, ids, ttlSeconds)
                            .catch((e) => console.error("Cache set (ids) error:", e));
                    }
                }
                catch (e) {
                    console.error("idsFromResponse error:", e);
                }
            }
            return originalJson(data, status, headers);
        });
        await next();
    };
}
