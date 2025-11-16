import { Resend } from "resend";

let client: Resend | null = null;

function getClient() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Mailer misconfigured: set RESEND_API_KEY");
  if (!client) client = new Resend(key);
  return client;
}

export async function sendMail(opts: {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  from?: string;
}) {
  const from = opts.from || process.env.MAIL_FROM;
  if (!from) throw new Error("MAIL_FROM not set");

  const resend = getClient();

  if (!opts.html && !opts.text) {
    throw new Error("sendMail requires either html or text content");
  }

  const base = {
    from,
    to: Array.isArray(opts.to) ? opts.to : [opts.to],
    subject: opts.subject,
  };

  const res = await resend.emails.send(
    opts.html
      ? { ...base, html: opts.html }
      : { ...base, text: opts.text as string }
  );

  if ((res as any).error) {
    throw new Error(
      `Email send failed: ${(res as any).error.message || "unknown"}`
    );
  }
  return res;
}
