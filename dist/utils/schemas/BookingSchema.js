import z from "zod";
export const BookingSchema = z
    .object({
    name: z.string().min(1),
    email: z.email(),
    phone: z.string().min(6).max(30).optional(),
    treatmentIds: z.array(z.coerce.number().int()),
    message: z.string().max(2000).optional(),
    hcaptcha_token: z.string().optional(),
})
    .strict();
