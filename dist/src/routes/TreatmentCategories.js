import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { buildCacheKey, cacheInvalidate, cacheResponse, } from "../lib/cache-middleware.js";
import { TreatmentCategoryInsertSchema, TreatmentCategoryUpdateSchema, } from "../../utils/schemas/TreatmentCategorySchema.js";
import { formatZodError, parsePagination } from "../../utils/helpers.js";
const treatmentCategories = new Hono();
config({ path: ".env" });
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;
const parseActiveFilter = (c) => {
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
// GET / -> paginated + cached
treatmentCategories.get("/", cacheResponse({
    key: (c) => {
        const page = Number(c.req.query("page") || 1);
        const per = Number(c.req.query("perPage") || c.req.query("per") || 21);
        const active = c.req.query("active") || "";
        return buildCacheKey("treatmentCategories", {
            page,
            per,
            active,
        });
    },
    ttlSeconds: 300,
}), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const { page, perPage, start, end } = parsePagination(c);
    const activeFilter = parseActiveFilter(c);
    let query = supabase
        .from("TreatmentCategory")
        .select("*", { count: "exact" });
    if (typeof activeFilter === "boolean") {
        query = query.eq("showOnWeb", activeFilter);
    }
    const { data, error, count } = await query.range(start, end);
    if (error)
        return c.json({ error: error.message }, 500);
    const items = Array.isArray(data) ? data : [];
    const total = typeof count === "number" ? count : items.length;
    const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;
    return c.json({
        treatmentCategories: items,
        meta: {
            total,
            page,
            perPage,
            totalPages,
        },
    });
});
treatmentCategories.get("/activeSlugs", cacheResponse({
    key: () => buildCacheKey("treatmentCategories", {
        route: "activeSlugs",
    }),
    ttlSeconds: 300,
}), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const { data, error } = await supabase
        .from("TreatmentCategory")
        .select("href")
        .eq("showOnWeb", true);
    if (error)
        return c.json({ error: error.message }, 500);
    const slugs = Array.isArray(data)
        ? data.map((item) => item.href).filter((slug) => !!slug)
        : [];
    return c.json({ slugs });
});
treatmentCategories.get("/:id{[0-9]+}", cacheResponse({
    key: (c) => buildCacheKey("treatmentCategories", {
        route: "byId",
        id: c.req.param("id"),
    }),
    ttlSeconds: 300,
}), async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const id = Number(c.req.param("id"));
    const { data, error } = await supabase
        .from("TreatmentCategory")
        .select("*")
        .eq("id", id)
        .single();
    if (error)
        return c.json({ error: error.message }, 500);
    return c.json({ treatmentCategory: data });
});
treatmentCategories.post("/", async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const body = await c.req.json();
    const parsed = await TreatmentCategoryInsertSchema.safeParseAsync(body);
    if (!parsed.success) {
        return c.json(formatZodError(parsed.error), 400);
    }
    const { data, error } = await supabase
        .from("TreatmentCategory")
        .insert(parsed.data)
        .select()
        .single();
    if (error)
        return c.json({ error: error.message }, 500);
    void cacheInvalidate("treatmentCategories:*").catch(() => { });
    return c.json({ treatmentCategory: data }, 201);
});
treatmentCategories.patch("/:id{[0-9]+}", async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const body = await c.req.json();
    const parsed = await TreatmentCategoryUpdateSchema.safeParseAsync(body);
    if (!parsed.success) {
        return c.json(formatZodError(parsed.error), 400);
    }
    const { data, error } = await supabase
        .from("TreatmentCategory")
        .update(parsed.data)
        .eq("id", Number(c.req.param("id")))
        .select()
        .single();
    if (error)
        return c.json({ error: error.message }, 500);
    void cacheInvalidate("treatmentCategories:*").catch(() => { });
    return c.json({
        message: "Treatment category updated",
        treatmentCategory: data,
    });
});
treatmentCategories.post("/createCategoriesForEposCategories", async (c) => {
    if (!supabase)
        return c.json({ error: "Supabase not configured" }, 500);
    const { data: eposCategories, error: eposError } = await supabase
        .from("EposNowCategory")
        .select("*");
    if (eposError) {
        return c.json({ error: eposError.message }, 500);
    }
    if (!eposCategories || eposCategories.length === 0) {
        return c.json({ message: "No Epos Now categories found." });
    }
    const createdCategories = [];
    // Fetch all existing category IDs at once
    const { data: existingCats, error: existingCatsError } = await supabase
        .from("TreatmentCategory")
        .select("eposNowCategoryId");
    if (existingCatsError) {
        return c.json({ error: existingCatsError.message }, 500);
    }
    const existingCatIds = new Set(existingCats?.map((c) => c.eposNowCategoryId) || []);
    // Filter categories that do not already exist
    const categoriesToCreate = eposCategories.filter((eposCat) => !existingCatIds.has(eposCat.CategoryIdEpos));
    for (const eposCat of categoriesToCreate) {
        const { data: newCat, error: insertError } = await supabase
            .from("TreatmentCategory")
            .insert({
            name: eposCat.Name,
            description: eposCat.Description,
            eposNowCategoryId: eposCat.CategoryIdEpos,
            imageUrl: eposCat.ImageUrl,
        })
            .select()
            .single();
        if (insertError) {
            return c.json({ error: insertError.message }, 500);
        }
        createdCategories.push(newCat);
    }
    void cacheInvalidate("treatmentCategories:*").catch(() => { });
    return c.json({
        message: "Epos Now categories processed.",
        createdCount: createdCategories.length,
        createdCategories,
    });
});
export default treatmentCategories;
