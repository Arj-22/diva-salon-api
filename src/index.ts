import { serve } from "@hono/node-server";
import { Hono } from "hono";
import eposNowTreatments from "./routes/EposNowTreatments.js";
import health from "./routes/health.js";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});
app.route("/eposNowTreatments", eposNowTreatments);
app.route("/health", health);
serve(
  {
    fetch: app.fetch,
    port: 3001,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  }
);
