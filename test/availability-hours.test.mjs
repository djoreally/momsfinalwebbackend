import test from "node:test";
import assert from "node:assert/strict";

// Unit tests for the per-weekday booking windows in
// apps/api/src/domain/business-hours.ts (winter schedule: Mon–Fri
// 08:00–16:00, Sat 10:00–14:00, Sun closed, America/New_York). These
// exercise the pure slot-generation layer that getAvailability in
// domain/availability.ts filters by appointment conflicts, so they need no
// database or running server.
const {
  BUSINESS_HOURS,
  businessWindowForDate,
  candidateSlotsForDate,
} = await import("../apps/api/src/domain/business-hours.ts");

const DURATION_MINUTES = 60; // a one-hour service

const localTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function assertSlotsWithin(slots, openTime, closeTime) {
  assert.ok(slots.length > 0, "expected at least one slot");
  for (const slot of slots) {
    assert.ok(
      localTime.format(slot.start) >= openTime,
      `slot starts ${localTime.format(slot.start)}, before open ${openTime}`,
    );
    assert.ok(
      localTime.format(slot.end) <= closeTime,
      `slot ends ${localTime.format(slot.end)}, after close ${closeTime}`,
    );
  }
  assert.equal(localTime.format(slots[0].start), openTime);
  assert.equal(localTime.format(slots[slots.length - 1].end), closeTime);
}

test("schedule map holds the winter hours per weekday", () => {
  for (const weekday of [1, 2, 3, 4, 5]) {
    assert.deepEqual(BUSINESS_HOURS[weekday], { openHour: 8, closeHour: 16 });
  }
  assert.deepEqual(BUSINESS_HOURS[6], { openHour: 10, closeHour: 14 });
  assert.equal(BUSINESS_HOURS[7], null);
});

test("weekday window resolves to 08:00–16:00", () => {
  // 2026-11-09 is a Monday; 2026-11-04 is a Wednesday.
  assert.deepEqual(businessWindowForDate("2026-11-09"), {
    openHour: 8,
    closeHour: 16,
  });
  assert.deepEqual(businessWindowForDate("2026-11-04"), {
    openHour: 8,
    closeHour: 16,
  });
});

test("weekday slots fall only within 08:00–16:00", () => {
  const slots = candidateSlotsForDate("2026-11-09", DURATION_MINUTES);
  // 30-minute steps from 08:00, last start 15:00 → 15 slots.
  assert.equal(slots.length, 15);
  assertSlotsWithin(slots, "08:00", "16:00");
});

test("Saturday window resolves to 10:00–14:00", () => {
  // 2026-11-07 is a Saturday.
  assert.deepEqual(businessWindowForDate("2026-11-07"), {
    openHour: 10,
    closeHour: 14,
  });
});

test("Saturday slots fall only within 10:00–14:00", () => {
  const slots = candidateSlotsForDate("2026-11-07", DURATION_MINUTES);
  // 30-minute steps from 10:00, last start 13:00 → 7 slots.
  assert.equal(slots.length, 7);
  assertSlotsWithin(slots, "10:00", "14:00");
});

test("Sunday is closed and returns zero slots", () => {
  // 2026-11-08 is a Sunday.
  assert.equal(businessWindowForDate("2026-11-08"), null);
  assert.deepEqual(candidateSlotsForDate("2026-11-08", DURATION_MINUTES), []);
});
