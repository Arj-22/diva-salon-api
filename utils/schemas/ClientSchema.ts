import z from "zod";
import { emptyToUndefined } from "./common.js";

export const ClientSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(120, "Name must be at most 120 characters"),
    email: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .trim()
        .toLowerCase()
        .email("Invalid email address")
        .max(255, "Email must be at most 255 characters")
        .optional()
    ),
    phoneNumber: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .trim()
        .min(6, "Phone number must be at least 6 characters")
        .max(32, "Phone number must be at most 32 characters")
        .optional()
    ),
  })
  .strict();

export type ClientInput = z.infer<typeof ClientSchema>;
