import { ZodError } from "zod";
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
