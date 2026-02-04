import { ZodError } from "zod";
export const emptyToNull = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj))
        out[k] = v === "" ? null : v;
    return out;
};
function serializeIssue(issue) {
    const base = {
        path: issue.path, // ["href"]
        code: issue.code, // e.g. "invalid_string" (regex), "invalid_type"
        message: issue.message, // friendly message
    };
    // Add optional fields when present
    const anyIssue = issue;
    if ("expected" in anyIssue)
        base.expected = anyIssue.expected;
    if ("received" in anyIssue)
        base.received = anyIssue.received;
    if ("validation" in anyIssue)
        base.validation = anyIssue.validation; // "regex", "email", etc.
    if ("minimum" in anyIssue)
        base.minimum = anyIssue.minimum;
    if ("maximum" in anyIssue)
        base.maximum = anyIssue.maximum;
    if ("inclusive" in anyIssue)
        base.inclusive = anyIssue.inclusive;
    if ("exact" in anyIssue)
        base.exact = anyIssue.exact;
    if ("pattern" in anyIssue)
        base.pattern = anyIssue.pattern; // for regex-like libs
    return base;
}
export function formatZodError(err) {
    return {
        error: "Validation failed",
        issues: err.issues.map(serializeIssue),
    };
}
export function flattenCategories(categories) {
    const flat = [];
    const visit = (cat, parentId) => {
        const self = {
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
export const parsePagination = (c) => {
    const page = Math.max(1, Number(c.req.query("page") || 1));
    const perPageRaw = Number(c.req.query("perPage") || c.req.query("per") || 21);
    const perPage = Math.min(Math.max(1, perPageRaw || 21), 200);
    const start = (page - 1) * perPage;
    const end = start + perPage - 1;
    return { page, perPage, start, end };
};
export function overlaps(slotStart, slotEnd, bookingStart, bookingEnd) {
    return slotStart < bookingEnd && slotEnd > bookingStart;
}
export function combineDateAndTime(dateStr, timeStr) {
    // Strip timezone if present (e.g. 10:00:00+00)
    const cleanTime = timeStr.split("+")[0];
    const [year, month, day] = dateStr.split("-").map(Number);
    // Parse time components more defensively to avoid non-numeric seconds (e.g. "10:00:00.123")
    const [hoursStr = "0", minutesStr = "0", secondsStr = "0"] = cleanTime.split(":");
    // Strip fractional seconds and any non-digits from the seconds component while preserving leading digits
    const secondsMainPart = secondsStr.split(".")[0].replace(/[^0-9]/g, "");
    const hours = Number(hoursStr);
    const minutes = Number(minutesStr);
    const seconds = secondsMainPart === "" ? 0 : Number(secondsMainPart);
    return new Date(year, month - 1, day, hours, minutes, seconds);
}
