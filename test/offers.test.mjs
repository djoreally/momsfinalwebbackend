import test from "node:test";
import assert from "node:assert/strict";

// Unit tests for the offer registry / applyOffer (apps/api/src/domain/offers.ts).
// applyOffer is DB-free by design, so these run without a server:
//   node --test test/offers.test.mjs
// Importing the .ts source directly requires Node with type stripping
// enabled (Node >= 22.18 / 23+, on by default in Node 24).
import { applyOffer, getOffer, OfferError, OFFER_CODES } from "../apps/api/src/domain/offers.ts";

// A standard-priced quote for the $119 full-synthetic service with a 3%
// processing fee (fee on 11900 = 357), matching the PriceQuote shape.
function makeQuote(overrides = {}) {
  return {
    serviceId: "00000000-0000-0000-0000-000000000001",
    vehicleId: "00000000-0000-0000-0000-000000000002",
    currency: "usd",
    basePriceCents: 11900,
    oilCapacityQuarts: 5,
    includedQuarts: 5,
    extraQuarts: 0,
    extraQuartPriceCents: 1400,
    extraQuartChargeCents: 0,
    extraQuartWaived: false,
    processingFeePercent: 3,
    processingFeeCents: 357,
    processingFeeWaived: false,
    preTaxTotalCents: 12257,
    totalCents: 12257,
    durationMinutes: 45,
    pricingVersion: "moms-v2",
    offerCodeApplied: null,
    discountCents: 0,
    offerNote: null,
    ...overrides,
  };
}

function assertOfferError(fn, code) {
  assert.throws(fn, (error) => error instanceof OfferError && error.code === code);
}

test("registry contains every v1 code and excludes WINTER50", () => {
  const expected = [
    "SOCIAL99", "SOCIAL89", "WIPERS119",
    "FIRST20", "WIS-TEACHER-15", "WIS-STAFF-15", "WIS-STUDENT-10",
    "WIS-STUDENT-FIRST", "WIS-PARENT-10", "WIS-GAMEDAY-1",
    "TUESDAY15", "WORKWED10", "SATURDAY10", "FLEETTHU10",
    "WIS-GAMEDAY-2PLUS", "WIS-STAFF-GROUP",
    "TWOCAR20", "WIS-TEACHER-2CAR", "WIS-PARENT-2CAR",
    "WIS-TEACHER-FILTER", "WIS-STUDENT-WIPERS", "WIS-PARENT-CABIN",
    "WIS-STAFF-FILTER", "ROADTRIP",
  ];
  for (const code of expected) assert.ok(getOffer(code), `missing ${code}`);
  assert.equal(OFFER_CODES.length, expected.length);
  assert.equal(getOffer("WINTER50"), null);
});

test("SOCIAL89 replaces the base price with the flat price and waives the fee", () => {
  const { quotes, totalDiscountCents, offerCodeApplied } = applyOffer([makeQuote()], "SOCIAL89");
  assert.equal(quotes[0].basePriceCents, 8900);
  assert.equal(quotes[0].processingFeeCents, 0);
  assert.equal(quotes[0].processingFeeWaived, true);
  assert.equal(quotes[0].discountCents, 3000);
  assert.equal(quotes[0].totalCents, 8900);
  assert.equal(quotes[0].offerCodeApplied, "SOCIAL89");
  assert.equal(totalDiscountCents, 3000);
  assert.equal(offerCodeApplied, "SOCIAL89");
});

test("SOCIAL99 flat price also waives the fee", () => {
  const { quotes } = applyOffer([makeQuote()], "SOCIAL99");
  assert.equal(quotes[0].basePriceCents, 9900);
  assert.equal(quotes[0].discountCents, 2000);
  assert.equal(quotes[0].processingFeeCents, 0);
  assert.equal(quotes[0].totalCents, 9900);
});

test("WIPERS119 confirms the perk with no discount and the fee still applies", () => {
  const { quotes, totalDiscountCents } = applyOffer([makeQuote()], "WIPERS119");
  assert.equal(quotes[0].basePriceCents, 11900);
  assert.equal(quotes[0].discountCents, 0);
  assert.equal(quotes[0].processingFeeCents, 357);
  assert.equal(quotes[0].processingFeeWaived, false);
  assert.equal(quotes[0].totalCents, 12257);
  assert.equal(quotes[0].offerCodeApplied, "WIPERS119");
  assert.equal(totalDiscountCents, 0);
});

test("WIPERS119 is single-job only at booking", () => {
  assertOfferError(() => applyOffer([makeQuote(), makeQuote()], "WIPERS119"), "offer_single_job_only");
});

test("FIRST20 discounts only the first job of a two-job booking", () => {
  const { quotes, totalDiscountCents } = applyOffer([makeQuote(), makeQuote()], "FIRST20");
  assert.equal(quotes[0].discountCents, 2000);
  assert.equal(quotes[0].basePriceCents, 9900);
  assert.equal(quotes[0].processingFeeCents, 297);
  assert.equal(quotes[0].totalCents, 10197);
  assert.equal(quotes[1].discountCents, 0);
  assert.equal(quotes[1].basePriceCents, 11900);
  assert.equal(quotes[1].totalCents, 12257);
  assert.equal(quotes[1].offerCodeApplied, "FIRST20");
  assert.equal(totalDiscountCents, 2000);
});

