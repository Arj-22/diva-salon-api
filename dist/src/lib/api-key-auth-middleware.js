import { verifyApiKey } from "./hashApiKey.js";
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
    const { headerName = "x-api-key", queryParam = "api_key", allowAuthorizationHeader = true, exclude = [], } = options;
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
        // Use new DB-based verification
        const result = await verifyApiKey(provided);
        if (!result.valid) {
            c.header("WWW-Authenticate", 'Bearer realm="api", error="invalid_token"');
            return c.json({ error: "Unauthorized", details: result.error }, 401);
        }
        c.set("apiKey", provided);
        await next();
    };
}
