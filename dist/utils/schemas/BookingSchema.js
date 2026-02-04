import z from "zod";
export const BookingSchema = z
    .object({
    name: z.string().min(1),
    email: z.email(),
    phone: z.string().min(6).max(30).optional(),
    treatmentId: z.number().int().positive(),
    message: z.string().max(2000).optional(),
    appointmentStartTime: z.string().refine((val) => !isNaN(Date.parse(val)), {
        message: "Invalid start time",
    }),
    status: z.enum(["requested", "partial", "confirmed"]).optional(),
    staffId: z.number().int().positive().optional(),
    hcaptcha_token: z.string().optional(),
})
    .strict();
export const BookingUpdateSchema = BookingSchema.partial();
