import type { Context, Next } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { parseFullKey } from "./hashApiKey.js";

config({ path: ".env" });

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

type OrganizationMiddlewareOptions = {
  exclude?: Array<string | RegExp>;
};

function isExcluded(pathname: string, excludes?: Array<string | RegExp>) {
  if (!excludes || excludes.length === 0) return false;
  for (const ex of excludes) {
    if (typeof ex === "string" && pathname.startsWith(ex)) return true;
    if (ex instanceof RegExp && ex.test(pathname)) return true;
  }
  return false;
}

/**
 * Middleware that fetches and sets the organization_id from the API key.
 * This should run after apiKeyAuth middleware.
 *
 * Usage:
 *   app.use('/api/*', apiKeyAuth(), organizationMiddleware());
 */
export function organizationMiddleware(
  options: OrganizationMiddlewareOptions = {},
) {
  const { exclude = [] } = options;
  return async (c: Context, next: Next) => {
    const url = new URL(
      c.req.url,
      `http://${c.req.header("host") || "localhost"}`,
    );

    if (isExcluded(url.pathname, exclude)) {
      return next();
    }

    if (!supabase) {
      return c.json({ error: "Database not configured" }, 500);
    }

    // Get the API key set by apiKeyAuth middleware
    const apiKey = c.get("apiKey");
    if (!apiKey) {
      return c.json({ error: "API key not found in context" }, 401);
    }

    try {
      const { keyId } = parseFullKey(apiKey);

      // Fetch organization_id from ApiKeys table
      const { data, error } = await supabase
        .from("ApiKeys")
        .select("organisation_id")
        .eq("keyId", keyId)
        .single();

      if (error || !data || !data.organisation_id) {
        return c.json(
          { error: "Organization not found for this API key" },
          403,
        );
      }

      // Set organization_id in context for use in route handlers
      c.set("organisation_id", data.organisation_id);
      await next();
    } catch (err) {
      console.error("organizationMiddleware error:", err);
      return c.json({ error: "Failed to validate organization" }, 500);
    }
  };
}
