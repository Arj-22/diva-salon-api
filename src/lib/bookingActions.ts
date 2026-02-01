import type { Context } from "hono";
import type { CreateBookingPayload } from "./types.js";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "./mailer.js";
import { bookingConfirmationTemplate } from "../../utils/emailTemplates/bookingConfirmation.js";
import { cacheInvalidate } from "./cache-middleware.js";

config({ path: ".env" });

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

export async function createBookingRecord(
  c: Context,
  payload: CreateBookingPayload,
) {
  if (!supabase) {
    return c.json({ error: "Supabase not configured" }, 500);
  }

  const bookingData = {
    name: payload.name,
    email: payload.email,
    phone: payload.phone,
    message: payload.message,
    treatmentId: payload.treatmentId,
    appointmentStartTime: payload.appointmentStartTime,
    organisation_id: payload.organisation_id,
    staffId: payload.staffId,
  };

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
        500,
      );
    }

    if (existingByEmail) {
      clientRow = existingByEmail;
    }
  }

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
        500,
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
        500,
      );
    }
    clientRow = createdClient;
    newClientCreated = true;
  }

  const { data: conflictingBooking, error: conflictCheckError } = await supabase
    .from("Booking")
    .select("id")
    .eq("appointmentStartTime", bookingData.appointmentStartTime)
    .eq("organisation_id", bookingData.organisation_id)
    .maybeSingle();

  if (conflictCheckError) {
    return c.json(
      {
        error: "Failed to verify booking availability",
        details: conflictCheckError.message,
      },
      500,
    );
  }

  if (conflictingBooking) {
    return c.json(
      { error: "This appointment start time is already booked" },
      409,
    );
  }

  const { data: treatmentRow, error: treatmentError } = await supabase
    .from("Treatment")
    .select("durationInMinutes")
    .eq("id", bookingData.treatmentId)
    .eq("organisation_id", bookingData.organisation_id)
    .single();

  if (treatmentError || !treatmentRow) {
    return c.json(
      { error: "Failed to load treatment duration" },
      treatmentError ? 500 : 404,
    );
  }

  const appointmentStart = new Date(bookingData.appointmentStartTime);
  const appointmentEndTime = new Date(
    appointmentStart.getTime() + treatmentRow.durationInMinutes * 60000,
  ).toISOString();

  const bookingPayload = {
    message: bookingData.message || null,
    clientId: clientRow.id,
    treatmentId: bookingData.treatmentId,
    appointmentStartTime: bookingData.appointmentStartTime,
    appointmentEndTime,
    organisation_id: bookingData.organisation_id,
    staffId: bookingData.staffId,
  };

  const { data: bookingRow, error: bookingError } = await supabase
    .from("Booking")
    .insert(bookingPayload)
    .select(
      "id, message, clientId, treatmentId, staffId, appointmentStartTime, appointmentEndTime, Treatment (*, EposNowTreatment(Name, SalePriceIncTax))",
    )
    .single();

  if (bookingError || !bookingRow) {
    if (newClientCreated) {
      await supabase.from("Client").delete().eq("id", clientRow.id);
    }
    return c.json(
      { error: "Failed to create booking", details: bookingError?.message },
      500,
    );
  }

  // @ts-ignore
  const treatment: EposNowTreatment = bookingRow.Treatment.EposNowTreatment;

  try {
    await sendEmail({
      to: [bookingData.email],
      subject: "New Booking Created",
      html: bookingConfirmationTemplate({
        name: bookingData.name,
        treatment,
        message: bookingData.message,
      }),
    });
  } catch (err) {
    console.error("Error sending email:", err);
    await supabase.from("Booking").delete().eq("id", bookingRow.id);
    return c.json({ error: "Failed to send email" }, 500);
  }

  cacheInvalidate("bookings:*");
  cacheInvalidate("availability:*");

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
        staffId: bookingRow.staffId,
      },
    },
    201,
  );
}
