import z from "zod";

export const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

export const SlugSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Must be a URL-friendly slug (lowercase, hyphens)"
  );
