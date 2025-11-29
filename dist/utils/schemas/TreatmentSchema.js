import * as z from "zod";
import { emptyToUndefined, SlugSchema } from "./common.js";
export const TreatmentSchema = z.object({
    id: z.number().int(),
    eposNowTreatmentId: z.number().int(),
    description: z.string().nullable().optional(),
    imageUrl: z.string().nullable().optional(),
    href: z.preprocess(emptyToUndefined, SlugSchema.nullable().optional()),
    updated_at: z.string().nullable().optional(),
    created_at: z.string(),
    treatmentCategoryId: z.number().int(),
    treatmentSubCategoryId: z.number().int().optional(),
    showOnWeb: z.boolean().optional(),
});
export const TreatmentInsertSchema = TreatmentSchema.omit({
    id: true,
    created_at: true,
    updated_at: true,
}).extend({
    eposNowTreatmentId: z.coerce.number().positive(),
    treatmentCategoryId: z.coerce.number().positive(),
    treatmentSubCategoryId: z
        .union([z.coerce.number().positive(), z.null()])
        .optional(),
    showOnWeb: z.boolean().optional(),
});
