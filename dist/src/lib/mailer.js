import { config } from "dotenv";
import { Resend } from "resend";
config();
const resend = new Resend(process.env.RESEND_API_KEY);
export const sendEmail = async (emailData) => {
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
