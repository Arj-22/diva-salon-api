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

    // Only handle user.created
    if (event.type === "user.created") {
      const user = event.data;

      const { data, error } = await supabase.from("Staff").upsert(
        {
          clerk_id: user.id,
          businessId: user.organization_memberships?.[0]?.organization || null,
          first_name: user.first_name || null,
          last_name: user.last_name || null,
          image_url: user.image_url || null,
          username: user.username || null,
          phone_numbers: user.phone_numbers.map((p) => p.phone_number) || [],
          email_addresses:
            user.email_addresses.map((e) => e.email_address) || [],
          created_at: new Date().toISOString(),
        },
        { onConflict: "clerk_id" },
      );

      if (data) {
        return c.json({ message: "Staff member created/updated", staff: data });
      }

      if (error) {
        console.error("Supabase upsert error:", error);
        return c.text("Database error", 500);
      }
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
          updated_at: new Date().toISOString(),
        })
        .eq("clerk_id", event.data.public_user_data.user_id);
      if (error) {
        console.error("Supabase update error:", error);
        return c.text("Database error", 500);
      }
      return c.json({ message: "Organization member created event received" });
    }
  } catch (err) {
    console.error("Webhook verification or processing failed:", err);
    return c.text("Invalid webhook", 400);
  }
});

export default webhooks;
