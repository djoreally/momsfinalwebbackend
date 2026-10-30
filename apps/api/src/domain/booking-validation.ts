/**
 * Booking validation primitives: the domain error types and the
 * customer-email gate for booking creation.
 *
 * This module is deliberately import-free: the repo's unit tests load
 * domain modules directly through Node's type stripping, which cannot
 * follow relative `.js` specifiers (the same constraint that keeps
 * domain/offers.ts import-free). domain/bookings.ts re-exports the
 * error classes, so existing imports from there keep working.
 */

export class BookingConflictError extends Error {}
export class BookingValidationError extends Error {}

/**
 * Ty's rule (2026-10-30): email is a REQUIRED field to book. A booking
 * whose customer has no email — or a malformed one — is rejected at
 * creation, so a no-email booking can never exist again. (The incident
 * behind the rule: a phone-only customer booked, and Service Writer's
 * push refused the booking outright because the booking path requires
 * a valid email.) Customer creation still accepts an email-less
 * customer record; it is the booking that may not proceed without one.
 *
 * Returns the trimmed email on success; throws BookingValidationError,
 * which the booking route maps to a 422 with the error code as the
 * body, like every other domain validation failure.
 */
const BOOKING_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function requireCustomerEmailForBooking(email: string | null | undefined): string {
  const normalized = (email ?? "").trim();
  if (!normalized) throw new BookingValidationError("customer_email_required");
  if (normalized.length > 254 || !BOOKING_EMAIL_PATTERN.test(normalized)) {
    throw new BookingValidationError("customer_email_invalid");
  }
  return normalized;
}
