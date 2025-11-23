import * as z from "zod";
import { SlugSchema } from "./common.js";
const emptyToUndefined = (v) => (v === "" ? undefined : v);
// Base row schema (matches DB/returned shape)
export const TreatmentCategorySchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.preprocess(emptyToUndefined, z.string().optional()),
    imageUrl: z.preprocess(emptyToUndefined, z.string().optional()),
    href: z.preprocess(emptyToUndefined, SlugSchema.optional()),
    updated_at: z.preprocess(emptyToUndefined, z.string().optional()),
    created_at: z.preprocess(emptyToUndefined, z.string().optional()),
});
// Insert payload (omit DB-managed fields)
export const TreatmentCategoryInsertSchema = TreatmentCategorySchema.omit({
    id: true,
    created_at: true,
    updated_at: true,
});
// Update payload (all fields optional)
export const TreatmentCategoryUpdateSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.preprocess(emptyToUndefined, z.string().optional()),
    imageUrl: z.preprocess(emptyToUndefined, z.string().optional()),
    href: z.preprocess(emptyToUndefined, SlugSchema.optional()),
});
