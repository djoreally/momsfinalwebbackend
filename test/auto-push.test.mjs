import test from "node:test";
import assert from "node:assert/strict";

// Unit tests for the prepaid auto-push trigger (no network, no database:
// the trigger's dependencies are injected). The integration contract —
// webhook -> claim -> Service Writer call — is exercised through fakes
// that record every call, so "creates nothing" is asserted on call counts.
const {
  decideAutoPush,
  triggerPrepaidAutoPush,
  callServiceWriterAutoPush,
  getServiceWriterAutoPushConfig,
  isAutoPushClaimLive,
  AUTO_PUSH_CLAIM_STALE_MS,
} = await import("../apps/api/src/services/service-writer-auto-push.ts");

const BOOKING_ID = "e529c941-9f5e-4dce-be31-88ab334165d7";
const APPOINTMENT_ID = "a1111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-10-29T15:00:00.000Z");

const facts = (overrides = {}) => ({
  status: "confirmed",
  pushedSwAppointmentId: null,
  neverPush: false,
  autoPushClaimedAt: null,
  ...overrides,
});

function makeDeps({ booking = facts(), claimResult = true, callResult } = {}) {
  const calls = { claim: 0, recordFailure: [], recordSuccess: 0, callServiceWriter: 0 };
  let current = booking;
  const deps = {
    now: () => NOW,
    getBooking: async () => current,
    claim: async () => {
      calls.claim += 1;
      return claimResult;
    },
    recordFailure: async (_id, reason) => {
      calls.recordFailure.push(reason);
    },
    recordSuccess: async () => {
      calls.recordSuccess += 1;
    },
    callServiceWriter: async () => {
      calls.callServiceWriter += 1;
      return callResult ?? { ok: true, outcome: "pushed", appointmentId: APPOINTMENT_ID };
    },
  };
  return { deps, calls, setBooking: (next) => { current = next; } };
}

test("decideAutoPush: a prepaid, unpushed, uncancelled booking is attempted", () => {
  assert.deepEqual(decideAutoPush(facts(), NOW), { action: "attempt" });
});

test("decideAutoPush: cancelled bookings are never auto-pushed", () => {
  assert.deepEqual(decideAutoPush(facts({ status: "cancelled" }), NOW), { action: "skip", reason: "cancelled" });
});

test("decideAutoPush: already-pushed and never-push bookings are skipped", () => {
  assert.deepEqual(decideAutoPush(facts({ pushedSwAppointmentId: APPOINTMENT_ID }), NOW), {
    action: "skip",
    reason: "already_pushed",
  });
  assert.deepEqual(decideAutoPush(facts({ neverPush: true }), NOW), { action: "skip", reason: "never_push" });
});

test("decideAutoPush: a live claim blocks a duplicate trigger; a stale claim does not", () => {
  const live = new Date(NOW - 60_000).toISOString();
  const stale = new Date(NOW - AUTO_PUSH_CLAIM_STALE_MS - 1).toISOString();
  assert.equal(isAutoPushClaimLive(live, NOW), true);
  assert.equal(isAutoPushClaimLive(stale, NOW), false);
  assert.deepEqual(decideAutoPush(facts({ autoPushClaimedAt: live }), NOW), { action: "skip", reason: "claim_live" });
  assert.deepEqual(decideAutoPush(facts({ autoPushClaimedAt: stale }), NOW), { action: "attempt" });
});

test("trigger: prepaid completion pushes once and records success", async () => {
  const { deps, calls } = makeDeps();
  const result = await triggerPrepaidAutoPush(BOOKING_ID, deps);
  assert.deepEqual(result, { outcome: "pushed", appointmentId: APPOINTMENT_ID });
  assert.equal(calls.claim, 1);
  assert.equal(calls.callServiceWriter, 1);
  assert.equal(calls.recordSuccess, 1);
  assert.deepEqual(calls.recordFailure, []);
});

test("trigger: duplicate fire (webhook retry) after a push creates nothing", async () => {
  const { deps, calls } = makeDeps({ booking: facts({ pushedSwAppointmentId: APPOINTMENT_ID }) });
  const result = await triggerPrepaidAutoPush(BOOKING_ID, deps);
  assert.deepEqual(result, { outcome: "already_pushed", appointmentId: APPOINTMENT_ID });
  assert.equal(calls.claim, 0);
  assert.equal(calls.callServiceWriter, 0);
});

test("trigger: losing the atomic claim creates nothing", async () => {
  const { deps, calls } = makeDeps({ claimResult: false });
  const result = await triggerPrepaidAutoPush(BOOKING_ID, deps);
  assert.equal(result.outcome, "skipped");
  assert.equal(calls.callServiceWriter, 0);
  assert.deepEqual(calls.recordFailure, []);
});

