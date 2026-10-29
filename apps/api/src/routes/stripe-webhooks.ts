import { Hono } from "hono";
import { getStripe } from "../integrations/stripe.js";
import { updatePaymentStatusByIntent } from "../repositories/payments.js";
import { recordDisputeEvent, recordPaymentIntentEvent, recordRefundEvent } from "../domain/stripe-evidence.js";
import {
  claimInternalWebsiteBookingAutoPush,
  getInternalWebsiteBooking,
  recordInternalWebsiteBookingAutoPushFailure,
  recordInternalWebsiteBookingAutoPushSuccess,
} from "../repositories/internal-website-bookings.js";
import {
  callServiceWriterAutoPush,
  getServiceWriterAutoPushConfig,
  triggerPrepaidAutoPush,
} from "../services/service-writer-auto-push.js";

export const stripeWebhookRoutes = new Hono();

/**
 * Prepaid auto-push (Ty, 2026-10-29): when a website booking's payment
 * completes, push that booking to Service Writer automatically.
 *
 * This webhook is the ONLY authoritative payment-completion path in the
 * backend: domain/payments.ts `chooseBookingPayment` merely creates the
 * Stripe PaymentIntent, and nothing else ever transitions a payment to
 * `paid`. Hooking here means every real prepayment — and only a real
 * prepayment — triggers exactly this code, and Stripe's own webhook
 * retries re-enter an idempotent trigger (atomic claim + one-push-ever
 * stamp + the Service Writer RPC's per-booking idempotency).
 *
 * The trigger must never fail the webhook: a failed auto-push leaves the
 * booking unstamped and visible in the manual queue with the reason
 * recorded on it, which is the designed fail-safe.
 */
async function maybeAutoPushPrepaidBooking(bookingId: string) {
  const config = getServiceWriterAutoPushConfig();
  if (!config) {
    console.info("prepaid_auto_push_not_configured", { bookingId });
    return;
  }
  try {
    const result = await triggerPrepaidAutoPush(bookingId, {
      getBooking: async (id) => {
        const booking = await getInternalWebsiteBooking(id);
        return booking
          ? {
              status: booking.status,
              pushedSwAppointmentId: booking.pushedSwAppointmentId,
              neverPush: booking.neverPush,
              autoPushClaimedAt: booking.autoPushClaimedAt,
            }
          : null;
      },
      claim: claimInternalWebsiteBookingAutoPush,
      recordFailure: recordInternalWebsiteBookingAutoPushFailure,
      recordSuccess: recordInternalWebsiteBookingAutoPushSuccess,
      callServiceWriter: (id) => callServiceWriterAutoPush(config, id),
    });
    console.info("prepaid_auto_push_result", { bookingId, ...result });
  } catch (error) {
    console.error("prepaid_auto_push_failed", { bookingId, error });
  }
}

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
          const payment = await updatePaymentStatusByIntent(intent.id, "paid", new Date());
          // Only booking payments are website bookings. Appointment
          // payments belong to the legacy appointment flow, which is not
          // pushed to Service Writer.
          if (payment?.bookingId) await maybeAutoPushPrepaidBooking(payment.bookingId);
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
