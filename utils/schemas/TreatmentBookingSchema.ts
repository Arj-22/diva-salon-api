import z from "zod";

export const TreatmentBookingSchema = z
  .object({
    bookingId: z.number().int().positive(),
    treatmentId: z.number().int().positive(),
    status: z.enum(["booked", "pending", "cancelled"]).optional(),
    appointmentTime: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().datetime().optional()
    ),
  })
  .strict();
export type TreatmentBookingInput = z.infer<typeof TreatmentBookingSchema>;

export const TreatmentBookingInsertSchema = TreatmentBookingSchema.extend({
  appointmentTime: z.string().datetime().optional(),
  status: z.enum(["booked", "pending", "cancelled"]).default("pending"),
});
// .omit({
//   hcaptcha_token: true, // handled separately server-side
// })
// .strict();

export const TreatmentBookingUpdateSchema = z
  .object({
    bookingId: z.number().int().positive().optional(),
    treatmentId: z.number().int().positive().optional(),
    status: z.enum(["booked", "pending", "cancelled"]).optional(),
    appointmentTime: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().datetime().optional()
    ),
  })
  .strict();
