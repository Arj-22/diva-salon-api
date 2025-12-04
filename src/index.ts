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
import email from "./routes/sendMail.js";
import eposNowCategories from "./routes/EposNowCategories.js";
import apiKeys from "./routes/ApiKeys.js";
import treatmentBookings from "./routes/TreatmentBooking.js";

const app = new Hono();

app.use(
  "*",
  apiKeyAuth({
    // Configure via env API_KEYS="key1,key2"
    // Exclude health if you want it public:
    exclude: ["/health"], // remove this line to protect /health too
  })
);

app.route("/eposNowTreatments", eposNowTreatments);
app.route("/eposNowCategories", eposNowCategories);
app.route("/googleReviews", googleReviews);
app.route("/treatmentCategories", treatmentCategories);
app.route("/treatmentSubCategories", treatmentSubCategories);
app.route("/treatments", treatments);
app.route("/clients", clients);
app.route("/bookings", bookings);
app.route("/treatmentBookings", treatmentBookings);
app.route("/sendMail", email);
app.route("/apiKeys", apiKeys);
app.route("/health", health); // or just inline handler

// app.get("/", (c) => {
//   return c.text("Hello Hono!");
// });
serve(
  {
    fetch: app.fetch,
    port: 3001,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  }
);
