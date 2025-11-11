import { serve } from "@hono/node-server";
import { Hono } from "hono";
import services from "./routes/services.js";
// import health from "./routes/health.js";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});
app.route("/services", services);
// app.route("/health", health);
serve(
  {
    fetch: app.fetch,
    port: 3001,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  }
);
