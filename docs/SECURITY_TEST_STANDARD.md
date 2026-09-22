# MOMS Booking Release Gate

Production is GREEN only when every required gate passes.

## Threat model

Assume malformed clients, duplicate requests, replayed webhooks, stale caches, provider outages, race conditions, leaked identifiers, hostile payloads, dependency compromise, configuration drift, partial deployments, and human error.

## Required gates

1. Typecheck and build.
2. Route contract tests for every public Hono endpoint.
3. Repository/integration tests against an isolated database.
4. Pricing invariants: server authority, overflow/negative/fractional boundaries, tax separation, waiver authorization.
5. Scheduling invariants: timezone/DST, overlap exclusion, same-slot races, invalid dates, duration boundaries.
6. Vehicle tests: VIN validation, NHTSA normalization, provider timeout/failure, manual YMM fallback, oil-spec provenance. Never invent missing specifications.
7. Payment tests: idempotency, duplicate prepare, amount integrity, Stripe-customer mapping, webhook signature verification, replay/deduplication, metadata mapping, failed/cancelled/succeeded transitions.
8. Authorization tests: object IDs are not authorization; reject cross-customer access and unauthorized staff operations.
9. Input-abuse tests: oversized bodies, unexpected fields, injection strings, Unicode edge cases, invalid UUIDs, invalid ZIP/VIN/email/phone.
10. Failure-mode tests: Neon unavailable, Stripe unavailable, NHTSA unavailable, Resend unavailable. Fail closed where money or booking integrity is involved.
11. Browser/BFF contract tests through the deployed Next.js origin.
12. Production smoke test after deployment. A Vercel READY state is not GREEN.
13. Synthetic booking E2E through payment preparation without charging a live card.
14. Observability gate: every failed booking stage is attributable without logging secrets, card data, or unnecessary PII.
15. Dependency/secret scanning and least-privilege review.

## Release rule

BUILD GREEN != SYSTEM GREEN.

A release is GREEN only after the deployed customer route proves:
Address -> Vehicle -> Vehicle intelligence -> Service -> Exact server price -> Availability -> Customer -> Appointment -> Stripe preparation.

No test may call a live charge merely to certify deployment.
