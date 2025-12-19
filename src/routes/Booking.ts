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
import { parsePagination } from "../../utils/helpers.js";
// import { sendMail } from "../lib/mailer.js";

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
      treatmentIds: res.treatmentIds,
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

    // Define booking payload now with real clientId
    const bookingPayload = {
      message: bookingData.message || null,
      clientId: clientRow.id,
    };

    const { data: bookingRow, error: bookingError } = await supabase
      .from("Booking")
      .insert(bookingPayload)
      .select("id,message,clientId")
      .single();

    if (bookingError || !bookingRow) {
      console.error("Booking creation error:", bookingError);
      // Roll back newly created client if desired (best-effort)
      if (newClientCreated) {
        await supabase.from("Client").delete().eq("id", clientRow.id);
      }
      return c.json(
        { error: "Failed to create booking", details: bookingError?.message },
        500
      );
    }

    // 3. Link treatments
    const treatmentIds = Array.isArray(bookingData.treatmentIds)
      ? bookingData.treatmentIds
      : [];
    if (treatmentIds.length === 0) {
      // Clean up booking (and possibly client) if no treatments
      await supabase.from("Booking").delete().eq("id", bookingRow.id);
      if (newClientCreated) {
        await supabase.from("Client").delete().eq("id", clientRow.id);
      }
      return c.json({ error: "No treatmentIds provided" }, 400);
    }

    const treatmentBookingPayload = treatmentIds.map((tid: number) => ({
      treatmentId: tid,
      bookingId: bookingRow.id,
    }));

    const { error: tbError } = await supabase
      .from("Treatment_Booking")
      .insert(treatmentBookingPayload);

    if (tbError) {
      // Roll back booking and (optionally) client
      await supabase.from("Booking").delete().eq("id", bookingRow.id);
      if (newClientCreated) {
        await supabase.from("Client").delete().eq("id", clientRow.id);
      }
      return c.json(
        { error: "Failed to link treatments", details: tbError.message },
        500
      );
    }

    const { data: selectedTreatments, error: selectTreatmentsError } =
      await supabase
        .from("Treatment")
        .select(`EposNowTreatment(*)`)
        .in("id", treatmentIds);

    if (selectTreatmentsError) {
      console.error(
        "Failed to fetch selected treatments:",
        selectTreatmentsError
      );

      return c.json({ error: "Failed to fetch selected treatments" }, 500);
    }

    // Ensure the template receives a single EposNowTreatment object per item.
    const treatmentsForEmail = (selectedTreatments ?? [])
      .map((t: any) => {
        const epos = Array.isArray(t.EposNowTreatment)
          ? t.EposNowTreatment[0]
          : t.EposNowTreatment;
        return epos ? { EposNowTreatment: epos } : null;
      })
      .filter(Boolean) as { EposNowTreatment: any }[];

    try {
      await sendEmail({
        to: [bookingData.email],
        subject: "New Booking Created",
        html: bookingConfirmationTemplate({
          name: bookingData.name,
          treatments: treatmentsForEmail,
          message: bookingData.message,
        }),
      });
    } catch (err) {
      console.error("Error sending email:", err);
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
          treatmentIds,
          newClient: newClientCreated,
        },
      },
      201
    );
  }
);

bookings.patch("/:id{[0-9]+}", validateBooking(), async (c) => {
  if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

  const bookingId = Number(c.req.param("id"));
  const body = await c.req.json();
  const updateData: any = {};

  if (body.message !== undefined) {
    updateData.message = body.message;
  }
  if (body.clientId !== undefined) {
    updateData.clientId = body.clientId;
  }

  const payload = {
    ...body,
    updated_at: new Date().toISOString(),
  };

  const { data: updatedBooking, error: updateError } = await supabase
    .from("Booking")
    .update(payload)
    .eq("id", bookingId)
    .select("*")
    .single();

  if (updateError) {
    return c.json(
      { error: "Failed to update booking", details: updateError.message },
      500
    );
  }
  cacheInvalidate("bookings:*");

  return c.json({ booking: updatedBooking });
});

bookings.get(
  "/",
  cacheResponse({
    key: (c) => {
      const page = Number(c.req.query("page") || 1);
      const per = Number(c.req.query("perPage") || c.req.query("per") || 20);
      const status = c.req.query("status") || "all";

      return buildCacheKey("bookings", {
        page,
        per,
        status,
      });
    },
    ttlSeconds: 300,
  }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

    const { page, perPage, start, end } = parsePagination(c);
    const status = c.req.query("status") || "all";

    const query = supabase
      .from("Booking")
      .select(
        `id, message, clientId, status, created_at, Treatment_Booking (treatmentId)`,
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(start, end);

    if (status !== "all") {
      query.eq("status", status);
    }
    const { data, error, count } = await query;

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
      clientId: booking.clientId,
      status: booking.status,
      created_at: booking.created_at,
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
      .select(`*, clientId, Treatment_Booking (treatmentId)`, {
        count: "exact",
      })
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
      clientId: booking.clientId,
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
export default bookings;
