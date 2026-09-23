# MOMS Product Contract — Frozen Baseline

Status: FROZEN baseline. Changes require an explicit product/architecture decision.

## Architecture
Next.js is presentation and same-origin BFF only. Browser code never accesses Neon/Drizzle or database credentials. Hono is the application/API boundary. Domain services own business rules. Drizzle is persistence. Neon is canonical MOMS business/application state. The isolated vehicle-spec branch is read-only reference data.

## Booking
One booking is one customer visit. A booking contains one or more vehicle service jobs and one schedule reservation. Each vehicle job resolves its own service, authoritative vehicle/spec data, quote, and duration. The visit aggregates duration and price.

## Customer booking UX
Guided stages with a persistent booking-summary tray after address entry. Before submission there is a dedicated Review screen showing address, vehicles/jobs, date/time, customer, final quote, payment choice, and required terms/consent. Confirmation is a full recap with booking reference, schedule, address, vehicles/services, amount/payment state, next steps, and Google Calendar + Apple/iCalendar actions.

Customer UI does not expose internal viscosity, capacity, filter, torque, reset instructions, or pricing mechanics. It may show customer-relevant charge line items such as additional oil.

## Pricing
Server authoritative. Client-supplied prices or technical vehicle values are never trusted. Existing bookings preserve their quoted values.

## Payment choice
Booking offers:
1. Pay now — Stripe collection is prepared at booking/payment time and reconciled by webhook.
2. Pay at appointment — booking creates a MOMS payment state of due_at_appointment and does not create a Stripe PaymentIntent merely for choosing this option.

## Collection after service
Booking/work-order workspace exposes Collect Payment against the finalized amount due. Supported collection intents:
- Cash: record MOMS payment method, amount, timestamp, and operator; no Stripe transaction.
- Card: create Stripe collection infrastructure only when collection begins.
- Payment Link: create a secure remote Stripe payment flow from the authoritative finalized invoice amount; operational delivery is through Resend.

Future in-person Stripe Terminal / Tap to Pay is a separate capability and must not be assumed until current Stripe platform/device requirements are evaluated.

## Invoice
The booking quote is not mutated into an after-the-fact amount. Service completion/finalization produces the authoritative amount owed. Pay-at-appointment collection is based on that finalized amount.

## Financial authority
Stripe is authoritative for Stripe financial transactions. Neon records MOMS business/payment relationships and non-Stripe methods such as cash. Stripe objects use deterministic MOMS identifiers. Never reconcile by email, phone, customer name, or amount.

## Communications
Stripe is financial infrastructure only. Resend handles MOMS operational email: booking confirmations, reminders, reschedules, cancellations, technician/service updates, invoices/payment-link delivery, completion messages, maintenance reminders, and review requests.

## Operations dashboard
Primary navigation:
Today → Schedule → Bookings → Customers → Vehicles → Payments → Services & Pricing → Settings.

Today is an operational command center, not an analytics landing page. Booking Detail is the principal workspace and owns status progression, service/job detail, finalization, invoice state, and Collect Payment.

## Release gates
Do not call a path GREEN until its exact deployed revision and customer journey are verified.
Current accepted production evidence:
- Native /book is live.
- Pay at Appointment booking completed successfully in production.
- Pay Now previously failed before Stripe due to an invalid Authorization header; backend normalization fix was deployed and must be re-tested before Pay Now is GREEN.
