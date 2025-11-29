import { ZodError } from "zod";
import type { RawEposCategory } from "../src/lib/types.js";
export const emptyToNull = <T extends Record<string, any>>(obj: T): T => {
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v === "" ? null : v;
  return out as T;
};

function serializeIssue(issue: ZodError["issues"][number]) {
  const base: any = {
    path: issue.path, // ["href"]
    code: issue.code, // e.g. "invalid_string" (regex), "invalid_type"
    message: issue.message, // friendly message
  };

  // Add optional fields when present
  const anyIssue = issue as any;
  if ("expected" in anyIssue) base.expected = anyIssue.expected;
  if ("received" in anyIssue) base.received = anyIssue.received;
  if ("validation" in anyIssue) base.validation = anyIssue.validation; // "regex", "email", etc.
  if ("minimum" in anyIssue) base.minimum = anyIssue.minimum;
  if ("maximum" in anyIssue) base.maximum = anyIssue.maximum;
  if ("inclusive" in anyIssue) base.inclusive = anyIssue.inclusive;
  if ("exact" in anyIssue) base.exact = anyIssue.exact;
  if ("pattern" in anyIssue) base.pattern = anyIssue.pattern; // for regex-like libs
  return base;
}

export function formatZodError(err: ZodError) {
  return {
    error: "Validation failed",
    issues: err.issues.map(serializeIssue),
  };
}

export function flattenCategories(
  categories: RawEposCategory[]
): RawEposCategory[] {
  const flat: RawEposCategory[] = [];

  const visit = (cat: RawEposCategory, parentId: number | null) => {
    const self: RawEposCategory = {
      Id: cat.Id,
      ParentId: parentId ?? cat.ParentId ?? null,
      RootParentId: cat.RootParentId ?? parentId ?? null,
      Name: cat.Name,
      Description: cat.Description ?? null,
      ImageUrl: cat.ImageUrl ?? null,
      ShowOnTill: Boolean(cat.ShowOnTill),
    };
    flat.push(self);

    if (Array.isArray(cat.Children)) {
      for (const child of cat.Children) {
        visit(child, cat.Id);
      }
    }
  };

  for (const top of categories) {
    visit(top, top.ParentId ?? null);
  }
  return flat;
}

export const parsePagination = (c: any) => {
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const perPageRaw = Number(c.req.query("perPage") || c.req.query("per") || 21);
  const perPage = Math.min(Math.max(1, perPageRaw || 21), 200);
  const start = (page - 1) * perPage;
  const end = start + perPage - 1;
  return { page, perPage, start, end };
};
