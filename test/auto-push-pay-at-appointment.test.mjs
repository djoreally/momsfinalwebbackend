import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Pay-at-appointment auto-push (Ty, 2026-10-30: EVERY website booking
// auto-pushes). The trigger is the same one the prepaid webhook path
// uses — these tests exercise it with the facts a booking carries at
// the moment chooseBookingPayment finalizes it as due_at_appointment,
// plus the two-fire sequence (creation-time push, then the payment
// webhook) that must still produce exactly one push.
const { triggerBookingAutoPush, triggerPrepaidAutoPush } = await import(
  "../apps/api/src/services/service-writer-auto-push.ts"
);
// The wired runner is asserted as a source contract below (in the
// style of test/booking-email-contract.test.mjs): it imports the
// repositories, which the test runner's type stripping cannot load.

const BOOKING_ID = "e529c941-9f5e-4dce-be31-88ab334165d7";
const APPOINTMENT_ID = "a1111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-10-30T15:00:00.000Z");

// Stateful fake world: recordSuccess stamps the booking the way the
// real repository + Service Writer stamp do, so a second trigger fire
// observes the pushed state.
function makeWorld({ callResults = [] } = {}) {
  const calls = { claim: 0, recordFailure: [], recordSuccess: 0, callServiceWriter: 0 };
  let current = {
    status: "confirmed",
    pushedSwAppointmentId: null,
    neverPush: false,
    autoPushClaimedAt: null,
  };
  const deps = {
    now: () => NOW,
    getBooking: async () => current,
    claim: async () => {
      calls.claim += 1;
      if (current.pushedSwAppointmentId || current.neverPush || current.status === "cancelled") return false;
      current = { ...current, autoPushClaimedAt: new Date(NOW).toISOString() };
      return true;
    },
    recordFailure: async (_id, reason) => {
      calls.recordFailure.push(reason);
      current = { ...current, autoPushClaimedAt: null };
    },
    recordSuccess: async () => {
      calls.recordSuccess += 1;
      current = { ...current, pushedSwAppointmentId: APPOINTMENT_ID };
    },
    callServiceWriter: async () => {
      calls.callServiceWriter += 1;
      return callResults[calls.callServiceWriter - 1] ?? { ok: true, outcome: "pushed", appointmentId: APPOINTMENT_ID };
    },
  };
  return { deps, calls, setFacts: (next) => { current = { ...current, ...next }; } };
}

test("pay-at-appointment: a booking finalized as due_at_appointment is claimed and pushed", async () => {
  const { deps, calls } = makeWorld();
  const result = await triggerBookingAutoPush(BOOKING_ID, deps);
  assert.deepEqual(result, { outcome: "pushed", appointmentId: APPOINTMENT_ID });
  assert.equal(calls.claim, 1);
  assert.equal(calls.callServiceWriter, 1);
  assert.equal(calls.recordSuccess, 1);
  assert.deepEqual(calls.recordFailure, []);
});

test("pay-at-appointment: the trigger used is the prepaid trigger (one push path)", () => {
  assert.equal(triggerBookingAutoPush, triggerPrepaidAutoPush);
});

test("two-fire sequence: creation-time push makes the later payment webhook a no-op", async () => {
  const { deps, calls } = makeWorld();
  // Fire 1: chooseBookingPayment records due_at_appointment.
  const first = await triggerBookingAutoPush(BOOKING_ID, deps);
  assert.equal(first.outcome, "pushed");
  // Fire 2: the customer later pays and the Stripe webhook fires the
  // same trigger — the booking is already pushed, nothing is created.
  const second = await triggerBookingAutoPush(BOOKING_ID, deps);
  assert.deepEqual(second, { outcome: "already_pushed", appointmentId: APPOINTMENT_ID });
  assert.equal(calls.claim, 1);
  assert.equal(calls.callServiceWriter, 1);
  assert.equal(calls.recordSuccess, 1);
});

test("pay-at-appointment: a failed push records the reason, releases the claim, and a retry can succeed", async () => {
  const reason = "Service Writer returned HTTP 503";
  const { deps, calls } = makeWorld({
    callResults: [{ ok: false, reason }, { ok: true, outcome: "pushed", appointmentId: APPOINTMENT_ID }],
  });
  const first = await triggerBookingAutoPush(BOOKING_ID, deps);
  assert.deepEqual(first, { outcome: "failed", reason });
  assert.deepEqual(calls.recordFailure, [reason]);
  // Claim was released with the failure, so the booking is still
  // attemptable (it also remains visible in the manual queue).
  const second = await triggerBookingAutoPush(BOOKING_ID, deps);
  assert.equal(second.outcome, "pushed");
  assert.equal(calls.callServiceWriter, 2);
});

test("pay-at-appointment: cancelled and never-push bookings are never claimed", async () => {
  const cancelled = makeWorld();
  cancelled.setFacts({ status: "cancelled" });
  assert.deepEqual(await triggerBookingAutoPush(BOOKING_ID, cancelled.deps), {
    outcome: "skipped",
    reason: "cancelled",
  });
  assert.equal(cancelled.calls.claim, 0);
  assert.equal(cancelled.calls.callServiceWriter, 0);

  const neverPush = makeWorld();
  neverPush.setFacts({ neverPush: true });
  assert.deepEqual(await triggerBookingAutoPush(BOOKING_ID, neverPush.deps), {
    outcome: "skipped",
    reason: "never_push",
  });
  assert.equal(neverPush.calls.claim, 0);
  assert.equal(neverPush.calls.callServiceWriter, 0);
});

test("wiring contract: both trigger sites route through the shared runner", () => {
  const payments = readFileSync(new URL("../apps/api/src/domain/payments.ts", import.meta.url), "utf8");
  const webhooks = readFileSync(new URL("../apps/api/src/routes/stripe-webhooks.ts", import.meta.url), "utf8");
  const runner = readFileSync(
    new URL("../apps/api/src/services/service-writer-auto-push-runner.ts", import.meta.url),
    "utf8",
  );
  // The pay_at_appointment branch of the payment choice is a trigger site.
  assert.match(payments, /runBookingAutoPush\(booking\.id, "pay_at_appointment"\)/);
  // The prepaid webhook still triggers, through the same runner.
  assert.match(webhooks, /runBookingAutoPush\(bookingId, "stripe_webhook_prepaid"\)/);
  // The runner is the one place wired to the claim and the SW call.
  assert.match(runner, /claimInternalWebsiteBookingAutoPush/);
  assert.match(runner, /callServiceWriterAutoPush/);
  assert.match(runner, /recordInternalWebsiteBookingAutoPushFailure/);
  // Fail-safe shape: unconfigured is an early logged return, and the
  // attempt itself is wrapped so the runner can never throw into the
  // payment choice or the webhook.
  assert.match(runner, /booking_auto_push_not_configured/);
  assert.match(runner, /try \{[\s\S]*triggerBookingAutoPush[\s\S]*\} catch \(error\)/);
});
