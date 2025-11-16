import { serve } from "@hono/node-server";
import { Hono } from "hono";
import eposNowTreatments from "./routes/EposNowTreatments.js";
import health from "./routes/health.js";
import googleReviews from "./routes/GoogleReviews.js";
import treatmentCategories from "./routes/TreatmentCategories.js";
import treatmentSubCategories from "./routes/TreatmentSubCategories.js";
import treatments from "./routes/Treatments.js";
import { apiKeyAuth } from "./lib/api-key-auth-middleware.js";
import bookings from "./routes/Booking.js";
import clients from "./routes/Clients.js";

const app = new Hono();

app.use(
  "*",
  apiKeyAuth({
    // Configure via env API_KEYS="key1,key2"
    // Exclude health if you want it public:
    exclude: ["/health"], // remove this line to protect /health too
  })
);

app.get("/", (c) => {
  return c.text("Hello Hono!");
});
app.route("/eposNowTreatments", eposNowTreatments);
app.route("/googleReviews", googleReviews);
app.route("/treatmentCategories", treatmentCategories);
app.route("/treatmentSubCategories", treatmentSubCategories);
app.route("/treatments", treatments);
app.route("/clients", clients);
app.route("/bookings", bookings);
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
