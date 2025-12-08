import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import {
  buildCacheKey,
  cacheInvalidate,
  cacheResponse,
} from "../lib/cache-middleware.js";
import { parsePagination } from "../../utils/helpers.js";
import { validateTreatmentBooking } from "../lib/validation-middleware.js";
// import { sendMail } from "../lib/mailer.js";

const treatmentBookings = new Hono();
config({ path: ".env" });

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

treatmentBookings.get(
  "/",
  cacheResponse({
    key: (c) => {
      const page = Number(c.req.query("page") || 1);
      const per = Number(c.req.query("perPage") || c.req.query("per") || 20);
      const status = c.req.query("status") || "";

      return buildCacheKey("treatmentBookings", {
        page,
        per,
        status,
      });
    },
    ttlSeconds: 300,
  }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

    const status = c.req.query("status") || "";
    const { page, perPage, start, end } = parsePagination(c);

    const { data, error, count } = await supabase
      .from("Treatment_Booking")
      .select(
        `*, Treatment (EposNowTreatment(Name, SalePriceIncTax))
        `,
        { count: "exact" }
      )
      .eq(status ? "status" : "", status || "")
      .order("created_at", { ascending: false })
      .range(start, end);

    if (error) {
      return c.json(
        { error: "Failed to fetch treatment bookings", details: error.message },
        500
      );
    }

    const rows = Array.isArray(data) ? data : [];
    const total = typeof count === "number" ? count : rows.length;
    const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;

    return c.json({
      treatmentBookings: data,
      meta: { total, page, perPage, totalPages },
    });
  }
);

treatmentBookings.get(
  "/byBookingId/:bookingId{[0-9]+}",
  cacheResponse({
    key: (c) => {
      return buildCacheKey("treatmentBookings", {
        bookingId: c.req.param("bookingId"),
      });
    },
    ttlSeconds: 300,
  }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

    const { page, perPage, start, end } = parsePagination(c);

    const { data, error, count } = await supabase
      .from("Treatment_Booking")
      .select(
        `*, Treatment (EposNowTreatment(Name, SalePriceIncTax))
        `,
        { count: "exact" }
      )
      .eq("bookingId", Number(c.req.param("bookingId")))
      .order("created_at", { ascending: false })
      .range(start, end);

    if (error) {
      return c.json(
        { error: "Failed to fetch treatment bookings", details: error.message },
        500
      );
    }

    const rows = Array.isArray(data) ? data : [];
    const total = typeof count === "number" ? count : rows.length;
    const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;

    return c.json({
      treatmentBookings: data,
      meta: { total, page, perPage, totalPages },
    });
  }
);

treatmentBookings.get(
  "/byId/:Id{[0-9]+}",
  cacheResponse({
    key: (c) => {
      return buildCacheKey("treatmentBookings", {
        Id: c.req.param("Id"),
      });
    },
    ttlSeconds: 300,
  }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

    const { data, error, count } = await supabase
      .from("Treatment_Booking")
      .select(
        `*, Treatment (EposNowTreatment(Name, SalePriceIncTax))
        `,
        { count: "exact" }
      )
      .eq("id", Number(c.req.param("Id")))
      .single();

    if (error) {
      return c.json(
        { error: "Failed to fetch treatment bookings", details: error.message },
        500
      );
    }

    return c.json({
      treatmentBooking: data,
    });
  }
);

treatmentBookings.patch(
  "updateTreatmentBooking/:id{[0-9]+}",
  validateTreatmentBooking(),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

    const id = Number(c.req.param("id"));
    const body = await c.req.json();

    const payload = {
      ...body,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("Treatment_Booking")
      .update(payload)
      .eq("id", id)
      .select(
        `*, Treatment (EposNowTreatment(Name, SalePriceIncTax))
        `
      )
      .single();

    if (error) {
      return c.json(
        { error: "Failed to update treatment booking", details: error.message },
        500
      );
    }

    cacheInvalidate("treatmentBookings:*");

    return c.json({
      treatmentBooking: data,
    });
  }
);

export default treatmentBookings;
