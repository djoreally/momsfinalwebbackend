import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Booking notifications (spec decisions D1–D4): quiet hours, reminder
// moment selection, the customer-safe appointment view, and the
// reschedule orchestration. The domain module is pure / dependency-
// injected, so these run with no database and no network — the SW
// call and the DB writes are fakes that record every call, in the
// style of test/auto-push.test.mjs. Wiring that is DB-bound (routes,
// migration, cron, stamp transport) is asserted as source contracts,
// in the style of test/booking-email-contract.test.mjs.
const {
  generateManageToken,
  isQuietHours,
  reminderMomentState,
  zonedDateTimeToDate,
  shapeAppointmentView,
  performReschedule,
  RESCHEDULE_NOT_AVAILABLE_MESSAGE,
} = await import("../apps/api/src/domain/notifications.ts");

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

/* ---------------- manage token ---------------- */

test("manage tokens are long, url-safe, and unique", () => {
  const a = generateManageToken();
  const b = generateManageToken();
  assert.ok(a.length >= 32, `token too short: ${a.length}`);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b);
});

/* ---------------- quiet hours (D4) ---------------- */

test("quiet hours are 21:00-08:00 America/New_York", () => {
  // Nov 2026 is EST (UTC-5).
  assert.equal(isQuietHours(new Date("2026-11-04T01:30:00.000Z")), false); // Nov 3, 20:30 EST
  assert.equal(isQuietHours(new Date("2026-11-04T01:59:59.000Z")), false); // 20:59:59 EST
  assert.equal(isQuietHours(new Date("2026-11-04T02:00:00.000Z")), true); // 21:00 EST sharp
  assert.equal(isQuietHours(new Date("2026-11-04T04:00:00.000Z")), true); // 23:00 EST
  assert.equal(isQuietHours(new Date("2026-11-04T12:59:59.000Z")), true); // 07:59:59 EST
  assert.equal(isQuietHours(new Date("2026-11-04T13:00:00.000Z")), false); // 08:00 EST sharp
  assert.equal(isQuietHours(new Date("2026-11-04T17:00:00.000Z")), false); // 12:00 EST
});

test("quiet hours track DST transitions", () => {
  // Spring forward 2026: clocks jump 02:00 EST -> 03:00 EDT on Mar 8.
  assert.equal(isQuietHours(new Date("2026-03-08T07:30:00.000Z")), true); // 03:30 EDT
  assert.equal(isQuietHours(new Date("2026-03-08T12:00:00.000Z")), false); // 08:00 EDT
  // Fall back 2026: 02:00 EDT -> 01:00 EST on Nov 1.
  assert.equal(isQuietHours(new Date("2026-11-01T05:30:00.000Z")), true); // 01:30 EDT
  assert.equal(isQuietHours(new Date("2026-11-01T13:00:00.000Z")), false); // 08:00 EST
});

/* ---------------- reminder moments (D1) ---------------- */

const START = new Date("2026-11-10T15:00:00.000Z");
const hoursBefore = (h) => new Date(START.getTime() - h * 3_600_000);

test("reminder moments become due at their thresholds", () => {
  assert.equal(reminderMomentState(START, "reminder_24h", hoursBefore(25)), "not_due");
  assert.equal(reminderMomentState(START, "reminder_24h", hoursBefore(24)), "due");
  assert.equal(reminderMomentState(START, "reminder_24h", hoursBefore(23)), "due");
  assert.equal(reminderMomentState(START, "reminder_1h", hoursBefore(23)), "not_due");
  assert.equal(reminderMomentState(START, "reminder_1h", hoursBefore(1)), "due");
  assert.equal(reminderMomentState(START, "reminder_24h", hoursBefore(0.5)), "due");
  assert.equal(reminderMomentState(START, "reminder_1h", hoursBefore(0.5)), "due");
});

test("reminder moments expire at the appointment time and are never sent late", () => {
  assert.equal(reminderMomentState(START, "reminder_24h", START), "expired");
  assert.equal(reminderMomentState(START, "reminder_1h", START), "expired");
  assert.equal(reminderMomentState(START, "reminder_24h", hoursBefore(-2)), "expired");
});

/* ---------------- zoned time conversion ---------------- */

