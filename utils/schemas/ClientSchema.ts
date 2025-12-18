import z from "zod";

export const clientInsertSchema = z.object({
  name: z.string().min(1, "Name is required"),
  firstName: z.string().trim().optional(),
  lastName: z.string().trim().optional(),
  email: z.string().email("Please provide a valid email").optional(),
  phoneNumber: z.string().trim().optional(),
});
export const ClientUpdateSchema = z.object({
  name: z.string().optional(),
  firstName: z.string().trim().optional(),
  lastName: z.string().trim().optional(),
  email: z.string().email("Please provide a valid email").optional(),
  phoneNumber: z.string().trim().optional(),
});

export type ClientFormValues = z.infer<typeof clientInsertSchema>;
export const ClientCreateSchema = ClientUpdateSchema.extend({
  name: z.string().min(1, "Name is required"),
});

export type ClientCreateFormValues = z.infer<typeof ClientCreateSchema>;
export const ClientPatchSchema = ClientUpdateSchema.partial();
export type ClientPatchFormValues = z.infer<typeof ClientPatchSchema>;
