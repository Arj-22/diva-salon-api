import type { EposNowTreatment } from "../../src/lib/types.js";

export function bookingConfirmationTemplate(opts: {
  name: string;
  treatment: EposNowTreatment;
  message?: string;
}) {
  return `
<table width="100%" cellpadding="0" cellspacing="0" style="font-family: Arial, sans-serif; background:#f7f7f8; padding:24px;">
  <tr>
    <td>
      <table width="600" align="center" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:12px; padding:32px;">
        <tr><td style="font-size:18px; font-weight:600; color:#111;">Hi ${
          opts.name
        },</td></tr>
        <tr><td style="padding-top:16px; font-size:15px; color:#444;">Thanks for submitting your booking request to Diva Salon. We’ll be in touch soon.</td></tr>
        <tr>
          <td style="padding-top:24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ececec; border-radius:10px;">
              <tr><td style="padding:16px 20px; font-size:14px; font-weight:600; color:#222;">Requested treatments</td></tr>
              <tr><td style="padding:0 20px 20px 20px;">
                <ul style="margin:0; padding-left:18px; color:#444; font-size:14px; line-height:1.6;">${
                  opts.treatment.Name
                } - £${opts.treatment.SalePriceIncTax.toFixed(2)}</ul>
              </td></tr>
              <tr>      ${
                opts.message
                  ? `<p style="padding-top:16px; font-size:14px; color:#444;">Message: ${opts.message}</p>`
                  : ""
              }</tr>
            </table>
          </td>
        </tr>
        <tr><td style="padding-top:24px; font-size:14px; color:#666;">If anything looks wrong, reply to this email or call us.</td></tr>
        <tr><td style="padding-top:24px; font-size:15px; color:#111;">With thanks,<br/>The Diva Salon Team</td></tr>
      </table>

    </td>
  </tr>
</table>`;
}
