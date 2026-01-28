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
    // 1️⃣ Verify webhook in one call
    const event = await verifyWebhook(c.req.raw!);

    // 2️⃣ Grab svix-id safely
    const svixId = c.req.raw?.headers.get("svix-id");
    if (!svixId) {
      console.error("Missing svix-id header");
      return c.text("Missing svix-id", 400);
    }

    // 3️⃣ Idempotency: skip if already processed
    const { data: seen } = await supabase
      .from("WebhookEvents")
      .select("id")
      .eq("id", svixId)
      .maybeSingle();

    if (seen) {
      return c.json({ message: "Already processed" }, 200);
    }

    // 4️⃣ Handle events
    if (event.type === "user.created") {
      const user = event.data;

      // Build profile object
      const profile = {
        clerk_id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        image_url: user.image_url ?? null,
        username: user.username ?? null,
        phone_numbers: user.phone_numbers.map((p) => p.phone_number),
        email_addresses: user.email_addresses.map((e) => e.email_address),
        updated_at: new Date().toISOString(),
      };

      // Upsert staff row (prevents duplicates)
      const { data, error } = await supabase
        .from("Staff")
        .upsert(profile, { onConflict: "clerk_id" })
        .select()
        .single();

      if (error) {
        console.error("Supabase upsert error:", error);
        return c.text("DB error", 500);
      }

      // 5️⃣ Mark this webhook as processed
      await supabase.from("WebhookEvents").insert({
        id: svixId,
        type: event.type,
        created_at: new Date().toISOString(),
      });

      return c.json({ message: "Staff synced", staff: data });
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

    if (event.type === "user.updated") {
      // Handle user.updated event if needed
      const user = event.data;

      const { data, error } = await supabase
        .from("Staff")
        .update({
          first_name: user.first_name || null,
          last_name: user.last_name || null,
          image_url: user.image_url || null,
          username: user.username || null,
          phone_numbers: user.phone_numbers.map((p) => p.phone_number) || [],
          email_addresses:
            user.email_addresses.map((e) => e.email_address) || [],
          updated_at: new Date().toISOString(),
        })
        .eq("clerk_id", user.id);

      if (data) {
        return c.json({ message: "Staff member updated", staff: data });
      }

      if (error) {
        console.error("Supabase update error:", error);
        return c.text("Database error", 500);
      }

      return c.json({ message: "User updated event received" });
    }

    if (event.type === "organization.created") {
      // Handle organization.created event if needed
      const { error } = await supabase.from("Business").insert({
        Name: event.data.name,
        organisation_id: event.data.id,
        image_url: event.data.image_url || null,
        created_at: new Date().toISOString(),
      });

      if (error) {
        console.error("Supabase insert error:", error);
        return c.text("Database error", 500);
      }
      return c.json({ message: "Organization created event received" });
    }

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
      const { error } = await supabase
        .from("Business")
        .update({
          Name: event.data.name,
          image_url: event.data.image_url || null,
          updated_at: new Date().toISOString(),
        })
        .eq("organisation_id", event.data.id);

      if (error) {
        console.error("Supabase update error:", error);
        return c.text("Database error", 500);
      }
      return c.json({ message: "Organization updated event received" });
    }

    // 6️⃣ Handle organization membership assignment
    if (event.type === "organizationMembership.created") {
      const membership = event.data;
      const clerkId = membership.public_user_data.user_id;

      const updatePayload = {
        organisation_id: membership.organization.id,
        //@ts-ignore
        role: membership.role_name,
        updated_at: new Date().toISOString(),
      };

      const { data: updatedRows, error: updateError } = await supabase
        .from("Staff")
        .update(updatePayload)
        .eq("clerk_id", clerkId)
        .select("clerk_id");

      if (updateError) {
        console.error("Supabase update error:", updateError);
        return c.text("DB error", 500);
      }

      if (!updatedRows || updatedRows.length === 0) {
        const upsertPayload = {
          clerk_id: clerkId,
          first_name: membership.public_user_data.first_name ?? null,
          last_name: membership.public_user_data.last_name ?? null,
          image_url: membership.public_user_data.image_url ?? null,
          ...updatePayload,
        };

        const { error: upsertError } = await supabase
          .from("Staff")
          .upsert(upsertPayload, { onConflict: "clerk_id" });

        if (upsertError) {
          console.error("Supabase upsert error:", upsertError);
          return c.text("DB error", 500);
        }
      }

      await supabase.from("WebhookEvents").insert({
        id: svixId,
        type: event.type,
        created_at: new Date().toISOString(),
      });

      return c.json({ message: "Membership synced" });
    }

    // 7️⃣ Other event types — mark as processed
    await supabase.from("WebhookEvents").insert({
      id: svixId,
      type: event.type,
      created_at: new Date().toISOString(),
    });

    if (event.type === "organizationMembership.deleted") {
      // Handle organization_member.deleted event if needed
      const { error } = await supabase
        .from("Staff")
        .update({
          organisation_id: null,
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
      const { error } = await supabase
        .from("Staff")
        .update({
          organisation_id: event.data.organization.id,
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
