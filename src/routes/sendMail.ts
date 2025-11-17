import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { Resend } from "resend";

const email = new Hono();
config({ path: ".env" });

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const resend = new Resend("re_2ek2W2D4_Jx8ExU54qivwbfwgci6wpuPf");
const sendEmail = async () => {
  const { data, error } = await resend.emails.send({
    from: "Acme <onboarding@resend.dev>",
    to: ["arjunnahar1234@gmail.com"],
    subject: "Hello World",
    html: "<strong>It works!</strong>",
  });

  if (error) {
    return console.error({ error });
  }

  console.log({ data });
};

email.post("/send", async (c) => {
  console.log("Send email endpoint hit");

  try {
    await sendEmail();
  } catch (err) {
    console.error("Error sending email:", err);
    return c.json({ error: "Failed to send email" }, 500);
  }

  return c.json({ message: "Sent" });
});

export default email;
