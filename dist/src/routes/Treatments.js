import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { cacheInvalidate, cacheResponse } from "../lib/cache-middleware.js";
import { TreatmentInsertSchema } from "../../utils/schemas/TreatmentSchema.js";
import { formatZodError, parsePagination } from "../../utils/helpers.js";
const treatments = new Hono();
config({ path: ".env" });
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;
const parseCategoryActive = (c) => {
    const raw = c.req.query("categoryActive");
    if (raw == null)
        return undefined;
    const normalized = raw.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized))
        return true;
    if (["false", "0", "no", "off"].includes(normalized))
        return false;
    return undefined;
};
const parseActiveFlag = (c) => {
    const raw = c.req.query("active");
    if (raw == null)
        return undefined;
    const normalized = raw.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized))
        return true;
    if (["false", "0", "no", "off"].includes(normalized))
        return false;
    return undefined;
};
treatments.get("/", cacheResponse({
    key: (c) => {
        const page = Number(c.req.query("page") || 1);
        const per = Number(c.req.query("perPage") || c.req.query("per") || 21);
        const active = c.req.query("active") || "";
        return `treatments:all:page:${page}:per:${per}:active:${active}`;
    },
    ttlSeconds: 300,
}), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const { page, perPage, start, end } = parsePagination(c);
    const active = parseActiveFlag(c);
    let query = supabase
        .from("Treatment")
        .select(`*, EposNowTreatment(Name, SalePriceExTax, SalePriceIncTax), TreatmentCategory(name, description), TreatmentSubCategory(name, description)`, { count: "exact" });
    if (typeof active === "boolean")
        query = query.eq("showOnWeb", active);
    const { data, error, count } = await query.range(start, end);
    if (error)
        return c.json({ error: error.message }, 500);
    const items = Array.isArray(data) ? data : [];
    const total = typeof count === "number" ? count : items.length;
    const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;
    return c.json({
        treatments: items,
        meta: { total, page, perPage, totalPages },
    });
});
treatments.get("/active", cacheResponse({
    key: (c) => {
        const page = Number(c.req.query("page") || 1);
        const per = Number(c.req.query("perPage") || c.req.query("per") || 20);
        return `treatments:active:page:${page}:per:${per}`;
    },
    ttlSeconds: 300,
}), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const { page, perPage, start, end } = parsePagination(c);
    const { data, error, count } = await supabase
        .from("Treatment")
        .select(`* ,EposNowTreatment(Name, SalePriceExTax, SalePriceIncTax),  TreatmentCategory (name, description) ,TreatmentSubCategory (name, description)`, { count: "exact" })
        .eq("showOnWeb", true)
        .range(start, end);
    if (error)
        return c.json({ error: error.message }, 500);
    const items = Array.isArray(data) ? data : [];
    const total = typeof count === "number" ? count : items.length;
    const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;
    return c.json({
        treatments: items,
        meta: { total, page, perPage, totalPages },
    });
});
treatments.get("/groupedByCategory", cacheResponse({
    key: (c) => {
        const page = Number(c.req.query("page") || 1);
        const per = Number(c.req.query("perPage") || c.req.query("per") || 20);
        const catActive = c.req.query("categoryActive") || "";
        return `treatments:groupedByCategory:page:${page}:per:${per}:cat:${catActive}`;
    },
    ttlSeconds: 300,
}), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const { page, perPage, start, end } = parsePagination(c);
    const catActive = parseCategoryActive(c);
    let query = supabase
        .from("Treatment")
        .select(`*, EposNowTreatment(Name, SalePriceExTax, SalePriceIncTax), TreatmentCategory(id, name, description, href), TreatmentSubCategory(name, description)`, { count: "exact" });
    if (typeof catActive === "boolean")
        query = query.eq("showOnWeb", catActive);
    const { data, error, count } = await query.range(start, end);
    if (error)
        return c.json({ error: error.message }, 500);
    const rows = Array.isArray(data) ? data : [];
    const groups = new Map();
    for (const row of rows) {
        const cat = row.TreatmentCategory || null;
        const key = cat?.id ?? "uncategorized";
        if (!groups.has(key)) {
            groups.set(key, {
                id: cat?.id ?? null,
                name: cat?.name ?? "Uncategorized",
                href: cat?.href ?? null,
                description: cat?.description ?? null,
                treatments: [],
            });
        }
        const { TreatmentCategory, ...treatment } = row;
        groups.get(key).treatments.push(treatment);
    }
    const categories = Array.from(groups.values()).sort((a, b) => {
        if (a.id === null)
            return 1;
        if (b.id === null)
            return -1;
        return String(a.name).localeCompare(String(b.name));
    });
    const total = typeof count === "number" ? count : rows.length;
    const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;
    return c.json({
        categories,
        meta: { total, page, perPage, totalPages },
    });
});
// byCategory
treatments.get("/byCategory/:treatmentCategoryId{[0-9]+}", cacheResponse({
    key: (c) => {
        const page = Number(c.req.query("page") || 1);
        const per = Number(c.req.query("perPage") || c.req.query("per") || 20);
        const catActive = c.req.query("categoryActive") || "";
        return `treatments:byCategory:${c.req.param("treatmentCategoryId")}:page:${page}:per:${per}:cat:${catActive}`;
    },
    ttlSeconds: 300,
}), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const treatmentCategoryId = Number(c.req.param("treatmentCategoryId"));
    const { page, perPage, start, end } = parsePagination(c);
    const catActive = parseCategoryActive(c);
    let query = supabase
        .from("Treatment")
        .select(`*, EposNowTreatment(Name, SalePriceExTax, SalePriceIncTax), TreatmentCategory(name, description), TreatmentSubCategory(name, description)`, { count: "exact" })
        .eq("treatmentCategoryId", treatmentCategoryId);
    if (typeof catActive === "boolean")
        query = query.eq("showOnWeb", catActive);
    const { data, error, count } = await query.range(start, end);
    if (error)
        return c.json({ error: error.message }, 500);
    const items = Array.isArray(data) ? data : [];
    const total = typeof count === "number" ? count : items.length;
    const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;
    return c.json({
        treatments: items,
        meta: { total, page, perPage, totalPages },
    });
});
// byCategorySlug (keeps inner join, only adds showOnWeb filter)
treatments.get("/byCategorySlug/:treatmentCategorySlug", cacheResponse({
    key: (c) => {
        const page = Number(c.req.query("page") || 1);
        const per = Number(c.req.query("perPage") || c.req.query("per") || 20);
        const active = c.req.query("active") || "";
        return `treatments:categorySlug:${c.req.param("treatmentCategorySlug")}:page:${page}:per:${per}:active:${active}`;
    },
    ttlSeconds: 300,
}), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const { page, perPage, start, end } = parsePagination(c);
    const treatmentCategorySlug = c.req.param("treatmentCategorySlug");
    const active = parseActiveFlag(c);
    let query = supabase
        .from("Treatment")
        .select(`*,
         EposNowTreatment(Name, SalePriceExTax, SalePriceIncTax),
         TreatmentCategory!inner(id, name, description, href),
         TreatmentSubCategory(name, description)`, { count: "exact" })
        .eq("TreatmentCategory.href", treatmentCategorySlug);
    if (typeof active === "boolean") {
        query = query.eq("showOnWeb", active);
    }
    const { data, error, count } = await query.range(start, end);
    if (error)
        return c.json({ error: error.message }, 500);
    const items = Array.isArray(data) ? data : [];
    const total = typeof count === "number" ? count : items.length;
    const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;
    return c.json({
        treatments: items,
        meta: { total, page, perPage, totalPages },
    });
});
treatments.post("/", async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const body = await c.req.json();
    const parsed = await TreatmentInsertSchema.safeParseAsync(body);
    if (!parsed.success) {
        return c.json(formatZodError(parsed.error), 400);
    }
    const { data, error } = await supabase
        .from("Treatment")
        .insert(parsed.data)
        .select()
        .single();
    if (error)
        return c.json({ error: error.message }, 500);
    void cacheInvalidate("treatments:*").catch(() => { });
    return c.json({ treatment: data }, 201);
});
treatments.post("/createForEposTreatments", async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const { data: eposTreatments, error: eposError } = await supabase
        .from("EposNowTreatment")
        .select("*");
    if (eposError) {
        return c.json({ error: eposError.message }, 500);
    }
    let createdCount = 0;
    // Fetch all existing eposNowTreatmentId values once
    const { data: existingTreatments, error: existingError } = await supabase
        .from("Treatment")
        .select("eposNowTreatmentId");
    if (existingError) {
        return c.json({ error: existingError.message }, 500);
    }
    const existingIds = new Set((existingTreatments ?? []).map((t) => t.eposNowTreatmentId));
    for (const eposTreatment of eposTreatments) {
        // Use EposNowId for comparison, as used in insert
        if (existingIds.has(eposTreatment.EposNowId)) {
            continue;
        }
        const { error: insertError } = await supabase
            .from("Treatment")
            .insert({
            description: eposTreatment.Description,
            eposNowTreatmentId: eposTreatment.EposNowId,
            imageUrl: eposTreatment.ImageUrl ?? null,
        })
            .select()
            .single();
        if (insertError) {
            console.error(`Failed to create treatment for EposNowTreatment ID ${eposTreatment.Id}: ${insertError.message}`);
            continue;
        }
        createdCount++;
    }
    void cacheInvalidate("treatments:*").catch(() => { });
    return c.json({
        message: `Created ${createdCount} treatments for Epos Now treatments.`,
    });
});
treatments.patch("/:id{[0-9]+}", async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const idParam = c.req.param("id");
    const treatmentId = Number(idParam);
    if (isNaN(treatmentId)) {
        return c.json({ error: "Invalid ID" }, 400);
    }
    const body = await c.req.json();
    // Partial for updates
    const parsed = await TreatmentInsertSchema.partial().safeParseAsync(body);
    if (!parsed.success) {
        return c.json(formatZodError(parsed.error), 400);
    }
    const { data, error } = await supabase
        .from("Treatment")
        .update(parsed.data)
        .eq("id", treatmentId)
        .select()
        .single();
    if (error)
        return c.json({ error: error.message }, 500);
    void cacheInvalidate("treatments:*").catch(() => { });
    return c.json({
        message: "Treatment updated successfully",
        treatment: data,
    });
});
export default treatments;
