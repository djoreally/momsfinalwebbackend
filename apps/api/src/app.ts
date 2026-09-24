import { Hono } from "hono";
import { cors } from "hono/cors";
import { applyStripeMonetaryEventsMigration, databaseHealth } from "../../../packages/db/src/index.js";
import { appointmentRoutes } from "./routes/appointments.js";
import { bookingRoutes } from "./routes/bookings.js";
import { availabilityRoutes } from "./routes/availability.js";
import { customerRoutes } from "./routes/customers.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { historyRoutes } from "./routes/history.js";
import { mediaRoutes } from "./routes/media.js";
import { newsletterRoutes } from "./routes/newsletter.js";
import { operationsPaymentRoutes } from "./routes/operations-payments.js";
import { operationsRoutes } from "./routes/operations.js";
import { pricingRoutes } from "./routes/pricing.js";
import { paymentRoutes } from "./routes/payments.js";
import { stripeWebhookRoutes } from "./routes/stripe-webhooks.js";
import { serviceRoutes } from "./routes/services.js";
import { serviceOrderRoutes } from "./routes/service-orders.js";
import { vehicleRoutes } from "./routes/vehicles.js";

await applyStripeMonetaryEventsMigration();

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
  c.html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MOMS Systems</title>
<style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#050608;color:#f7f7f7;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;overflow:hidden}
body{min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 50% 65%,#181b20 0,#08090b 38%,#030405 75%)}
body:before{content:"";position:fixed;inset:0;opacity:.18;background:repeating-linear-gradient(90deg,transparent 0 78px,#fff 79px 80px),repeating-linear-gradient(0deg,transparent 0 78px,#fff 79px 80px);transform:perspective(420px) rotateX(62deg) scale(1.8) translateY(30%);transform-origin:center bottom;animation:road 7s linear infinite}
.wrap{position:relative;width:min(900px,92vw);text-align:center}.brand{font-size:clamp(12px,2vw,15px);letter-spacing:.42em;font-weight:800;text-transform:uppercase;opacity:.72}
h1{margin:.22em 0 0;font-size:clamp(48px,10vw,108px);line-height:.86;letter-spacing:-.07em;font-style:italic}.systems{display:block;font-size:.36em;letter-spacing:.34em;margin-left:.34em;margin-top:.45em;font-style:normal}
.dash{margin:52px auto 24px;width:min(620px,90vw);height:250px;position:relative;border:1px solid #2b2e34;border-radius:320px 320px 34px 34px;background:linear-gradient(180deg,#0d0f12,#060708);box-shadow:0 0 70px #000,inset 0 0 40px #000}
.arc{position:absolute;left:50%;top:50%;width:360px;height:180px;transform:translate(-50%,-45%);border-radius:360px 360px 0 0;border:14px solid #24272c;border-bottom:0}
.arc:after{content:"";position:absolute;inset:-14px;border-radius:inherit;border:14px solid transparent;border-top-color:#fff;border-left-color:#fff;filter:drop-shadow(0 0 10px #fff);animation:pulse 2.4s ease-in-out infinite}
.rpm{position:absolute;inset:72px 0 auto;font-size:64px;font-weight:900;letter-spacing:-.06em}.rpm small{display:block;font-size:10px;letter-spacing:.34em;opacity:.45;margin-top:2px}.status{position:absolute;bottom:27px;left:0;right:0;font-size:11px;letter-spacing:.28em;text-transform:uppercase}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#fff;box-shadow:0 0 12px #fff;margin-right:9px;animation:blink 1.6s ease-in-out infinite}
.footer{font-size:10px;letter-spacing:.25em;text-transform:uppercase;opacity:.38}
@keyframes pulse{0%,100%{opacity:.45;transform:rotate(-7deg)}50%{opacity:1;transform:rotate(7deg)}}@keyframes blink{50%{opacity:.35}}@keyframes road{to{background-position:80px 80px}}
</style>
</head>
<body><main class="wrap"><div class="brand">MOMS Mobile Oil Change</div><h1>MOMS<span class="systems">SYSTEMS</span></h1><section class="dash" aria-label="System status"><div class="arc"></div><div class="rpm">READY<small>ENGINE CONTROL</small></div><div class="status"><span class="dot"></span>Systems online</div></section><div class="footer">Philadelphia · Established 2013 · Driveway Service Infrastructure</div></main></body></html>`),
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
app.route("/v1/bookings", bookingRoutes);
app.route("/v1/availability", availabilityRoutes);
app.route("/v1/customers", customerRoutes);
app.route("/v1/dashboard", dashboardRoutes);
app.route("/v1/history", historyRoutes);
app.route("/v1/media", mediaRoutes);
app.route("/v1/newsletter", newsletterRoutes);
app.route("/v1/operations/payments", operationsPaymentRoutes);
app.route("/v1/operations", operationsRoutes);
app.route("/v1/services", serviceRoutes);
app.route("/v1/service-orders", serviceOrderRoutes);
app.route("/v1/vehicles", vehicleRoutes);
app.route("/v1/pricing", pricingRoutes);
app.route("/v1/payments", paymentRoutes);
app.route("/webhooks/stripe", stripeWebhookRoutes);
