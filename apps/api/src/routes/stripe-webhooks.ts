import { Hono } from "hono";
import { getStripe } from "../integrations/stripe.js";
import { updatePaymentStatusByIntent } from "../repositories/payments.js";
import { recordDisputeEvent, recordPaymentIntentEvent, recordRefundEvent } from "../domain/stripe-evidence.js";

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

  try {
    switch (event.type) {
      case "payment_intent.created":
      case "payment_intent.processing":
      case "payment_intent.requires_action":
      case "payment_intent.succeeded":
      case "payment_intent.payment_failed":
      case "payment_intent.canceled": {
        const intent = event.data.object;
        await recordPaymentIntentEvent(event, intent);
        if (event.type === "payment_intent.succeeded") {
          await updatePaymentStatusByIntent(intent.id, "paid", new Date());
        } else if (event.type === "payment_intent.payment_failed") {
          await updatePaymentStatusByIntent(intent.id, "failed");
        } else if (event.type === "payment_intent.canceled") {
          await updatePaymentStatusByIntent(intent.id, "cancelled");
        }
        break;
      }
      case "refund.created":
      case "refund.updated":
      case "refund.failed":
        await recordRefundEvent(event, event.data.object);
        break;
      case "charge.dispute.created":
      case "charge.dispute.updated":
      case "charge.dispute.closed":
        await recordDisputeEvent(event, event.data.object);
        break;
      default:
        break;
    }
    return c.json({ received: true });
  } catch (error) {
    console.error("stripe_webhook_processing_failed", event.id, event.type, error);
    return c.json({ error: "webhook_processing_failed" }, 500);
  }
});
