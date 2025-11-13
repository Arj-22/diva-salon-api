import * as z from "zod";

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

// Slug (href) like "hair-treatments"
const SlugSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Must be a URL-friendly slug (lowercase, hyphens)"
  );

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

export type TreatmentCategory = z.infer<typeof TreatmentCategorySchema>;

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

export type TreatmentCategoryInsert = z.infer<
  typeof TreatmentCategoryInsertSchema
>;
export type TreatmentCategoryUpdate = z.infer<
  typeof TreatmentCategoryUpdateSchema
>;
