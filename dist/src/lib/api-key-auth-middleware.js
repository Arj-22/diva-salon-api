import crypto from "node:crypto";
function parseKey(c, opts) {
    const hdr = c.req.header(opts.headerName);
    if (hdr)
        return hdr.trim();
    if (opts.allowAuthorizationHeader) {
        const auth = c.req.header("authorization");
        if (auth) {
            const m = auth.match(/^(Bearer|ApiKey)\s+(.+)$/i);
            if (m)
                return m[2].trim();
        }
    }
    const url = new URL(c.req.url, `http://${c.req.header("host") || "localhost"}`);
    const q = url.searchParams.get(opts.queryParam);
    if (q)
        return q.trim();
    return null;
}
function timingSafeEqual(a, b) {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length)
        return false;
    return crypto.timingSafeEqual(ab, bb);
}
function loadKeys(opts) {
    if (opts.keys?.length)
        return opts.keys;
    const raw = process.env[opts.envVar || "API_KEYS"] || "";
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}
function isExcluded(pathname, excludes) {
    if (!excludes || excludes.length === 0)
        return false;
    for (const ex of excludes) {
        if (typeof ex === "string" && pathname.startsWith(ex))
            return true;
        if (ex instanceof RegExp && ex.test(pathname))
            return true;
    }
    return false;
}
export function apiKeyAuth(options = {}) {
    const { envVar = "API_KEYS", keys, headerName = "x-api-key", queryParam = "api_key", allowAuthorizationHeader = true, exclude = [], } = options;
    // Load keys once during initialization
    const allowedKeys = loadKeys({ envVar, keys });
    if (allowedKeys.length === 0) {
        console.warn(`apiKeyAuth: no API keys configured (env: ${envVar}). All requests will be denied until configured.`);
    }
    return async (c, next) => {
        const url = new URL(c.req.url, `http://${c.req.header("host") || "localhost"}`);
        if (isExcluded(url.pathname, exclude)) {
            return next();
        }
        const provided = parseKey(c, {
            headerName,
            queryParam,
            allowAuthorizationHeader,
        });
        if (!provided) {
            c.header("WWW-Authenticate", 'Bearer realm="api"');
            return c.json({ error: "Unauthorized" }, 401);
        }
        if (allowedKeys.length === 0) {
            // Keys were missing at startup; deny without re-logging on each request
            return c.json({ error: "Unauthorized" }, 401);
        }
        const match = allowedKeys.some((k) => timingSafeEqual(provided, k));
        if (!match) {
            c.header("WWW-Authenticate", 'Bearer realm="api", error="invalid_token"');
            return c.json({ error: "Unauthorized" }, 401);
        }
        c.set("apiKey", provided);
        await next();
    };
}
