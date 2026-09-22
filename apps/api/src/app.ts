import { Hono } from "hono";
import { databaseHealth } from "@moms/db";
import { availabilityRoutes } from "./routes/availability";
import { customerRoutes } from "./routes/customers";
import { pricingRoutes } from "./routes/pricing";
import { serviceRoutes } from "./routes/services";

export const app = new Hono();

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

app.route("/v1/availability", availabilityRoutes);
app.route("/v1/customers", customerRoutes);
app.route("/v1/services", serviceRoutes);
app.route("/v1/pricing", pricingRoutes);
