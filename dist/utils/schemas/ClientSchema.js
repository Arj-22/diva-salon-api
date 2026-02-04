import z from "zod";
import { emptyToUndefined } from "./common.js";
export const ClientSchema = z
    .object({
    name: z
        .string()
        .trim()
        .min(1, "Name is required")
        .max(120, "Name must be at most 120 characters"),
    email: z.preprocess(emptyToUndefined, z
        .string()
        .trim()
        .toLowerCase()
        .email("Invalid email address")
        .max(255, "Email must be at most 255 characters")
        .optional()),
    phoneNumber: z.preprocess(emptyToUndefined, z
        .string()
        .trim()
        .min(6, "Phone number must be at least 6 characters")
        .max(32, "Phone number must be at most 32 characters")
        .optional()),
})
    .strict();
export const ClientUpdateSchema = z.object({
    name: z.string().optional(),
    firstName: z.string().trim().optional(),
    lastName: z.string().trim().optional(),
    email: z.string().email("Please provide a valid email").optional(),
    phoneNumber: z.string().trim().optional(),
});
