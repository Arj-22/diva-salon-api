import z from "zod";
import { ClientSchema } from "./ClientSchema.js";
export const FormSubmissionSchema = ClientSchema.extend({
    hcaptcha_token: z.string().optional(),
    message: z
        .string()
        .trim()
        .min(1, "Message is required")
        .max(2000, "Message must be at most 2000 characters"),
})
    .superRefine((data, ctx) => {
    if (!data.email && !data.phoneNumber) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Email or phone number is required",
            path: ["email"],
        });
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Email or phone number is required",
            path: ["phoneNumber"],
        });
    }
})
    .strict();
