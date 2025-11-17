import { Resend } from "resend";

const resend = new Resend("re_2ek2W2D4_Jx8ExU54qivwbfwgci6wpuPf");

interface EmailData {
  to: string[];
  subject: string;
  html: string;
}

export const sendEmail = async (emailData: EmailData) => {
  const { data, error } = await resend.emails.send({
    from: "Acme <onboarding@resend.dev>",
    to: emailData.to,
    subject: emailData.subject,
    html: emailData.html,
  });

  if (error) {
    return console.error({ error });
  }

  return data;
};
