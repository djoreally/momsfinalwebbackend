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
          let paid = await updatePaymentStatusByIntent(intent.id, "paid", new Date());
          if (!paid && intent.metadata?.moms_payment_id) {
            const { getSql } = await import("../../../../packages/db/src/index.js");
            const linked = await getSql()`UPDATE moms_ops.payments SET stripe_payment_intent_id=${intent.id},status='paid',paid_at=now(),updated_at=now() WHERE id=${intent.metadata.moms_payment_id}::uuid RETURNING *`;
            paid = linked[0] as any;
          }
          if (paid) {
            const { getSql } = await import("../../../../packages/db/src/index.js");
            await getSql()`UPDATE moms_ops.invoices i SET status=CASE WHEN i.amount_paid_cents+p.amount_cents>=i.total_cents THEN 'paid' ELSE i.status END,amount_paid_cents=LEAST(i.total_cents,i.amount_paid_cents+p.amount_cents),amount_due_cents=GREATEST(0,i.total_cents-(i.amount_paid_cents+p.amount_cents)),paid_at=CASE WHEN i.amount_paid_cents+p.amount_cents>=i.total_cents THEN COALESCE(i.paid_at,now()) ELSE i.paid_at END,updated_at=now() FROM moms_ops.payments p WHERE p.id=${paid.id}::uuid AND p.invoice_id=i.id`;
          }
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