test("reschedule date+time is interpreted in America/New_York", () => {
  // EST (UTC-5)
  assert.equal(zonedDateTimeToDate("2026-11-04", "15:30").toISOString(), "2026-11-04T20:30:00.000Z");
  // EDT (UTC-4)
  assert.equal(zonedDateTimeToDate("2026-07-04", "09:00").toISOString(), "2026-07-04T13:00:00.000Z");
});

/* ---------------- appointment view ---------------- */

const fakeBooking = (overrides = {}) => ({
  id: "b1111111-1111-4111-8111-111111111111",
  customerId: "c1111111-1111-4111-8111-111111111111",
  status: "confirmed",
  scheduledStart: new Date("2026-11-03T20:30:00.000Z"),
  scheduledEnd: new Date("2026-11-03T21:15:00.000Z"),
  serviceAddressLine1: "318 Forest Ave",
  serviceAddressLine2: null,
  serviceCity: "Ambler",
  serviceState: "PA",
  servicePostalCode: "19002",
  quotedTotalCents: 12900,
  manageToken: "MANAGE_TOKEN_SECRET",
  swManagementToken: "SW_TOKEN_SECRET",
  customer: { firstName: "Jill", lastName: "Tarricone", email: "jill@example.com", phone: "+12155550100" },
  jobs: [
    {
      quotedPriceCents: 12900,
      vehicle: { year: 2010, make: "Subaru", model: "Forester" },
      service: { name: "Full Synthetic Oil Change" },
    },
  ],
  ...overrides,
});

test("appointment view is customer-safe and complete", () => {
  const view = shapeAppointmentView(fakeBooking());
  assert.equal(view.bookingId, "b1111111-1111-4111-8111-111111111111");
  assert.equal(view.status, "confirmed");
  assert.equal(view.scheduledStart, "2026-11-03T20:30:00.000Z");
  assert.equal(view.quotedTotalCents, 12900);
  assert.equal(view.customerFirstName, "Jill");
  assert.deepEqual(view.jobs, [
    { serviceName: "Full Synthetic Oil Change", vehicleLabel: "2010 Subaru Forester", priceCents: 12900 },
  ]);
  assert.equal(view.canReschedule, true);
  const serialized = JSON.stringify(view);
  assert.doesNotMatch(serialized, /SW_TOKEN_SECRET/);
  assert.doesNotMatch(serialized, /MANAGE_TOKEN_SECRET/);
  assert.doesNotMatch(serialized, /jill@example\.com/);
  assert.doesNotMatch(serialized, /\+12155550100/);
  assert.doesNotMatch(serialized, /swManagementToken|manageToken|email|phone/i);
});

test("canReschedule requires the SW token and an open booking", () => {
  assert.equal(shapeAppointmentView(fakeBooking({ swManagementToken: null })).canReschedule, false);
  assert.equal(shapeAppointmentView(fakeBooking({ status: "cancelled" })).canReschedule, false);
  assert.equal(shapeAppointmentView(fakeBooking({ status: "completed" })).canReschedule, false);
});

/* ---------------- reschedule orchestration (D2) ---------------- */

function fakeDeps(booking, swResult) {
  const calls = { sw: [], updates: [], notifications: [] };
  return {
    calls,
    deps: {
      loadBookingByToken: async () => booking,
      callSwReschedule: async (input) => {
        calls.sw.push(input);
        return swResult;
      },
      updateBookingSchedule: async (bookingId, start, end) => {
        calls.updates.push({ bookingId, start, end });
      },
      notifyChanged: async (b) => {
        calls.notifications.push(b);
      },
    },
  };
}

test("reschedule with an unknown token touches nothing", async () => {
  const { deps, calls } = fakeDeps(null, { success: true });
  const outcome = await performReschedule(deps, "nope", { newDate: "2026-11-04", newTime: "15:30" });
  assert.equal(outcome.kind, "not_found");
  assert.equal(calls.sw.length, 0);
  assert.equal(calls.updates.length, 0);
});

test("reschedule without an SW token is not available and changes nothing", async () => {
  const { deps, calls } = fakeDeps(fakeBooking({ swManagementToken: null }), { success: true });
  const outcome = await performReschedule(deps, "tok", { newDate: "2026-11-04", newTime: "15:30" });
  assert.equal(outcome.kind, "not_available");
  assert.equal(calls.sw.length, 0);
  assert.equal(calls.updates.length, 0);
  assert.match(RESCHEDULE_NOT_AVAILABLE_MESSAGE, /\(215\) 767-2125/);
});

