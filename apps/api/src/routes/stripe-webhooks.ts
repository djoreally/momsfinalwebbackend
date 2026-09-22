import { Hono } from "hono";
import { getStripe } from "../integrations/stripe";
import { updatePaymentStatusByIntent } from "../repositories/payments";

export const stripeWebhookRoutes = new Hono();

stripeWebhookRoutes.post("/", async (c) => {
  const signature = c.req.header("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return c.json({ error: "webhook_not_configured" }, 503);

  const body = await c.req.text();
  let event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret);
  } catch {
    return c.json({ error: "invalid_signature" }, 400);
  }

  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object;
    await updatePaymentStatusByIntent(intent.id, "succeeded", new Date());
  } else if (event.type === "payment_intent.payment_failed") {
    const intent = event.data.object;
    await updatePaymentStatusByIntent(intent.id, "failed");
  } else if (event.type === "payment_intent.canceled") {
    const intent = event.data.object;
    await updatePaymentStatusByIntent(intent.id, "cancelled");
  }

  return c.json({ received: true });
});
