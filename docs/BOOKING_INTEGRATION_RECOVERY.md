# Booking Integration Recovery — Service Area First

Status: implementation kickoff / review contract. This document does not claim the booking flow is fixed or production-certified.

## Objective

Connect both booking experiences to the same supported MOMS booking business logic:

- Public MOMS website: website booking UI -> existing booking API -> canonical booking record visible in Service Writer.
- Authenticated internal booking tools: authenticated UI -> the same supported domain service/API path -> the same canonical booking record.
- Preserve the existing booking engine, pricing rules, payments, and operational workflows. Do not add WooCommerce or replace booking.

## Gate 0 — Service area (must be implemented and tested first)

Before a customer can reserve a time, the backend must validate the actual service address against MOMS's authoritative service-area rules. Client-side checks may improve UX but are not authoritative.

### Existing code evidence and policy conflict to resolve

- The public website has `src/app/api/service-area-check/route.ts`, which geocodes an address with Nominatim and calculates distance from coordinates `40.1556519, -75.2238249` using a hard-coded 25-mile radius.
- `src/components/booking/ServiceAreaPrecheck.tsx` describes a 25-mile area from ZIP 19002. Its “Continue to Booking” link is rendered regardless of whether the result is in-area, so this is a UX precheck, not a booking-enforcement boundary.
- The website also proxies operations settings at `/v1/settings/service-area` and exposes a settings model with enabled / allowed states / allowed postal codes / enforcement mode. The backend source of that settings route and its relationship to the hard-coded radius still need to be verified.
- These are potentially different coverage policies. Do not silently choose one or assume they are equivalent. Resolve the policy precedence and ensure there is one authoritative backend decision before enabling enforcement.

### Required behavior

- Validate normalized service address / postal code on the server before creating a booking or preparing payment.
- Reject out-of-area addresses with a stable, customer-safe error and no booking, payment intent, or confirmation notification.
- Fail closed when the service-area authority is unavailable or cannot make a decision.
- Reuse the same service-area validator for public and authenticated internal booking flows. Any internal override must be explicit, authorized, auditable, and separate from ordinary booking.
- Avoid relying on a browser-only precheck or trusting a client-supplied `inServiceArea` boolean.
- Add tests for in-area, out-of-area, malformed/incomplete address, unavailable validator, and boundary cases.

The current backend `reserveBooking` domain flow quotes jobs and checks schedule conflicts before calling `createBooking`, but the inspected path has no service-area validation. First reconcile the existing radius checker with the operations settings model and document the authoritative rule; do not invent ZIP codes, mileage boundaries, or an allowlist.

## Gate 1 — One booking path

- Keep the Hono API/domain service as the business-rule boundary and Neon as canonical booking state.
- Website and authenticated internal tools must call the same supported booking domain service, not duplicate SQL or pricing/scheduling logic.
- Keep browser code away from direct database writes and client-supplied price authority.
- A successful public booking must return a canonical booking reference and be retrievable in Service Writer with customer, service address, vehicle/service jobs, schedule, and server-calculated quote.

## Gate 2 — Idempotent creation

- Require a stable idempotency key for each logical booking submission, scoped to the authenticated/public booking context.
- Persist and enforce uniqueness server-side; an in-flight or repeated request with the same key and same normalized payload returns the original booking result.
- Reusing a key with a different payload returns a conflict; it must not mutate the original booking or create another.
- Concurrent retries must be safe under a database uniqueness constraint/transaction, not only an in-memory check.
- Do not send duplicate booking confirmations for a replayed request.
- Keep existing duplicate-job validation; it is not a substitute for request-level idempotency.

## Gate 3 — Atomicity and operational visibility

- Booking + job lines + canonical quote are persisted atomically.
- No partial-save success response. On failure, return a failure and leave no incomplete booking.
- Service Writer's booking list/detail and authenticated internal booking tools read the same canonical record.
- Notification delivery is downstream of successful persistence and retry-safe; notification failure must not fabricate booking success or create a second booking on retry.
- Payment preparation must use the canonical booking ID and server-calculated amount and must be replay-safe.

## Required verification before calling this GREEN

1. In-area website booking creates exactly one canonical booking and appears in Service Writer.
2. Out-of-area website attempt creates no booking/payment/confirmation.
3. Authenticated internal booking uses the same validator and booking business logic.
4. Same-key sequential and concurrent retries return one booking only.
5. Same key + different payload is rejected.
6. Forced persistence failure leaves no partial booking/jobs.
7. Confirmation/payment retries do not duplicate the booking or financial operation.
8. Run backend typecheck and test suite; then run a controlled production smoke test only with explicit test data and verify the exact deployed revision.

## Implementation order

1. Reconcile the 25-mile geocoding check with the operations service-area settings and decide the authoritative rule.
2. Implement the shared server-side service-area gate and tests.
3. Add durable booking idempotency and replay/conflict tests.
4. Verify website and authenticated internal callers converge on the same domain path.
5. Run integration tests and open-PR review; do not merge or deploy from this branch without review.

## Out of scope

- WooCommerce, dropshipping, retail product catalog, or a booking-engine replacement.
- Repricing historical bookings.
- Changing service coverage policy without an explicit business decision.
- Claiming production certification without end-to-end evidence.
