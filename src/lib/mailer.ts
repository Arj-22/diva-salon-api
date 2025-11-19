import { Resend } from "resend";

const resend = new Resend("re_2ek2W2D4_Jx8ExU54qivwbfwgci6wpuPf");

interface EmailData {
  to: string[];
  subject: string;
  html: string;
}

export const sendEmail = async (emailData: EmailData) => {
  const { data, error } = await resend.emails.send({
    from: "Diva Salon <info@divasalonandacademy.co.uk>",
    to: emailData.to,
    bcc: ["info@divasalonandacademy.co.uk"],
    subject: emailData.subject,
    html: emailData.html,
  });

  if (error) {
    return console.error({ error });
  }

  return data;
};
