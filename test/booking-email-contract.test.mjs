import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const email=readFileSync(new URL("../apps/api/src/services/booking-email.ts",import.meta.url),"utf8");
const route=readFileSync(new URL("../apps/api/src/routes/bookings.ts",import.meta.url),"utf8");
const migration=readFileSync(new URL("../packages/db/sql/002_booking_email_deliveries.sql",import.meta.url),"utf8");

test("all booking messages use the working support sender",()=>{
 assert.match(email,/MOMS Mobile Oil Change <support@momsoilchange.com>/);
 assert.doesNotMatch(email,/bookings@momsoilchange.com/);
});
test("customer and owner messages have distinct idempotent delivery records",()=>{
 assert.match(email,/\["customer","business"\]/);
 assert.match(email,/ON CONFLICT \(booking_id,recipient_role\) DO NOTHING/);
 assert.match(migration,/PRIMARY KEY \(booking_id,recipient_role\)/);
 assert.match(email,/Idempotency-Key/);
 assert.doesNotMatch(email,/bcc:/i);
});
test("retry endpoint must reject requests when no scheduler secret is configured",()=>{
 assert.match(route,/if \(!secret \|\| c\.req\.header\("authorization"\) !==/);
 assert.match(email,/retryDueBookingEmails/);
});
test("booking confirmation persists provider ID and failure state",()=>{
 assert.match(email,/provider_message_id=/);
 assert.match(email,/next_attempt_at=/);
 assert.match(email,/status='accepted'/);
 assert.match(email,/status IN \('pending','failed'\)/);
});
