import * as z from "zod";
import { emptyToUndefined, SlugSchema } from "./common.js";

export const TreatmentSubCategorySchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  description: z.preprocess(emptyToUndefined, z.string().nullable().optional()),
  href: z.preprocess(emptyToUndefined, SlugSchema.nullable().optional()),
  imageUrl: z.preprocess(emptyToUndefined, z.string().nullable().optional()),
  treatmentCategoryId: z.number().int(),
  updated_at: z.preprocess(emptyToUndefined, z.string().optional()),
  created_at: z.string(),
});

export type TreatmentSubCategory = z.infer<typeof TreatmentSubCategorySchema>;

export const TreatmentSubCategoryInsertSchema = TreatmentSubCategorySchema.omit(
  {
    id: true,
    created_at: true,
    updated_at: true,
  }
).extend({
  treatmentCategoryId: z.coerce.number().int().positive(),
});
