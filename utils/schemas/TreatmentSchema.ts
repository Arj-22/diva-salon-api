import * as z from "zod";

export const TreatmentSchema = z.object({
  id: z.number().int(),
  eposNowTreatmentId: z.number().int(),
  description: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  href: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  created_at: z.string(),
  treatmentCategoryId: z.number().int(),
  treatmentSubCategoryId: z.number().int().optional(),
});

export const TreatmentInsertSchema = TreatmentSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
}).extend({
  eposNowTreatmentId: z.coerce.number().positive(),
  treatmentCategoryId: z.coerce.number().positive(),
  treatmentSubCategoryId: z.coerce.number().positive().nullable().optional(),
});

export type Treatment = z.infer<typeof TreatmentSchema>;
