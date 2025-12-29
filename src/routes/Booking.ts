import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { validateBooking } from "../lib/validation-middleware.js";
import {
  buildCacheKey,
  cacheInvalidate,
  cacheResponse,
} from "../lib/cache-middleware.js";
import { hcaptchaVerify } from "../lib/hcaptcha-middleware.js";
import { sendEmail } from "../lib/mailer.js";
import { bookingConfirmationTemplate } from "../../utils/emailTemplates/bookingConfirmation.js";
import {
  combineDateAndTime,
  overlaps,
  parsePagination,
} from "../../utils/helpers.js";
import type { EposNowTreatment } from "../lib/types.js";

const bookings = new Hono();
config({ path: ".env" });

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

bookings.post(
  "/",
  hcaptchaVerify({ bodyField: "hcaptcha_token" }),
  validateBooking(),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

    // Use validated booking data (avoid re-parsing)
    const res = await c.req.json();
    const bookingData = {
      name: res.name,
      email: res.email,
      phone: res.phone,
      message: res.message,
      treatmentId: res.treatmentId,
      appointmentStartTime: res.appointmentStartTime,
    };

    // Find or create client
    const emailLower = bookingData.email?.toLowerCase().trim();
    let clientRow: {
      id: number;
      name: string;
      email: string | null;
      phoneNumber: string | null;
    } | null = null;
    let newClientCreated = false;

    if (emailLower) {
      const { data: existingByEmail, error: findEmailError } = await supabase
        .from("Client")
        .select("id,name,email,phoneNumber")
        .eq("email", emailLower)
        .limit(1)
        .maybeSingle();

      if (findEmailError) {
        return c.json(
          {
            error: "Failed to query client by email",
            details: findEmailError.message,
          },
          500
        );
      }

      if (existingByEmail) {
        clientRow = existingByEmail;
      }
    }

    // Optional fallback: if no email or not found, try phone match
    if (!clientRow && bookingData.phone) {
      const phoneNorm = bookingData.phone.trim();
      const { data: existingByPhone, error: findPhoneError } = await supabase
        .from("Client")
        .select("id,name,email,phoneNumber")
        .eq("phoneNumber", phoneNorm)
        .limit(1)
        .maybeSingle();

      if (findPhoneError) {
        return c.json(
          {
            error: "Failed to query client by phone",
            details: findPhoneError.message,
          },
          500
        );
      }

      if (existingByPhone) {
        clientRow = existingByPhone;
      }
    }

    if (!clientRow) {
      const { data: createdClient, error: createClientError } = await supabase
        .from("Client")
        .insert({
          name: bookingData.name,
          email: emailLower || null,
          phoneNumber: bookingData.phone?.trim() || null,
        })
        .select("id,name,email,phoneNumber")
        .single();
      if (createClientError || !createdClient) {
        return c.json(
          {
            error: "Failed to create client",
            details: createClientError?.message,
          },
          500
        );
      }
      clientRow = createdClient;
      newClientCreated = true;
    }

    const appointmentStart = new Date(bookingData.appointmentStartTime);

    const { data: conflictingBooking, error: conflictCheckError } =
      await supabase
        .from("Booking")
        .select("id")
        .eq("appointmentStartTime", bookingData.appointmentStartTime)
        .maybeSingle();

    if (conflictCheckError) {
      return c.json(
        {
          error: "Failed to verify booking availability",
          details: conflictCheckError.message,
        },
        500
      );
    }

    if (conflictingBooking) {
      return c.json(
        { error: "This appointment start time is already booked" },
        409
      );
    }

    const treatmentDurationMinutes = await supabase
      .from("Treatment")
      .select("durationInMinutes")
      .eq("id", bookingData.treatmentId)
      .single();
    const appointmentEndTime = new Date(
      appointmentStart.getTime() +
        treatmentDurationMinutes.data?.durationInMinutes * 60000
    ).toISOString();
    // Define booking payload now with real clientId
    const bookingPayload = {
      message: bookingData.message || null,
      clientId: clientRow.id,
      treatmentId: bookingData.treatmentId,
      appointmentStartTime: bookingData.appointmentStartTime,
      appointmentEndTime: appointmentEndTime,
    };

    const { data: bookingRow, error: bookingError } = await supabase
      .from("Booking")
      .insert(bookingPayload)
      .select(
        "id,message,clientId,treatmentId, appointmentStartTime, appointmentEndTime, Treatment (*, EposNowTreatment(Name, SalePriceIncTax))"
      )
      .single();

    if (bookingError || !bookingRow) {
      // Roll back newly created client if desired (best-effort)
      if (newClientCreated) {
        await supabase.from("Client").delete().eq("id", clientRow.id);
      }
      return c.json(
        { error: "Failed to create booking", details: bookingError?.message },
        500
      );
    }

    // Ensure the template receives a single EposNowTreatment object per item.
    // @ts-ignore
    const treatment: EposNowTreatment = bookingRow.Treatment.EposNowTreatment;

    try {
      await sendEmail({
        to: [bookingData.email],
        subject: "New Booking Created",
        html: bookingConfirmationTemplate({
          name: bookingData.name,
          treatment: treatment,
          message: bookingData.message,
        }),
      });
    } catch (err) {
      console.error("Error sending email:", err);
      await supabase.from("Booking").delete().eq("id", bookingRow.id);
      return c.json({ error: "Failed to send email" }, 500);
    }
    cacheInvalidate("bookings:*");

    return c.json(
      {
        message: "Booking created",
        booking: {
          id: bookingRow.id,
          message: bookingRow.message,
          client: clientRow,
          treatmentId: bookingRow.treatmentId,
          appointmentStartTime: bookingRow.appointmentStartTime,
          appointmentEndTime: bookingRow.appointmentEndTime,
          newClient: newClientCreated,
        },
        // bookingRow,
      },
      201
    );
  }
);

