/**
 * Wired auto-push runner: website backend -> Service Writer.
 *
 * This is the single place that connects the pure auto-push trigger
 * (services/service-writer-auto-push.ts) to the real dependencies: the
 * internal website-bookings repository (atomic claim, failure/success
 * recording) and the Service Writer auto-push endpoint call. Every
 * trigger site uses this runner, so there is exactly one push path:
 *
 * - the Stripe webhook, after a booking payment is marked paid
 *   (prepaid bookings), and
 * - chooseBookingPayment, at the moment a booking is finalized as
 *   pay_at_appointment (Ty's rule, 2026-10-30: EVERY website booking
 *   auto-pushes; the software does it, nobody works a manual queue).
 *
 * Failure discipline (inherited from the prepaid path): the runner
 * never throws and never fails its caller. On any failure the booking
 * is left unstamped, the claim is released, the reason is stored on
 * the booking (auto_push_last_error), and the booking remains visible
 * in the manual queue as the fail-safe.
 */
import {
  claimInternalWebsiteBookingAutoPush,
  getInternalWebsiteBooking,
  recordInternalWebsiteBookingAutoPushFailure,
  recordInternalWebsiteBookingAutoPushSuccess,
} from "../repositories/internal-website-bookings.js";
import {
  callServiceWriterAutoPush,
  getServiceWriterAutoPushConfig,
  triggerBookingAutoPush,
} from "./service-writer-auto-push.js";

/**
 * Run one auto-push attempt for a booking. `source` names the trigger
 * site for the logs ("stripe_webhook_prepaid" | "pay_at_appointment").
 * Resolves in every case; outcomes are reported through the logs and
 * the booking's auto-push fields, never through a thrown error.
 */
export async function runBookingAutoPush(bookingId: string, source: string): Promise<void> {
  const config = getServiceWriterAutoPushConfig();
  if (!config) {
    console.info("booking_auto_push_not_configured", { bookingId, source });
    return;
  }
  try {
    const result = await triggerBookingAutoPush(bookingId, {
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
    console.info("booking_auto_push_result", { bookingId, source, ...result });
  } catch (error) {
    console.error("booking_auto_push_failed", { bookingId, source, error });
  }
}
