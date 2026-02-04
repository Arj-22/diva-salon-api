import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { buildCacheKey, cacheResponse } from "../lib/cache-middleware.js";
import { parsePagination } from "../../utils/helpers.js";
const staff = new Hono();
config({ path: ".env" });
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;
// Clerk webhook endpoint
staff.get("/", cacheResponse({
    key: (c) => {
        const page = Number(c.req.query("page") || 1);
        const per = Number(c.req.query("perPage") || c.req.query("per") || 20);
        const organisation_id = c.get("organisation_id");
        return buildCacheKey("staff", {
            page,
            per,
            organisation_id,
        });
    },
    ttlSeconds: 300,
}), async (c) => {
    if (!supabase)
        return c.text("Supabase not configured", 500);
    //@ts-ignore
    const organisation_id = c.get("organisation_id");
    const { page, perPage, start, end } = parsePagination(c);
    try {
        const { data, error, count } = await supabase
            .from("Staff")
            .select("*", { count: "exact" })
            .eq("organisation_id", organisation_id)
            .range(start, end);
        if (error) {
            console.error("Error fetching staff data:", error);
            return c.json({ error: "Failed to fetch staff data" }, 500);
        }
        const items = Array.isArray(data) ? data : [];
        const total = typeof count === "number" ? count : items.length;
        const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;
        return c.json({
            staff: data,
            meta: {
                total,
                page,
                perPage,
                totalPages,
            },
        }, 200);
    }
    catch (err) {
        console.error("Staff route error:", err);
        return c.json({ error: "Failed to fetch staff data" }, 500);
    }
});
staff.get("/:id", async (c) => {
    if (!supabase)
        return c.text("Supabase not configured", 500);
    const id = c.req.param("id");
    //@ts-ignore
    const organisation_id = c.get("organisation_id");
    try {
        const { data: staffMember, error } = await supabase
            .from("Staff")
            .select("*")
            .eq("id", id)
            .eq("organisation_id", organisation_id)
            .single();
        if (error) {
            console.error("Error fetching staff member:", error);
            return c.json({ error: "Failed to fetch staff member" }, 500);
        }
        return c.json({ staff: staffMember }, 200);
    }
    catch (err) {
        console.error("Staff member route error:", err);
        return c.json({ error: "Failed to fetch staff member" }, 500);
    }
});
staff.post("/inviteUser", async (c) => {
    if (!supabase)
        return c.text("Supabase not configured", 500);
    const userInviteData = await c.req.json();
    //@ts-ignore
    const organisation_id = c.get("organisation_id");
    const inviteUrl = process.env.CLERK_BACKEND_API_URL +
        "/organizations/" +
        organisation_id +
        "/invitations";
    try {
        const response = await fetch(inviteUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
            },
            body: JSON.stringify(userInviteData),
        });
        if (!response.ok) {
            const errorData = await response.json();
            console.error("Error inviting staff member:", errorData);
            return c.json({ error: "Failed to invite staff member" }, 500);
        }
        const responseData = await response.json();
        return c.json({ message: "Staff member invited successfully", data: responseData }, 200);
    }
    catch (err) {
        console.error("Invite staff member error:", err);
        return c.json({ error: "Failed to invite staff member" }, 500);
    }
});
staff.post("/revokeInvitation", async (c) => {
    //@ts-ignore
    const organisation_id = c.get("organisation_id");
    const revokeData = await c.req.json();
    const revokeUrl = process.env.CLERK_BACKEN_API_URL +
        "/organizations/" +
        organisation_id +
        "/invitations/" +
        revokeData.invitation_id +
        "/revoke";
    const requesting_user_id = revokeData.requesting_user_id;
    try {
        const response = await fetch(revokeUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
            },
            body: JSON.stringify({ requesting_user_id }),
        });
        if (!response.ok) {
            const errorData = await response.json();
            console.error("Error revoking staff member invitation:", errorData);
            return c.json({ error: "Failed to revoke staff member invitation" }, 500);
        }
        const responseData = await response.json();
        return c.json({
            message: "Staff member invitation revoked successfully",
            data: responseData,
        }, 200);
    }
    catch (err) {
        console.error("Revoke staff member invitation error:", err);
        return c.json({ error: "Failed to revoke staff member invitation" }, 500);
    }
});
export default staff;
