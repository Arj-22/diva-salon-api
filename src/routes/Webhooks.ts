import { Hono } from "hono";
import { verifyWebhook } from "@clerk/backend/webhooks";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

const webhooks = new Hono();

config({ path: ".env" });

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

// Clerk webhook endpoint
webhooks.post("/clerk-webhook", async (c) => {
  if (!supabase) return c.text("Supabase not configured", 500);
  try {
    const headers = c.req.raw?.headers ?? c.req.header();

    if (!headers) {
      console.error("Webhook headers missing");
      return c.text("Invalid webhook", 400);
    }

    const event = await verifyWebhook(c.req.raw!);

    const svixId =
      headers.get?.("svix-id") ?? headers["svix-id"] ?? headers["Svix-Id"];
    if (!svixId) return c.text("Missing Svix-Id", 400);

    const { data: seen } = await supabase
      .from("WebhookEvents")
      .select("id")
      .eq("id", svixId)
      .maybeSingle();

    if (seen) return c.json({ message: "Event already processed" });

    // Only handle user.created
    if (event.type === "user.created") {
      const user = event.data;
      console.log("Processing user.created for user:", user);
      // const organizationId =
      //   user.organization_memberships?.[0]?.organization?.id ??
      //   user.primary_organization_id ??
      //   null;

      const profile = {
        clerk_id: user.id,
        // businessId: organizationId,
        first_name: user.first_name || null,
        last_name: user.last_name || null,
        image_url: user.image_url || null,
        username: user.username || null,
        phone_numbers: user.phone_numbers.map((p) => p.phone_number) || [],
        email_addresses: user.email_addresses.map((e) => e.email_address) || [],
        updated_at: new Date().toISOString(),
      };

      const { data: existing, error: fetchError } = await supabase
        .from("Staff")
        .select("id")
        .eq("clerk_id", user.id)
        .maybeSingle();

      if (fetchError) {
        console.error("Supabase fetch error:", fetchError);
        return c.text("Database error", 500);
      }

      const query = existing
        ? supabase
            .from("Staff")
            .update(profile)
            .eq("id", existing.id)
            .select()
            .single()
        : supabase
            .from("Staff")
            .insert({ ...profile, created_at: new Date().toISOString() })
            .select()
            .single();

      const { data, error } = await query;

      if (error) {
        console.error("Supabase write error:", error);
        return c.text("Database error", 500);
      }

      return c.json({ message: "Staff member synced", staff: data });
    }
    if (event.type === "user.deleted") {
      const user = event.data;

      const { error } = await supabase
        .from("Staff")
        .delete()
        .eq("clerk_id", user.id);

      if (error) {
        console.error("Supabase delete error:", error);
        return c.text("Database error", 500);
      }

      return c.json({ message: "Staff member deleted" });
    }

    // if (event.type === "user.updated") {
    //   // Handle user.updated event if needed
    //   const user = event.data;

    //   const { data, error } = await supabase
    //     .from("Staff")
    //     .update({
    //       first_name: user.first_name || null,
    //       last_name: user.last_name || null,
    //       image_url: user.image_url || null,
    //       username: user.username || null,
    //       phone_numbers: user.phone_numbers.map((p) => p.phone_number) || [],
    //       email_addresses:
    //         user.email_addresses.map((e) => e.email_address) || [],
    //       updated_at: new Date().toISOString(),
    //     })
    //     .eq("clerk_id", user.id);

    //   if (data) {
    //     return c.json({ message: "Staff member updated", staff: data });
    //   }

    //   if (error) {
    //     console.error("Supabase update error:", error);
    //     return c.text("Database error", 500);
    //   }

    //   return c.json({ message: "User updated event received" });
    // }

    // if (event.type === "organization.created") {
    //   // Handle organization.created event if needed
    //   const { data, error } = await supabase
    //     .from("Business")
    //     .update({
    //       Name: event.data.name,
    //       organisation_id: event.data.id,
    //       created_at: new Date().toISOString(),
    //     })
    //     .eq("organisation_id", event.data.id);

    //   if (error) {
    //     console.error("Supabase insert error:", error);
    //     return c.text("Database error", 500);
    //   }
    //   return c.json({ message: "Organization created event received" });
    // }

    if (event.type === "organization.deleted") {
      // Handle organization.deleted event if needed
      const { error } = await supabase
        .from("Business")
        .delete()
        .eq("organisation_id", event.data.id);

      if (error) {
        console.error("Supabase delete error:", error);
        return c.text("Database error", 500);
      }
      return c.json({ message: "Organization deleted event received" });
    }
    if (event.type === "organization.updated") {
      const { data, error } = await supabase
        .from("Business")
        .update({
          Name: event.data.name,
          updated_at: new Date().toISOString(),
        })
        .eq("organisation_id", event.data.id);

      console.log("Organization updated:", event.data);

      if (error) {
        console.error("Supabase update error:", error);
        return c.text("Database error", 500);
      }
      return c.json({ message: "Organization updated event received" });
    }

    if (event.type === "organizationMembership.created") {
      // Handle organization_member.created event if needed
      console.log("Organization member created:", event.data);

      const { data, error } = await supabase
        .from("Staff")
        .update({
          businessId: event.data.organization.id,
          role: event.data.role,
          updated_at: new Date().toISOString(),
        })
        .eq("clerk_id", event.data.public_user_data.user_id);
      if (error) {
        console.error("Supabase update error:", error);
        return c.text("Database error", 500);
      }
      return c.json({ message: "Organization member created event received" });
    }

    if (event.type === "organizationMembership.deleted") {
      // Handle organization_member.deleted event if needed
      console.log("Organization member deleted:", event.data);
      const { data, error } = await supabase
        .from("Staff")
        .update({
          businessId: null,
          role: null,
          updated_at: new Date().toISOString(),
        })
        .eq("clerk_id", event.data.public_user_data.user_id);
      if (error) {
        console.error("Supabase update error:", error);
        return c.text("Database error", 500);
      }
      return c.json({ message: "Organization member deleted event received" });
    }

    if (event.type === "organizationMembership.updated") {
      // Handle organization_member.updated event if needed
      console.log("Organization member updated:", event.data);
      const { data, error } = await supabase
        .from("Staff")
        .update({
          businessId: event.data.organization.id,
          role: event.data.role,
          updated_at: new Date().toISOString(),
        })
        .eq("clerk_id", event.data.public_user_data.user_id);
      if (error) {
        console.error("Supabase update error:", error);
        return c.text("Database error", 500);
      }
      return c.json({ message: "Organization member updated event received" });
    }

    await supabase.from("WebhookEvents").insert({
      id: svixId,
      type: event.type,
      created_at: new Date().toISOString(),
    });

    return c.json({ message: "Event type not handled" });
  } catch (err) {
    console.error("Webhook verification or processing failed:", err);
    return c.text("Invalid webhook", 400);
  }
});

export default webhooks;