test("WIS-GAMEDAY-2PLUS discounts each job when the minimum is met", () => {
  const { quotes, totalDiscountCents } = applyOffer([makeQuote(), makeQuote()], "WIS-GAMEDAY-2PLUS");
  for (const quote of quotes) {
    assert.equal(quote.discountCents, 1500);
    assert.equal(quote.basePriceCents, 10400);
    assert.equal(quote.totalCents, 10712);
  }
  assert.equal(totalDiscountCents, 3000);
});

test("WIS-GAMEDAY-2PLUS rejects a single-job booking", () => {
  assertOfferError(() => applyOffer([makeQuote()], "WIS-GAMEDAY-2PLUS"), "offer_min_jobs_not_met");
});

test("TWOCAR20 takes $20 off the cheapest job after the first", () => {
  const first = makeQuote();
  const priceySecond = makeQuote({
    extraQuarts: 2,
    extraQuartChargeCents: 2800,
    processingFeeCents: 441,
    preTaxTotalCents: 15141,
    totalCents: 15141,
  });
  const cheaperThird = makeQuote({
    extraQuarts: 1,
    extraQuartChargeCents: 1400,
    processingFeeCents: 399,
    preTaxTotalCents: 13699,
    totalCents: 13699,
  });
  const { quotes, totalDiscountCents } = applyOffer([first, priceySecond, cheaperThird], "TWOCAR20");
  assert.equal(quotes[0].discountCents, 0);
  assert.equal(quotes[1].discountCents, 0);
  assert.equal(quotes[1].totalCents, 15141);
  assert.equal(quotes[2].discountCents, 2000);
  assert.equal(quotes[2].basePriceCents, 9900);
  assert.equal(quotes[2].totalCents, 11639);
  assert.equal(totalDiscountCents, 2000);
});

// 2026-10-27 is a Tuesday and 2026-10-28 a Wednesday in America/New_York.
const TUESDAY_NOON_ET = new Date("2026-10-27T16:00:00.000Z");
const WEDNESDAY_NOON_ET = new Date("2026-10-28T16:00:00.000Z");
// 2026-10-28T01:30Z is still Tuesday evening in New York (21:30 EDT).
const TUESDAY_LATE_ET = new Date("2026-10-28T01:30:00.000Z");

test("TUESDAY15 applies to a Tuesday appointment (America/New_York)", () => {
  const { quotes } = applyOffer([makeQuote()], "TUESDAY15", { scheduledStart: TUESDAY_NOON_ET });
  assert.equal(quotes[0].discountCents, 1500);
  assert.equal(quotes[0].basePriceCents, 10400);
  assert.equal(quotes[0].totalCents, 10712);
});

test("TUESDAY15 uses the New York weekday, not the UTC weekday", () => {
  const { quotes } = applyOffer([makeQuote()], "TUESDAY15", { scheduledStart: TUESDAY_LATE_ET });
  assert.equal(quotes[0].discountCents, 1500);
});

test("TUESDAY15 rejects a Wednesday appointment at booking", () => {
  assertOfferError(
    () => applyOffer([makeQuote()], "TUESDAY15", { scheduledStart: WEDNESDAY_NOON_ET }),
    "offer_weekday_mismatch",
  );
});

test("provisional mode prices weekday/min-jobs offers without rejecting them", () => {
  const tuesday = applyOffer([makeQuote()], "TUESDAY15", {
    scheduledStart: WEDNESDAY_NOON_ET,
    mode: "provisional",
  });
  assert.equal(tuesday.quotes[0].discountCents, 1500);
  assert.match(tuesday.offerNote, /confirmed at booking/);

  const gameday = applyOffer([makeQuote()], "WIS-GAMEDAY-2PLUS", { mode: "provisional" });
  assert.equal(gameday.quotes[0].discountCents, 1500);
});

test("an offer on a non-$119 service does not apply in provisional mode", () => {
  const otherService = makeQuote({ basePriceCents: 9900, processingFeeCents: 297, preTaxTotalCents: 10197, totalCents: 10197 });
  const { quotes, offerCodeApplied, totalDiscountCents } = applyOffer([otherService], "FIRST20", { mode: "provisional" });
  assert.equal(quotes[0].offerCodeApplied, null);
  assert.equal(quotes[0].discountCents, 0);
  assert.equal(quotes[0].totalCents, 10197);
  assert.equal(offerCodeApplied, null);
  assert.equal(totalDiscountCents, 0);
});

test("an offer on a non-$119 service fails the booking", () => {
  const otherService = makeQuote({ basePriceCents: 9900, processingFeeCents: 297, preTaxTotalCents: 10197, totalCents: 10197 });
  assertOfferError(() => applyOffer([otherService], "FIRST20"), "offer_not_applicable");
});

test("unknown codes are rejected in both modes", () => {
  assertOfferError(() => applyOffer([makeQuote()], "NOPE25"), "offer_not_recognized");
  assertOfferError(() => applyOffer([makeQuote()], "NOPE25", { mode: "provisional" }), "offer_not_recognized");
  assertOfferError(() => applyOffer([makeQuote()], "WINTER50"), "offer_not_recognized");
});
