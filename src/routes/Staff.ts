// import { Hono } from "hono";
// import { verifyWebhook } from "@clerk/backend/webhooks";
// import { createClient } from "@supabase/supabase-js";
// import { config } from "dotenv";

// const staff = new Hono();

// config({ path: ".env" });

// const SUPABASE_URL =
//   process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
// const SUPABASE_ANON_KEY =
//   process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// const supabase =
//   SUPABASE_URL && SUPABASE_ANON_KEY
//     ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
//     : null;

// // Clerk webhook endpoint
// staff.post("/", async (c) => {
//   if (!supabase) return c.text("Supabase not configured", 500);
//   try {
//     const body = await c.req.text();

//     // Verify webhook; throws if invalid
//     const event = await verifyWebhook(
//       // Clerk expects raw req with headers
//       { rawBody: body, headers: c.req.headers },
//       { signingSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET! },
//     );

//     console.log("Clerk Event:", event.type);

//     // Only handle user.created
//     if (event.type === "user.created") {
//       const user = event.data;

//       const email = user.email_addresses?.[0]?.email_address ?? null;

//       //   const { data, error } = await supabase.from("staff").upsert(
//       //     {
//       //       clerk_id: user.id,
//       //       email,
//       //       first_name: user.first_name || null,
//       //       last_name: user.last_name || null,
//       //     },
//       //     { onConflict: "clerk_id" },
//       //   );

//       //   if (error) {
//       //     console.error("Supabase upsert error:", error);
//       //     return c.text("Database error", 500);
//       //   }

//       console.log("User synced to Supabase:", event);
//       console.log("user:", user);
//     }

//     return c.text("OK");
//   } catch (err) {
//     console.error("Webhook verification or processing failed:", err);
//     return c.text("Invalid webhook", 400);
//   }
// });

// export default staff;