test("an SW refusal is returned verbatim and moves nothing", async () => {
  const message = "Reschedule must be at least 24 hours before the appointment.";
  const { deps, calls } = fakeDeps(fakeBooking(), { success: false, message });
  const outcome = await performReschedule(deps, "tok", { newDate: "2026-11-04", newTime: "15:30" });
  assert.equal(outcome.kind, "sw_failed");
  assert.equal(outcome.message, message);
  assert.equal(calls.sw.length, 1);
  assert.equal(calls.sw[0].managementToken, "SW_TOKEN_SECRET");
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.notifications.length, 0);
});

test("a successful SW move updates our booking, preserves duration, and notifies", async () => {
  const { deps, calls } = fakeDeps(fakeBooking(), { success: true });
  const outcome = await performReschedule(deps, "tok", { newDate: "2026-11-04", newTime: "15:30" });
  assert.equal(outcome.kind, "success");
  // Nov 4 15:30 EST = 20:30Z; original duration was 45 minutes.
  assert.equal(outcome.scheduledStart, "2026-11-04T20:30:00.000Z");
  assert.equal(outcome.scheduledEnd, "2026-11-04T21:15:00.000Z");
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].bookingId, "b1111111-1111-4111-8111-111111111111");
  assert.equal(calls.updates[0].start.toISOString(), "2026-11-04T20:30:00.000Z");
  assert.equal(calls.updates[0].end.toISOString(), "2026-11-04T21:15:00.000Z");
  assert.equal(calls.notifications.length, 1);
  assert.equal(new Date(calls.notifications[0].scheduledStart).toISOString(), "2026-11-04T20:30:00.000Z");
});

/* ---------------- source contracts ---------------- */

test("migration 007 creates the storage with the fire-once constraint", () => {
  const migration = read("../packages/db/sql/007_booking_notifications.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS moms_ops\.push_subscriptions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS moms_ops\.booking_notifications/);
  assert.match(migration, /UNIQUE \(booking_id, moment, channel\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS manage_token text/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS sw_management_token text/);
  assert.match(migration, /bookings_manage_token_unique/);
});

test("manage token is minted in the booking creation flow", () => {
  const domain = read("../apps/api/src/domain/bookings.ts");
  const repository = read("../apps/api/src/repositories/bookings.ts");
  assert.match(domain, /manageToken: generateManageToken\(\)/);
  assert.match(repository, /manage_token/);
});

test("confirmation email carries the manage link for the customer role only", () => {
  const email = read("../apps/api/src/services/booking-email.ts");
  assert.match(email, /role === "customer" && booking\.manageToken/);
  assert.match(email, /https:\/\/momsoilchange\.com\/appointment\//);
  assert.match(email, /Manage your appointment/);
});

test("sweep route exists behind the scheduler guard; sweeps run on an outside trigger, not Vercel crons", () => {
  const route = read("../apps/api/src/routes/bookings.ts");
  assert.match(route, /"\/notification-sweep"/);
  assert.match(route, /runNotificationSweep/);
  // Ty's outside-trigger decision (PR #25): the sweeps are driven by
  // an external scheduler hitting the CRON_SECRET-guarded routes.
  // vercel.json must carry NO */15 sweep crons (Hobby also rejects
  // them at deploy time); only the pre-existing daily health cron
  // stays.
  const vercel = JSON.parse(read("../vercel.json"));
  const cronPaths = vercel.crons.map((c) => `${c.schedule} ${c.path}`);
  assert.ok(!cronPaths.some((p) => p.includes("/v1/bookings/notification-sweep")), "sweep must not be a Vercel cron");
  assert.ok(!cronPaths.some((p) => p.includes("/v1/bookings/retry-due-notifications")), "retry sweep must not be a Vercel cron");
  assert.ok(cronPaths.includes("0 12 * * * /health/database"));
});

test("push-stamp accepts and stores an optional SW management token", () => {
  const route = read("../apps/api/src/routes/internal-website-bookings.ts");
  const repository = read("../apps/api/src/repositories/internal-website-bookings.ts");
  assert.match(route, /managementToken: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(512\)\.optional\(\)/);
  assert.match(route, /storeInternalWebsiteBookingSwManagementToken/);
  assert.match(repository, /sw_management_token = COALESCE\(\$\{managementToken \?\? null\}, sw_management_token\)/);
  assert.match(repository, /storeInternalWebsiteBookingSwManagementToken/);
});
