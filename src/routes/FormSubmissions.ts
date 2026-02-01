import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { formatZodError } from "../../utils/helpers.js";
import {
  FormSubmissionSchema,
  type FormSubmissionInput,
} from "../../utils/schemas/FormSubmissionSchema.js";
import { hcaptchaVerify } from "../lib/hcaptcha-middleware.js";

const formSubmissions = new Hono();
config({ path: ".env" });

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

type ClientRecord = {
  id: number;
  name: string;
  email: string | null;
  phoneNumber: string | null;
};

formSubmissions.post(
  "/",
  hcaptchaVerify({ bodyField: "hcaptcha_token" }),
  async (c) => {
    if (!supabase) return c.json({ error: "Supabase not configured" }, 500);

    //@ts-ignore
    const organisation_id = c.get("organisation_id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = FormSubmissionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(formatZodError(parsed.error), 400);
    }

    const submission: FormSubmissionInput = parsed.data;
    let clientRow: ClientRecord | null = null;
    let newClientCreated = false;

    if (submission.email) {
      const { data, error } = await supabase
        .from("Client")
        .select("id,name,email,phoneNumber")
        .eq("email", submission.email)
        .eq("organisation_id", organisation_id)
        .limit(1)
        .maybeSingle();

      if (error) {
        return c.json(
          { error: "Failed to lookup client by email", details: error.message },
          500,
        );
      }

      if (data) clientRow = data;
    }

    if (!clientRow) {
      const { data, error } = await supabase
        .from("Client")
        .insert({
          name: submission.name,
          email: submission.email ?? null,
          phoneNumber: submission.phoneNumber ?? null,
          organisation_id: organisation_id,
        })
        .select("id,name,email,phoneNumber")
        .single();

      if (error || !data) {
        const isConflict = error?.code === "23505";
        return c.json(
          {
            error: isConflict
              ? "Client already exists"
              : "Failed to create client",
            details: error?.message,
          },
          isConflict ? 409 : 500,
        );
      }

      clientRow = data;
      newClientCreated = true;
    }

    const { data: submissionRow, error: formSubmissionError } = await supabase
      .from("FormSubmissions")
      .insert({
        clientId: clientRow.id,
        message: submission.message,
        organisation_id: organisation_id,
      })
      .select("id,clientId,message,created_at")
      .single();

    if (formSubmissionError || !submissionRow) {
      return c.json(
        {
          error: "Failed to save form submission",
          details: formSubmissionError?.message,
        },
        500,
      );
    }

    return c.json(
      {
        formSubmission: submissionRow,
        client: clientRow,
        newClient: newClientCreated,
      },
      201,
    );
  },
);

export default formSubmissions;