test("trigger: cancelled-before-push is not pushed and nothing is claimed", async () => {
  const { deps, calls } = makeDeps({ booking: facts({ status: "cancelled" }) });
  const result = await triggerPrepaidAutoPush(BOOKING_ID, deps);
  assert.deepEqual(result, { outcome: "skipped", reason: "cancelled" });
  assert.equal(calls.claim, 0);
  assert.equal(calls.callServiceWriter, 0);
});

test("trigger: a failed Service Writer push records the reason and stamps nothing", async () => {
  const reason = 'Service "Mystery Service" does not match any active Service Writer catalog service.';
  const { deps, calls } = makeDeps({ callResult: { ok: false, reason } });
  const result = await triggerPrepaidAutoPush(BOOKING_ID, deps);
  assert.deepEqual(result, { outcome: "failed", reason });
  assert.deepEqual(calls.recordFailure, [reason]);
  assert.equal(calls.recordSuccess, 0);
});

test("trigger: unknown booking is a no-op", async () => {
  const { deps, calls } = makeDeps({ booking: null });
  deps.getBooking = async () => null;
  const result = await triggerPrepaidAutoPush(BOOKING_ID, deps);
  assert.deepEqual(result, { outcome: "booking_not_found" });
  assert.equal(calls.claim, 0);
  assert.equal(calls.callServiceWriter, 0);
});

test("callServiceWriterAutoPush: posts to the internal endpoint with the shared secret", async () => {
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { status: "created", appointment_id: APPOINTMENT_ID, message: "created" } }),
    };
  };
  const result = await callServiceWriterAutoPush(
    { baseUrl: "https://sw.example.com/", secret: "test-secret" },
    BOOKING_ID,
    fetchFn,
  );
  assert.deepEqual(result, { ok: true, outcome: "pushed", appointmentId: APPOINTMENT_ID });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://sw.example.com/api/internal/website-bookings/auto-push");
  assert.equal(seen[0].init.headers["x-sw-push-secret"], "test-secret");
  assert.deepEqual(JSON.parse(seen[0].init.body), { booking_id: BOOKING_ID });
});

test("callServiceWriterAutoPush: a linked result and an already-pushed result are successes", async () => {
  const fetchFor = (status) => async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { status, appointment_id: APPOINTMENT_ID, message: "ok" } }),
  });
  const config = { baseUrl: "https://sw.example.com", secret: "s" };
  assert.deepEqual(await callServiceWriterAutoPush(config, BOOKING_ID, fetchFor("linked")), {
    ok: true,
    outcome: "linked",
    appointmentId: APPOINTMENT_ID,
  });
  assert.deepEqual(await callServiceWriterAutoPush(config, BOOKING_ID, fetchFor("already_pushed")), {
    ok: true,
    outcome: "already_pushed",
    appointmentId: APPOINTMENT_ID,
  });
});

test("callServiceWriterAutoPush: pipeline failures and HTTP errors surface the real reason", async () => {
  const config = { baseUrl: "https://sw.example.com", secret: "s" };
  const blocked = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { status: "failed", appointment_id: null, message: "Address could not be geocoded." } }),
  });
  assert.deepEqual(await callServiceWriterAutoPush(config, BOOKING_ID, blocked), {
    ok: false,
    reason: "Address could not be geocoded.",
  });

  const httpError = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: { code: "auto_push_not_configured", message: "not configured" } }),
  });
  assert.deepEqual(await callServiceWriterAutoPush(config, BOOKING_ID, httpError), { ok: false, reason: "not configured" });

  const unreachable = async () => {
    throw new Error("fetch failed");
  };
  const down = await callServiceWriterAutoPush(config, BOOKING_ID, unreachable);
  assert.equal(down.ok, false);
  assert.match(down.reason, /fetch failed/);
});

test("getServiceWriterAutoPushConfig: requires both env values, trims the base URL", () => {
  assert.equal(getServiceWriterAutoPushConfig({}), null);
  assert.equal(getServiceWriterAutoPushConfig({ SERVICE_WRITER_API_URL: "https://sw.example.com" }), null);
  assert.equal(getServiceWriterAutoPushConfig({ SW_PUSH_SECRET: "x" }), null);
  assert.deepEqual(
    getServiceWriterAutoPushConfig({ SERVICE_WRITER_API_URL: "https://sw.example.com//", SW_PUSH_SECRET: " x " }),
    { baseUrl: "https://sw.example.com", secret: "x" },
  );
});
