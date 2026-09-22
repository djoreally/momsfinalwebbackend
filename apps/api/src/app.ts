import { Hono } from "hono";
import { cors } from "hono/cors";
import { databaseHealth } from "@moms/db";
import { appointmentRoutes } from "./routes/appointments";
import { availabilityRoutes } from "./routes/availability";
import { customerRoutes } from "./routes/customers";
import { pricingRoutes } from "./routes/pricing";
import { paymentRoutes } from "./routes/payments";
import { stripeWebhookRoutes } from "./routes/stripe-webhooks";
import { serviceRoutes } from "./routes/services";

export const app = new Hono();

app.use("/v1/*", cors({
  origin: (origin) => {
    if (!origin) return "https://momsoilchange.com";
    if (origin === "https://momsoilchange.com" || origin === "https://www.momsoilchange.com") return origin;
    if (/^https:\/\/[^/]+\.vercel\.app$/.test(origin)) return origin;
    return "https://momsoilchange.com";
  },
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type"],
  maxAge: 86400,
}));

app.get("/", (c) =>
  c.json({
    service: "MOMS Platform API",
    status: "ok",
    architecture: "hono-drizzle-neon",
  }),
);

app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "moms-api",
    timestamp: new Date().toISOString(),
  }),
);

app.get("/health/database", async (c) => {
  try {
    await databaseHealth();
    return c.json({ status: "ok", database: "reachable" });
  } catch (error) {
    console.error("Database health check failed", error);
    return c.json({ status: "error", database: "unreachable" }, 503);
  }
});

app.route("/v1/appointments", appointmentRoutes);
app.route("/v1/availability", availabilityRoutes);
app.route("/v1/customers", customerRoutes);
app.route("/v1/services", serviceRoutes);
app.route("/v1/pricing", pricingRoutes);
app.route("/v1/payments", paymentRoutes);
app.route("/webhooks/stripe", stripeWebhookRoutes);
