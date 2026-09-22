# MOMS Platform Architecture

Browser -> MOMS API -> domain services -> Drizzle -> Neon PostgreSQL.

The browser never connects directly to Neon.

## Deployment

- API: Hono on Vercel Node.js
- Database: existing MOMS Newsletter Neon project
- ORM: Drizzle
- Payments: Stripe through API/webhooks

## Domain spine

Customer -> Vehicle -> Service -> Price -> Availability -> Appointment -> Payment -> Work Order -> Completion.
