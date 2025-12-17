import z, { email } from "zod";

export const BookingSchema = z
  .object({
    name: z.string().min(1),
    email: z.email(),
    phone: z.string().min(6).max(30).optional(),
    treatmentIds: z.array(z.coerce.number().int()),
    message: z.string().max(2000).optional(),
    status: z.enum(["requested", "confirmed", "partial"]).optional(),
    hcaptcha_token: z.string().optional(),
  })
  .strict();
export type BookingInput = z.infer<typeof BookingSchema>;

export const BookingUpdateSchema = z.object({
  treatmentIds: z.array(z.coerce.number().int().positive()).optional(),
  status: z.enum(["requested", "confirmed", "partial"]).default("requested"),
  message: z.string().max(2000).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(6).max(30).optional(),

  // marketingOptIn: z.coerce.boolean().optional(),
  // preferredDate: z.preprocess(
  //   (v) => (v === "" ? undefined : v),
  //   z.string().datetime().optional()
  // ),
});
// .omit({
//   hcaptcha_token: true, // handled separately server-side
// })
// .strict();
