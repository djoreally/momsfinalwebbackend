import test from "node:test";
import assert from "node:assert/strict";

// Unit tests for the per-job price build (owner ruling, 2026-10-30):
// every job is priced per vehicle / per service as
//   subtotal + waste oil fee + card processing fee + tax
// where processing = fee % x (subtotal + waste) and tax = rate % x subtotal.
//
// The pure math lives in apps/api/src/domain/price-components.ts (used by
// pricing.ts for standard quotes and by offers.ts when repricing around a
// discount); both modules are DB-free, so these run without a server:
//   node --test test/pricing-components.test.mjs
import { calculatePriceComponents } from "../apps/api/src/domain/price-components.ts";
import { applyOffer } from "../apps/api/src/domain/offers.ts";

// Builds the standard quote pricing.ts produces for a service, composed
// through the same shared helper.
function makeStandardQuote({ basePriceCents, extraQuartChargeCents = 0 }) {
  const serviceSubtotalCents = basePriceCents + extraQuartChargeCents;
  const components = calculatePriceComponents({
    serviceSubtotalCents,
    wasteFeeCents: 400,
    processingFeePercent: 3,
    processingFeeWaived: false,
    taxRatePercent: 6,
  });
  return {
    serviceId: "00000000-0000-0000-0000-000000000001",
    vehicleId: "00000000-0000-0000-0000-000000000002",
    currency: "usd",
    basePriceCents,
    oilCapacityQuarts: 5,
    includedQuarts: 5,
    extraQuarts: 0,
    extraQuartPriceCents: 1400,
    extraQuartChargeCents,
    extraQuartWaived: false,
    serviceSubtotalCents,
    wasteFeeCents: 400,
    processingFeePercent: 3,
    processingFeeCents: components.processingFeeCents,
    processingFeeWaived: false,
    taxRatePercent: 6,
    taxCents: components.taxCents,
    preTaxTotalCents: components.preTaxTotalCents,
    totalCents: components.totalCents,
    durationMinutes: 45,
    pricingVersion: "moms-v2",
    offerCodeApplied: null,
    discountCents: 0,
    offerNote: null,
  };
}

test("Full Synthetic $119: subtotal 11900 + waste 400 + processing 369 + tax 714 = 13383", () => {
  const components = calculatePriceComponents({
    serviceSubtotalCents: 11900,
    wasteFeeCents: 400,
    processingFeePercent: 3,
    processingFeeWaived: false,
    taxRatePercent: 6,
  });
  assert.equal(components.processingFeeCents, 369); // 3% of (11900 + 400)
  assert.equal(components.taxCents, 714); // 6% of 11900
  assert.equal(components.preTaxTotalCents, 12669); // 11900 + 400 + 369
  assert.equal(components.totalCents, 13383);
});

test("European $149: subtotal 14900 + waste 400 + processing 459 + tax 894 = 16653", () => {
  const components = calculatePriceComponents({
    serviceSubtotalCents: 14900,
    wasteFeeCents: 400,
    processingFeePercent: 3,
    processingFeeWaived: false,
    taxRatePercent: 6,
  });
  assert.equal(components.processingFeeCents, 459); // 3% of (14900 + 400)
  assert.equal(components.taxCents, 894); // 6% of 14900
  assert.equal(components.preTaxTotalCents, 15759);
  assert.equal(components.totalCents, 16653);
});

test("a waived processing fee is 0 while waste and tax still apply", () => {
  const components = calculatePriceComponents({
    serviceSubtotalCents: 8900,
    wasteFeeCents: 400,
    processingFeePercent: 3,
    processingFeeWaived: true,
    taxRatePercent: 6,
  });
  assert.equal(components.processingFeeCents, 0);
  assert.equal(components.taxCents, 534); // 6% of 8900
  assert.equal(components.preTaxTotalCents, 9300); // 8900 + 400 + 0
  assert.equal(components.totalCents, 9834);
});

