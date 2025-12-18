import type { Context, Next } from "hono";
import crypto from "node:crypto";
import {
  BookingUpdateSchema,
  type BookingInput,
} from "../../utils/schemas/BookingSchema.js";
import { formatZodError } from "../../utils/helpers.js";
import type z from "zod";
import { getRedisClient } from "./redisClient.js";
import { TreatmentBookingUpdateSchema } from "../../utils/schemas/TreatmentBookingSchema.js";
import { ClientUpdateSchema } from "../../utils/schemas/ClientSchema.js";

export function validateBooking(schema: z.ZodTypeAny = BookingUpdateSchema) {
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

export function validateTreatmentBooking(
  schema: z.ZodTypeAny = TreatmentBookingUpdateSchema
) {
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

    c.set("treatmentBookingData", parsed.data);
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

export function validateClient(schema: z.ZodTypeAny = ClientUpdateSchema) {
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

    c.set("Client Data", parsed.data as z.infer<typeof ClientUpdateSchema>);
    await next();
  };
}
