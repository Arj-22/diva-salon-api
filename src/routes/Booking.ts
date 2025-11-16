import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { validateBooking } from "../lib/validation-middleware.js";
import { cacheResponse } from "../lib/cache-middleware.js";
import { hcaptchaVerify } from "../lib/hcaptcha-middleware.js";
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

    const res = await c.req.json();

    const bookingData = {
      name: res.name,
      email: res.email,
      phone: res.phone,
      message: res.message,
      treatmentIds: res.treatmentIds,
    };

    const bookingPayload = {
      message: bookingData.message || null,
      clientId: 0, // Placeholder, will be updated after client creation
    };

    // 1. Find or create client
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

    // 2. Create booking (no upsert: always new)
    const { data: bookingRow, error: bookingError } = await supabase
      .from("Booking")
      .insert(bookingPayload)
      .select("id,message,clientId")
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

    // Build email payloads
    // const salonTo = process.env.SALON_NOTIFY_TO;
    // const userTo = bookingData.email?.toLowerCase().trim();

    // const treatmentList = bookingData.treatmentIds.join(", ");
    // const bookingId = bookingRow.id;

    // const userSubject = `Diva Salon: We received your booking request (#${bookingId})`;
    // const userHtml = `
    //   <p>Hi ${bookingData.name},</p>
    //   <p>Thanks for your booking request. We’ll review and get back to you shortly.</p>
    //   <p><strong>Details</strong></p>
    //   <ul>
    //     <li>Booking ID: ${bookingId}</li>
    //     <li>Treatments: ${treatmentList}</li>
    //     ${bookingData.message ? `<li>Message: ${bookingData.message}</li>` : ""}
    //     ${bookingData.phone ? `<li>Phone: ${bookingData.phone}</li>` : ""}
    //     ${bookingData.email ? `<li>Email: ${bookingData.email}</li>` : ""}
    //   </ul>
    //   <p>Kind regards,<br/>Diva Salon</p>
    // `;

    // const salonSubject = `New booking request (#${bookingId}) from ${bookingData.name}`;
    // const salonHtml = `
    //   <p>New booking received.</p>
    //   <ul>
    //     <li>Booking ID: ${bookingId}</li>
    //     <li>Name: ${bookingData.name}</li>
    //     ${bookingData.email ? `<li>Email: ${bookingData.email}</li>` : ""}
    //     ${bookingData.phone ? `<li>Phone: ${bookingData.phone}</li>` : ""}
    //     <li>Treatment IDs: ${treatmentList}</li>
    //     ${bookingData.message ? `<li>Message: ${bookingData.message}</li>` : ""}
    //     <li>Client ID: ${clientRow.id}</li>
    //   </ul>
    // `;

    // // Fire emails (don’t fail booking if email sending fails)
    // const tasks: Promise<any>[] = [];
    // if (userTo) {
    //   tasks.push(
    //     sendMail({
    //       to: userTo,
    //       subject: userSubject,
    //       html: userHtml,
    //       text: userHtml.replace(/<[^>]+>/g, ""),
    //     }).catch((e) => console.error("User email failed:", e))
    //   );
    // }
    // if (salonTo) {
    //   tasks.push(
    //     sendMail({
    //       to: salonTo,
    //       subject: salonSubject,
    //       html: salonHtml,
    //       text: salonHtml.replace(/<[^>]+>/g, ""),
    //     }).catch((e) => console.error("Salon email failed:", e))
    //   );
    // } else {
    //   console.warn(
    //     "SALON_NOTIFY_TO not set; skipping salon notification email"
    //   );
    // }
    // // Run without blocking response too long
    // void Promise.allSettled(tasks);

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

bookings.get("/", async (c) => {
  if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

  const { data, error } = await supabase
    .from("Booking")
    .select(
      `id, message, created_at, Client (id, name, email, phoneNumber), Treatment_Booking (treatmentId)`
    )
    .order("created_at", { ascending: false });

  if (error) {
    return c.json(
      { error: "Failed to fetch bookings", details: error.message },
      500
    );
  }

  // Transform to include treatmentIds array
  const bookings = data.map((booking) => ({
    id: booking.id,
    message: booking.message,
    created_at: booking.created_at,
    client: booking.Client,
    treatmentIds: booking.Treatment_Booking.map(
      (tb: { treatmentId: number }) => tb.treatmentId
    ),
  }));

  return c.json({ bookings });
});

bookings.get(
  "/byBookingId/:bookingId{[0-9]+}",
  cacheResponse({
    key: (c) => `bookings:bookingId:${c.req.param("bookingId")}`,
    ttlSeconds: 300,
  }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

    const id = Number(c.req.param("id"));
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
    key: (c) => `bookings:byClientId:${c.req.param("clientId")}`,
    ttlSeconds: 300,
  }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

    const clientId = Number(c.req.param("clientId"));
    const { data, error } = await supabase
      .from("Booking")
      .select(
        `*, Client(id, name, email, phoneNumber), Treatment_Booking (treatmentId)`
      )
      .eq("clientId", clientId)
      .order("created_at", { ascending: false });

    if (error) {
      return c.json(
        { error: "Failed to fetch bookings", details: error.message },
        500
      );
    }

    // Transform to include treatmentIds array
    const bookings = data.map((booking) => ({
      id: booking.id,
      message: booking.message,
      created_at: booking.created_at,
      client: booking.Client,
      treatmentIds: booking.Treatment_Booking.map(
        (tb: { treatmentId: number }) => tb.treatmentId
      ),
    }));

    return c.json({ bookings });
  }
);

export default bookings;