test("a two-job booking total is the sum of the job totals (13383 + 16653 = 30036)", () => {
  const fullSynthetic = makeStandardQuote({ basePriceCents: 11900 });
  const european = makeStandardQuote({ basePriceCents: 14900 });
  assert.equal(fullSynthetic.totalCents, 13383);
  assert.equal(european.totalCents, 16653);
  // domain/bookings.ts composes quoted_total_cents as exactly this sum.
  const bookingTotalCents = [fullSynthetic, european].reduce((sum, q) => sum + q.totalCents, 0);
  assert.equal(bookingTotalCents, 30036);
});

test("SOCIAL89: the $89 promise is the service price; waste + tax compose on top, processing stays waived", () => {
  const { quotes, totalDiscountCents } = applyOffer(
    [makeStandardQuote({ basePriceCents: 11900 })],
    "SOCIAL89",
  );
  const quote = quotes[0];
  assert.equal(quote.basePriceCents, 8900);
  assert.equal(quote.serviceSubtotalCents, 8900);
  assert.equal(quote.wasteFeeCents, 400);
  // The offer's registered promise includes the processing-fee waiver.
  assert.equal(quote.processingFeeWaived, true);
  assert.equal(quote.processingFeeCents, 0);
  assert.equal(quote.taxCents, 534); // 6% of the discounted 8900 subtotal
  assert.equal(quote.preTaxTotalCents, 9300);
  assert.equal(quote.totalCents, 9834); // 8900 + 400 + 0 + 534
  assert.equal(quote.discountCents, 3000);
  assert.equal(totalDiscountCents, 3000);
});

test("SOCIAL99: flat $99 service price composes the same way (total 10894)", () => {
  const { quotes } = applyOffer([makeStandardQuote({ basePriceCents: 11900 })], "SOCIAL99");
  const quote = quotes[0];
  assert.equal(quote.basePriceCents, 9900);
  assert.equal(quote.wasteFeeCents, 400);
  assert.equal(quote.processingFeeCents, 0);
  assert.equal(quote.taxCents, 594); // 6% of 9900
  assert.equal(quote.totalCents, 10894); // 9900 + 400 + 0 + 594
});

test("WIPERS119: perk only — the standard per-job build is unchanged", () => {
  const { quotes, totalDiscountCents } = applyOffer(
    [makeStandardQuote({ basePriceCents: 11900 })],
    "WIPERS119",
  );
  const quote = quotes[0];
  assert.equal(quote.basePriceCents, 11900);
  assert.equal(quote.wasteFeeCents, 400);
  assert.equal(quote.processingFeeCents, 369);
  assert.equal(quote.taxCents, 714);
  assert.equal(quote.totalCents, 13383);
  assert.equal(quote.offerCodeApplied, "WIPERS119");
  assert.equal(totalDiscountCents, 0);
});

test("FIRST20: the discount cuts the subtotal and every component is recomputed", () => {
  const { quotes } = applyOffer(
    [makeStandardQuote({ basePriceCents: 11900 }), makeStandardQuote({ basePriceCents: 11900 })],
    "FIRST20",
  );
  const first = quotes[0];
  assert.equal(first.basePriceCents, 9900);
  assert.equal(first.serviceSubtotalCents, 9900);
  assert.equal(first.wasteFeeCents, 400); // waste is never discounted
  assert.equal(first.processingFeeCents, 309); // 3% of (9900 + 400)
  assert.equal(first.taxCents, 594); // 6% of 9900
  assert.equal(first.totalCents, 11203); // 9900 + 400 + 309 + 594
  // The second job keeps the standard build.
  assert.equal(quotes[1].totalCents, 13383);
  assert.equal(quotes[1].offerCodeApplied, "FIRST20");
});

test("extra quarts stay in the subtotal the components are built on", () => {
  const quote = makeStandardQuote({ basePriceCents: 11900, extraQuartChargeCents: 1400 });
  assert.equal(quote.serviceSubtotalCents, 13300);
  assert.equal(quote.processingFeeCents, 411); // 3% of (13300 + 400)
  assert.equal(quote.taxCents, 798); // 6% of 13300
  assert.equal(quote.totalCents, 14909); // 13300 + 400 + 411 + 798
});