bookings.get(
  "/",
  cacheResponse({
    key: (c) => {
      const page = Number(c.req.query("page") || 1);
      const per = Number(c.req.query("perPage") || c.req.query("per") || 20);

      return buildCacheKey("bookings", {
        page,
        per,
      });
    },
    ttlSeconds: 300,
  }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

    const { page, perPage, start, end } = parsePagination(c);

    const { data, error, count } = await supabase
      .from("Booking")
      .select(
        `id, message, created_at, Client (id, name, email, phoneNumber), Treatment_Booking (treatmentId)`,
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(start, end);

    if (error) {
      return c.json(
        { error: "Failed to fetch bookings", details: error.message },
        500
      );
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
      treatmentIds: booking.Treatment_Booking.map(
        (tb: { treatmentId: number }) => tb.treatmentId
      ),
    }));

    return c.json({
      bookings: bookingsList,
      meta: { total, page, perPage, totalPages },
    });
  }
);

bookings.get(
  "/byBookingId/:bookingId{[0-9]+}",
  cacheResponse({
    key: (c) =>
      buildCacheKey("bookings", {
        route: "byBookingId",
        bookingId: c.req.param("bookingId"),
      }),
    ttlSeconds: 300,
  }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);
    const id = Number(c.req.param("bookingId"));
    const { data, error } = await supabase
      .from("Booking")
      .select(
        `id, message, created_at, Client (id, name, email, phoneNumber), Treatment_Booking (treatmentId)`
      )
      .eq("id", id)
      .single();

    if (error) {
      return c.json(
        { error: "Failed to fetch booking", details: error.message },
        500
      );
    }

    if (!data) {
      return c.json({ error: "Booking not found" }, 404);
    }

    const booking = {
      id: data.id,
      message: data.message,
      created_at: data.created_at,
      client: data.Client,
      treatmentIds: data.Treatment_Booking.map((tb) => tb.treatmentId),
    };

    return c.json({ booking });
  }
);

bookings.get(
  "/byClientId/:clientId{[0-9]+}",
  cacheResponse({
    key: (c) => {
      const page = Number(c.req.query("page") || 1);
      const per = Number(c.req.query("perPage") || c.req.query("per") || 20);

      return buildCacheKey("bookings", {
        route: "byClientId",
        clientId: c.req.param("clientId"),
        page,
        per,
      });
    },
    ttlSeconds: 300,
  }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

    const clientId = Number(c.req.param("clientId"));
    const { page, perPage, start, end } = parsePagination(c);

    const { data, error, count } = await supabase
      .from("Booking")
      .select(
        `*, Client(id, name, email, phoneNumber), Treatment_Booking (treatmentId)`,
        { count: "exact" }
      )
      .eq("clientId", clientId)
      .order("created_at", { ascending: false })
      .range(start, end);

    if (error) {
      return c.json(
        { error: "Failed to fetch bookings", details: error.message },
        500
      );
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
      treatmentIds: booking.Treatment_Booking.map(
        (tb: { treatmentId: number }) => tb.treatmentId
      ),
    }));

    return c.json({
      bookings: bookingsList,
      meta: { total, page, perPage, totalPages },
    });
  }
);

bookings.get(
  "/availability",
  cacheResponse({
    key: (c) => {
      const treatmentId = c.req.query("treatmentId");
      const date = c.req.query("date");
      return buildCacheKey("bookings", {
        route: "availability",
        treatmentId,
        date,
      });
    },
    ttlSeconds: 60,
  }),
  async (c) => {
    const treatmentId = c.req.query("treatmentId");
    const date = c.req.query("date"); // YYYY-MM-DD

    if (!treatmentId || !date) {
      return c.json({ error: "Missing parameters" }, 400);
    }

    if (!supabase) {
      return c.json({ error: "Supabase not configured" }, 500);
    }

    // 1️⃣ Get treatment duration
    const { data: treatment } = await supabase
      .from("Treatment")
      .select("durationInMinutes")
      .eq("id", treatmentId)
      .eq("showOnWeb", true)
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
      .lte("appointmentEndTime", dayEnd.toISOString());

    // 4️⃣ Generate slots
    const SLOT_STEP = duration;
    const slots: string[] = [];

    for (
      let cursor = new Date(dayStart);
      cursor.getTime() + duration * 60000 <= dayEnd.getTime();
      cursor = new Date(cursor.getTime() + SLOT_STEP * 60000)
    ) {
      const slotStart = new Date(cursor);
      const slotEnd = new Date(slotStart.getTime() + duration * 60000);

      if (isToday && slotStart <= now) {
        continue;
      }

      const conflict = bookings?.some((b) =>
        overlaps(
          slotStart,
          slotEnd,
          new Date(b.appointmentStartTime),
          new Date(b.appointmentEndTime)
        )
      );

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
  }
);

export default bookings;
