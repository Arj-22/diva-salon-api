import type { Context, Next } from "hono";
import crypto from "node:crypto";
import {
  BookingSchema,
  type BookingInput,
} from "../../utils/schemas/BookingSchema.js";
import {
  ClientSchema,
  type ClientInput,
} from "../../utils/schemas/ClientSchema.js";
import { formatZodError } from "../../utils/helpers.js";
import type z from "zod";
import { getRedisClient } from "./redisClient.js";

export function validateBooking(schema: z.ZodTypeAny = BookingSchema) {
  return async (c: Context, next: Next) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: "Validation failed",
          details: formatZodError(parsed.error),
        },
        400
      );
    }

    c.set("bookingData", parsed.data as BookingInput);
    await next();
  };
}

export function validateClient(schema: z.ZodTypeAny = ClientSchema) {
  return async (c: Context, next: Next) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Validation failed", details: formatZodError(parsed.error) },
        400
      );
    }

    c.set("clientData", parsed.data as ClientInput);
    await next();
  };
}

// Reject rapid duplicate submissions (same normalized payload) within TTL
export function duplicateSubmissionGuard(ttlSeconds = 300) {
  return async (c: Context, next: Next) => {
    const body = c.get("jsonBody") ?? {};
    // Create a stable fingerprint from key fields
    const fingerprint = JSON.stringify({
      name: (body.name || "").trim().toLowerCase(),
      email: (body.email || "").trim().toLowerCase(),
      treatmentIds: Array.isArray(body.treatmentIds)
        ? [...body.treatmentIds].sort()
        : [],
      message: (body.message || "").trim().slice(0, 256),
    });
    const hash = crypto.createHash("sha256").update(fingerprint).digest("hex");
    const key = `dup:booking:${hash}`;

    const client = await getRedisClient().catch(() => null as any);
    if (!client) return next(); // don’t block if Redis unavailable

    const set = await client.set(key, "1", { NX: true, EX: ttlSeconds });
    if (set !== "OK") {
      return c.json({ error: "Duplicate submission detected" }, 429);
    }
    await next();
  };
}
