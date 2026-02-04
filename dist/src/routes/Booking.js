import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { validateBooking, validateBookingUpdate, } from "../lib/validation-middleware.js";
import { buildCacheKey, cacheInvalidate, cacheResponse, } from "../lib/cache-middleware.js";
import { hcaptchaVerify } from "../lib/hcaptcha-middleware.js";
import { combineDateAndTime, overlaps, parsePagination, } from "../../utils/helpers.js";
import { createBookingRecord } from "../lib/bookingActions.js";
const bookings = new Hono();
config({ path: ".env" });
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;
const ADMIN_BOOKING_SECRET = process.env.ADMIN_BOOKING_SECRET;
bookings.post("/", hcaptchaVerify({ bodyField: "hcaptcha_token" }), validateBooking(), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    //@ts-ignore
    const organisation_id = c.get("organisation_id");
    const payload = await c.req.json();
    return createBookingRecord(c, {
        ...payload,
        organisation_id,
    });
});
bookings.post("/admin", validateBooking(), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    if (!ADMIN_BOOKING_SECRET) {
        return c.json({ error: "Admin booking secret not configured" }, 500);
    }
    const provided = c.req.header("x-admin-booking-secret");
    if (provided !== ADMIN_BOOKING_SECRET) {
        return c.json({ error: "Forbidden" }, 403);
    }
    //@ts-ignore
    const organisation_id = c.get("organisation_id");
    if (!organisation_id) {
        return c.json({ error: "Missing organisation context" }, 400);
    }
    const payload = await c.req.json();
    return createBookingRecord(c, {
        ...payload,
        organisation_id,
    });
});
bookings.patch("/:bookingId{[0-9]+}", validateBookingUpdate(), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const id = Number(c.req.param("bookingId"));
    const updateData = await c.req.json();
    const { data: updatedBooking, error } = await supabase
        .from("Booking")
        .update(updateData)
        .eq("id", id)
        .select("*")
        .single();
    if (error) {
        return c.json({ error: "Failed to update booking", details: error.message }, 500);
    }
    cacheInvalidate("bookings:*");
    cacheInvalidate("availability:*");
    return c.json({ message: "Booking updated", booking: updatedBooking });
});
bookings.get("/", cacheResponse({
    key: (c) => {
        const page = Number(c.req.query("page") || 1);
        const per = Number(c.req.query("perPage") || c.req.query("per") || 20);
        const status = c.req.query("status");
        const clientId = c.req.query("clientId");
        const appointmentDate = c.req.query("appointmentDate");
        const organisationId = c.get("organisation_id");
        const staffId = c.req.query("staffId");
        return buildCacheKey("bookings", {
            page,
            per,
            status,
            clientId,
            appointmentDate,
            organisationId,
            staffId,
        });
    },
    ttlSeconds: 300,
}), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const status = c.req.query("status");
    const clientId = c.req.query("clientId");
    const appointmentDate = c.req.query("appointmentDate");
    const staffId = Number(c.req.query("staffId"));
    const { page, perPage, start, end } = parsePagination(c);
    //@ts-ignore
    const organisation_id = c.get("organisation_id");
    let query = supabase
        .from("Booking")
        .select(`*, Client (id, name, email, phoneNumber), Treatment(*, EposNowTreatment(Name, SalePriceIncTax)), Staff(id, first_name)  `, { count: "exact" })
        .order("created_at", { ascending: false })
        .range(start, end);
    if (status && status !== "all") {
        query = query.eq("status", status);
    }
    if (clientId && clientId !== null) {
        query = query.eq("clientId", clientId);
    }
    if (organisation_id) {
        query = query.eq("organisation_id", organisation_id);
    }
    if (staffId && staffId > 0) {
        query = query.eq("staffId", staffId);
    }
    if (appointmentDate) {
        const dateStart = new Date(appointmentDate);
        if (Number.isNaN(dateStart.getTime())) {
            return c.json({ error: "Invalid appointmentDate" }, 400);
        }
        const dateEnd = new Date(dateStart);
        dateStart.setHours(0, 0, 0, 0);
        dateEnd.setHours(23, 59, 59, 999);
        query = query
            .gte("appointmentStartTime", dateStart.toISOString())
            .lte("appointmentStartTime", dateEnd.toISOString());
    }
    const { data, error, count } = await query;
    if (error) {
        return c.json({ error: "Failed to fetch bookings", details: error.message }, 500);
    }
    const rows = Array.isArray(data) ? data : [];
    const total = typeof count === "number" ? count : rows.length;
    const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;
    // Transform to include treatmentIds array
    const bookingsList = rows.map((booking) => ({
        id: booking.id,
        message: booking.message,
        status: booking.status,
        appointmentStartTime: booking.appointmentStartTime,
        appointmentEndTime: booking.appointmentEndTime,
        treatmentId: booking.treatmentId,
        treatment: booking.Treatment,
        created_at: booking.created_at,
        client: booking.Client,
        staff: booking.Staff,
    }));
    return c.json({
        bookings: bookingsList,
        meta: { total, page, perPage, totalPages },
    });
});
bookings.get("/byBookingId/:bookingId{[0-9]+}", cacheResponse({
    key: (c) => buildCacheKey("bookings", {
        route: "byBookingId",
        bookingId: c.req.param("bookingId"),
        organisation_id: c.get("organisation_id"),
    }),
    ttlSeconds: 300,
}), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const id = Number(c.req.param("bookingId"));
    const { data, error } = await supabase
        .from("Booking")
        .select(`*, Client (id, name, email, phoneNumber), Treatment(*, EposNowTreatment(Name, SalePriceIncTax)) `)
        .eq("id", id)
        .single();
    if (error) {
        return c.json({ error: "Failed to fetch booking", details: error.message }, 500);
    }
    if (!data) {
        return c.json({ error: "Booking not found" }, 404);
    }
    const booking = {
        id: data.id,
        message: data.message,
        status: data.status,
        appointmentStartTime: data.appointmentStartTime,
        appointmentEndTime: data.appointmentEndTime,
        treatmentId: data.treatmentId,
        created_at: data.created_at,
        client: data.Client,
        treatment: data.Treatment,
    };
    return c.json({ booking });
});
bookings.get("/byClientId/:clientId{[0-9]+}", cacheResponse({
    key: (c) => {
        const page = Number(c.req.query("page") || 1);
        const per = Number(c.req.query("perPage") || c.req.query("per") || 20);
        const organisation_id = c.get("organisation_id");
        return buildCacheKey("bookings", {
            route: "byClientId",
            clientId: c.req.param("clientId"),
            page,
            per,
            organisation_id,
        });
    },
    ttlSeconds: 300,
}), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    //@ts-ignore
    const organisation_id = c.get("organisation_id");
    const clientId = Number(c.req.param("clientId"));
    const { page, perPage, start, end } = parsePagination(c);
    const { data, error, count } = await supabase
        .from("Booking")
        .select(`*, Client(id, name, email, phoneNumber), Treatment(*, EposNowTreatment(Name, SalePriceIncTax)) `, { count: "exact" })
        .eq("clientId", clientId)
        .eq("organisation_id", organisation_id)
        .order("created_at", { ascending: false })
        .range(start, end);
    if (error) {
        return c.json({ error: "Failed to fetch bookings", details: error.message }, 500);
    }
    const rows = Array.isArray(data) ? data : [];
    const total = typeof count === "number" ? count : rows.length;
    const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;
    // Transform to include treatmentIds array
    const bookingsList = rows.map((booking) => ({
        id: booking.id,
        message: booking.message,
        created_at: booking.created_at,
        client: booking.Client,
        status: booking.status,
        appointmentStartTime: booking.appointmentStartTime,
        appointmentEndTime: booking.appointmentEndTime,
        treatmentId: booking.treatmentId,
        treatment: booking.Treatment,
    }));
    return c.json({
        bookings: bookingsList,
        meta: { total, page, perPage, totalPages },
    });
});
bookings.get("/availability", cacheResponse({
    key: (c) => {
        const treatmentId = c.req.query("treatmentId");
        const date = c.req.query("date");
        const organisation_id = c.get("organisation_id");
        return buildCacheKey("availability", {
            treatmentId,
            date,
            organisation_id,
        });
    },
    ttlSeconds: 60,
}), async (c) => {
    const treatmentId = c.req.query("treatmentId");
    const date = c.req.query("date"); // YYYY-MM-DD
    if (!treatmentId || !date) {
        return c.json({ error: "Missing parameters" }, 400);
    }
    if (!supabase) {
        return c.json({ error: "Supabase not configured" }, 500);
    }
    //@ts-ignore
    const organisation_id = c.get("organisation_id");
    // 1️⃣ Get treatment duration
    const { data: treatment } = await supabase
        .from("Treatment")
        .select("durationInMinutes")
        .eq("id", treatmentId)
        .eq("showOnWeb", true)
        .eq("organisation_id", organisation_id)
        .single();
    if (!treatment) {
        return c.json({ error: "Treatment not found" }, 404);
    }
    const duration = treatment.durationInMinutes;
    // 2️⃣ Get business hours
    const dayOfWeek = new Date(date).getDay();
    const { data: hours } = await supabase
        .from("OpeningHours")
        .select("opens_at, closes_at")
        .eq("Day", dayOfWeek)
        .eq("organisation_id", organisation_id)
        .single();
    if (!hours) {
        return c.json({ slots: [] });
    }
    const dayStart = combineDateAndTime(date, hours.opens_at);
    const dayEnd = combineDateAndTime(date, hours.closes_at);
    const now = new Date();
    const isToday = date === now.toISOString().slice(0, 10);
    // 3️⃣ Fetch bookings
    const { data: bookings } = await supabase
        .from("Booking")
        .select("appointmentStartTime, appointmentEndTime")
        // .neq("status", "cancelled")
        .gte("appointmentStartTime", dayStart.toISOString())
        .lte("appointmentEndTime", dayEnd.toISOString())
        .eq("organisation_id", organisation_id);
    // 4️⃣ Generate slots
    const slots = [];
    const slotIncrementMinutes = 10;
    for (let cursor = new Date(dayStart); cursor.getTime() + duration * 60000 <= dayEnd.getTime(); cursor = new Date(cursor.getTime() + slotIncrementMinutes * 60000)) {
        const slotStart = new Date(cursor);
        const slotEnd = new Date(slotStart.getTime() + duration * 60000);
        if (isToday && slotStart <= now) {
            continue;
        }
        const conflict = bookings?.some((b) => overlaps(slotStart, slotEnd, new Date(b.appointmentStartTime), new Date(b.appointmentEndTime)));
        if (!conflict) {
            slots.push(slotStart.toISOString().slice(11, 16));
        }
    }
    return c.json({
        date,
        treatmentId: treatmentId,
        durationInMinutes: duration,
        slots,
    });
});
export default bookings;
