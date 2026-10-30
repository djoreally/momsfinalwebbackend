import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Catalog alignment + European auto-switch (owner ruling, 2026-10-30):
// Service Writer is the master catalog, and any European vehicle booked
// on a regular oil-change service is switched to the European-spec oil
// change at booking creation, repriced at the European tier.
//
// The decision logic is pure and DB-free:
//   apps/api/src/domain/service-catalog-alignment.ts (slug -> SW name)
//   apps/api/src/domain/european-services.ts (make + slug -> slug)
// The DB-bound wiring (reserveBooking / reserveAppointment substitute
// the European service id before pricing; the internal push payload
// sends master names) is asserted as a source contract, in the style
// of test/booking-email-required.test.mjs.
const {
  SW_MASTER_SERVICE_NAMES,
  serviceWriterCatalogName,
} = await import("../apps/api/src/domain/service-catalog-alignment.ts");
const {
  EUROPEAN_MAKES,
  EUROPEAN_SPEC_SERVICE_SLUG,
  isEuropeanMake,
  normalizeVehicleMake,
  resolveSwitchedServiceSlug,
} = await import("../apps/api/src/domain/european-services.ts");
const { calculatePriceComponents } = await import(
  "../apps/api/src/domain/price-components.ts"
);

// ---------------------------------------------------------------------
// A. Name alignment: every name SW receives equals an active SW
// catalog name (MOMS workspace catalog, verified live 2026-10-30).
// ---------------------------------------------------------------------

const SW_ACTIVE_CATALOG_NAMES = new Set([
  "Full Synthetic Oil Change",
  "Mobil 1 Full Synthetic",
  "European Spec Oil Change",
  "Additional Oil (per quart)",
  "Battery Replacement",
  "Cabin Air Filter",
  "Engine Air Filter",
  "Tire Rotation",
  "Wiper Blade Replacement",
]);

test("every mapped website service name is an active SW catalog name", () => {
  for (const [slug, name] of Object.entries(SW_MASTER_SERVICE_NAMES)) {
    assert.ok(SW_ACTIVE_CATALOG_NAMES.has(name), `${slug} -> "${name}" is not in the SW catalog`);
  }
});

test("mobil-1-advanced is sent to SW as exactly 'Mobil 1 Full Synthetic'", () => {
  // The stored website name that blocked the Stage F auto-push.
  assert.equal(serviceWriterCatalogName("mobil-1-advanced", "Mobil 1 Advanced"), "Mobil 1 Full Synthetic");
});

test("the other drifted stored names are aligned to the SW master names", () => {
  assert.equal(serviceWriterCatalogName("cabin-air-filter", "Cabin Air Filter Replacement"), "Cabin Air Filter");
  assert.equal(serviceWriterCatalogName("engine-air-filter", "Engine Air Filter Replacement"), "Engine Air Filter");
});

test("already-aligned names pass through with the same value", () => {
  assert.equal(serviceWriterCatalogName("full-synthetic-oil-change", "Full Synthetic Oil Change"), "Full Synthetic Oil Change");
  assert.equal(serviceWriterCatalogName("european-spec-oil-change", "European Spec Oil Change"), "European Spec Oil Change");
  assert.equal(serviceWriterCatalogName("wiper-blade", "Wiper Blade Replacement"), "Wiper Blade Replacement");
});

test("unknown slugs pass their stored name through untouched", () => {
  // The $1 payment test service has no SW counterpart; it is not the
  // alignment layer's job to invent one for it.
  assert.equal(serviceWriterCatalogName("payment-test-1-dollar", "Payment Test - $1"), "Payment Test - $1");
  assert.equal(serviceWriterCatalogName(null, "Anything"), "Anything");
  assert.equal(serviceWriterCatalogName("mobil-1-advanced", null), "Mobil 1 Full Synthetic");
  assert.equal(serviceWriterCatalogName(null, null), null);
});

// ---------------------------------------------------------------------
// B. European makes: normalization against real-world spellings.
// ---------------------------------------------------------------------

test("the makes list carries every make the ruling names", () => {
  const required = [
    "BMW", "Mercedes-Benz", "Audi", "Volkswagen", "Volvo", "Jaguar",
    "Land Rover", "Porsche", "MINI", "Alfa Romeo", "Fiat", "Maserati",
    "Bentley", "Rolls-Royce", "Ferrari", "Lamborghini", "McLaren",
    "Aston Martin", "Lotus", "smart", "Maybach",
  ];
  for (const make of required) {
    assert.ok(EUROPEAN_MAKES.includes(make), `EUROPEAN_MAKES is missing ${make}`);
    assert.equal(isEuropeanMake(make), true, `${make} should be European`);
  }
});

test("make matching survives case, spacing, and hyphenation variants", () => {
  for (const variant of [
    "bmw", "Bmw", "Mercedes Benz", "mercedes-benz", "MERCEDES-BENZ",
    "Mercedes", "Land rover", "LAND ROVER", "Alfa  Romeo", "Rolls Royce",
    "Aston  Martin", "Mini", "MINI Cooper", "VW", "Smart", "McLaren ",
  ]) {
    assert.equal(isEuropeanMake(variant), true, `"${variant}" should be European`);
  }
  assert.equal(normalizeVehicleMake("Mercedes-Benz"), "mercedesbenz");
  assert.equal(normalizeVehicleMake("Mercedes Benz"), "mercedesbenz");
});

test("non-European makes never match", () => {
  for (const make of [
    "Ford", "Honda", "Subaru", "Cadillac", "Toyota", "Chevrolet",
    "Jeep", "Nissan", "Hyundai", "Kia", "Tesla", "Ram", "GMC",
    null, undefined, "", "   ",
  ]) {
    assert.equal(isEuropeanMake(make), false, `"${make}" must not be European`);
  }
});

// ---------------------------------------------------------------------
// B. The switch decision + repricing.
// ---------------------------------------------------------------------

test("European make + regular full synthetic switches to European spec", () => {
  assert.equal(
    resolveSwitchedServiceSlug("full-synthetic-oil-change", "BMW"),
    EUROPEAN_SPEC_SERVICE_SLUG,
  );
  // A Jaguar F-PACE (Laurie Buckman's car) booked as Full Synthetic
  // after this ships would be corrected the same way.
  assert.equal(
    resolveSwitchedServiceSlug("full-synthetic-oil-change", "Jaguar"),
    EUROPEAN_SPEC_SERVICE_SLUG,
  );
});

test("European make + Mobil 1 switches to European spec", () => {
  assert.equal(
    resolveSwitchedServiceSlug("mobil-1-advanced", "Mercedes-Benz"),
    EUROPEAN_SPEC_SERVICE_SLUG,
  );
});

test("European make + already European is unchanged", () => {
  assert.equal(
    resolveSwitchedServiceSlug("european-spec-oil-change", "Audi"),
    "european-spec-oil-change",
  );
});

test("non-European makes are unchanged (Stage F vehicles included)", () => {
  // Stage F proof booking: Transit-250 (Ford) + CR-V (Honda) — the
  // switch must not touch it; its only blocker was the Mobil 1 name.
  assert.equal(resolveSwitchedServiceSlug("full-synthetic-oil-change", "Ford"), "full-synthetic-oil-change");
  assert.equal(resolveSwitchedServiceSlug("mobil-1-advanced", "Honda"), "mobil-1-advanced");
});

test("add-on services and missing data are never switched", () => {
  assert.equal(resolveSwitchedServiceSlug("cabin-air-filter", "BMW"), "cabin-air-filter");
  assert.equal(resolveSwitchedServiceSlug("wiper-blade", "Porsche"), "wiper-blade");
  assert.equal(resolveSwitchedServiceSlug(null, "BMW"), null);
  assert.equal(resolveSwitchedServiceSlug("full-synthetic-oil-change", null), "full-synthetic-oil-change");
});

test("a switched job reprices at the European tier through the per-job contract", () => {
  // European service as verified live: base $149, waste $4,
  // processing 3% x (subtotal + waste), tax 6% x subtotal.
  const european = calculatePriceComponents({
    serviceSubtotalCents: 14900,
    wasteFeeCents: 400,
    processingFeePercent: 3,
    processingFeeWaived: false,
    taxRatePercent: 6,
  });
  assert.equal(european.processingFeeCents, 459);
  assert.equal(european.taxCents, 894);
  assert.equal(european.totalCents, 16653);

  // The same vehicle unswitched at the regular tier, for contrast.
  const regular = calculatePriceComponents({
    serviceSubtotalCents: 11900,
    wasteFeeCents: 400,
    processingFeePercent: 3,
    processingFeeWaived: false,
    taxRatePercent: 6,
  });
  assert.equal(regular.totalCents, 13383);
  assert.ok(european.totalCents > regular.totalCents);
});

// ---------------------------------------------------------------------
// Wiring contracts (source-level, the repo's established pattern for
// DB-bound flows).
// ---------------------------------------------------------------------

const bookingsSource = readFileSync(
  new URL("../apps/api/src/domain/bookings.ts", import.meta.url),
  "utf8",
);
const appointmentsSource = readFileSync(
  new URL("../apps/api/src/domain/appointments.ts", import.meta.url),
  "utf8",
);
const internalSource = readFileSync(
  new URL("../apps/api/src/repositories/internal-website-bookings.ts", import.meta.url),
  "utf8",
);

test("reserveBooking corrects jobs before duplicates, pricing, and storage", () => {
  const switchAt = bookingsSource.indexOf("resolveEffectiveJobs(input.customerId, input.jobs)");
  const duplicatesAt = bookingsSource.indexOf("duplicate_booking_job");
  const pricingAt = bookingsSource.indexOf("quoteService({");
  assert.ok(switchAt > -1, "reserveBooking must resolve effective jobs");
  assert.ok(switchAt < duplicatesAt, "switch must run before the duplicate check");
  assert.ok(switchAt < pricingAt, "switch must run before pricing");
  assert.ok(bookingsSource.includes("resolveSwitchedServiceSlug(service.slug, vehicle.make)"));
  assert.ok(bookingsSource.includes("getServiceBySlug(EUROPEAN_SPEC_SERVICE_SLUG)"));
});

test("reserveAppointment applies the same correction and stores the corrected service", () => {
  assert.ok(appointmentsSource.includes("resolveEffectiveServiceId(input)"));
  assert.ok(appointmentsSource.includes("serviceId: effectiveServiceId"));
  assert.ok(appointmentsSource.includes("resolveSwitchedServiceSlug(service.slug, vehicle.make)"));
});

test("the internal push payload sends master names keyed by slug", () => {
  assert.ok(internalSource.includes("serviceWriterCatalogName("));
  assert.ok(internalSource.includes("'serviceSlug', s.slug"), "jobs payload must carry the slug the alignment keys on");
  assert.ok(internalSource.includes('first_job.service_slug AS "serviceSlug"'));
});

// ---------------------------------------------------------------------
// F. Exact-product binding: every mapped slug also resolves to the
// exact Service Writer catalog record id, and the internal push
// payload carries it per job as `serviceCatalogId` (the
// bookyouroilchangeext template's binding contract).
// ---------------------------------------------------------------------

const {
  SW_MASTER_SERVICE_IDS,
  serviceWriterCatalogId,
} = await import("../apps/api/src/domain/service-catalog-alignment.ts");

const EXPECTED_SW_IDS = {
  "full-synthetic-oil-change": "5c1c4f88-5ee9-40ab-87a5-e061f59c0e4c",
  "mobil-1-advanced": "d0aa9821-cc62-4ce1-8383-29987464323f",
  "european-spec-oil-change": "0f7ad876-eade-419d-82de-32627cfe158c",
  "cabin-air-filter": "787864f9-4f2e-40dc-999b-c49563215306",
  "engine-air-filter": "1f19daa3-8813-4bc2-91dc-0f0a04b9a240",
  "wiper-blade": "8610bfd9-ae83-420f-a273-8ad035f28680",
};

test("each mapped slug resolves to its exact SW catalog record id", () => {
  for (const [slug, id] of Object.entries(EXPECTED_SW_IDS)) {
    assert.equal(serviceWriterCatalogId(slug), id, slug);
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }
  assert.deepEqual({ ...SW_MASTER_SERVICE_IDS }, EXPECTED_SW_IDS);
});

test("name map and id map cover exactly the same slugs", () => {
  assert.deepEqual(Object.keys(SW_MASTER_SERVICE_IDS).sort(), Object.keys(SW_MASTER_SERVICE_NAMES).sort());
});

test("unmapped slugs carry no catalog id", () => {
  assert.equal(serviceWriterCatalogId("payment-test-1-dollar"), null);
  assert.equal(serviceWriterCatalogId("additional-oil"), null, "no website additional-oil slug exists to bind");
  assert.equal(serviceWriterCatalogId(null), null);
  assert.equal(serviceWriterCatalogId(undefined), null);
});

test("the internal push payload carries serviceCatalogId per job", () => {
  assert.ok(internalSource.includes("serviceCatalogId"), "payload type must carry the field");
  assert.ok(internalSource.includes("serviceWriterCatalogId("), "payload must resolve the id from the slug");
});

// ---------------------------------------------------------------------
// G. Deal exclusions by oil grade + the European adjustment
// (owner rulings, 2026-10-30). applyOffer is pure; the grade
// derivation is pure; the DB-bound flagging in quoteService and the
// advisory wiring are source contracts below.
// ---------------------------------------------------------------------

const { applyOffer, OfferError } = await import("../apps/api/src/domain/offers.ts");
const {
  DEAL_EXCLUDED_OIL_GRADES,
  extractOilGrade,
  isDealExcludedOilGrade,
} = await import("../apps/api/src/domain/deal-exclusions.ts");
const {
  EUROPEAN_ADJUSTMENT_CENTS,
  europeanAdjustmentAdvisory,
} = await import("../apps/api/src/domain/european-services.ts");

// A per-job quote with the real components (waste $4, tax 6%):
// full synthetic standard total = 11900 + 400 + 369 + 714 = 13383.
function makeJobQuote(overrides = {}) {
  return {
    serviceId: "svc",
    vehicleId: "veh",
    basePriceCents: 11900,
    extraQuarts: 0,
    extraQuartPriceCents: 1400,
    extraQuartChargeCents: 0,
    extraQuartWaived: false,
    processingFeePercent: 3,
    processingFeeWaived: false,
    wasteFeeCents: 400,
    taxRatePercent: 6,
    preTaxTotalCents: 12669,
    totalCents: 13383,
    durationMinutes: 45,
    offerCodeApplied: null,
    discountCents: 0,
    europeanAdjustmentCents: 0,
    ...overrides,
  };
}
const euroJobQuote = (overrides = {}) =>
  makeJobQuote({ basePriceCents: 14900, preTaxTotalCents: 15729, totalCents: 16653, europeanSpec: true, ...overrides });

test("grade extraction normalizes case, spacing, and hyphen variants", () => {
  assert.deepEqual([...DEAL_EXCLUDED_OIL_GRADES], ["0W-16", "0W-8", "0W-30"]);
  assert.equal(extractOilGrade("0W-16"), "0W-16");
  assert.equal(extractOilGrade("0w16"), "0W-16");
  assert.equal(extractOilGrade("SAE 0W-8"), "0W-8");
  assert.equal(extractOilGrade("0W - 30"), "0W-30");
  assert.equal(extractOilGrade("0W-20"), "0W-20");
  assert.equal(extractOilGrade("Full Synthetic"), null);
  assert.equal(extractOilGrade("verified"), null);
  assert.equal(extractOilGrade(null), null);
});

test("0W-16, 0W-8, and 0W-30 are deal-excluded; other grades are not", () => {
  for (const grade of ["0W-16", "0W-8", "0W-30", "0w-16", "SAE 0W-30"]) {
    assert.equal(isDealExcludedOilGrade(grade), true, grade);
  }
  for (const grade of ["0W-20", "5W-30", "5W-20", null, undefined, ""]) {
    assert.equal(isDealExcludedOilGrade(grade), false, String(grade));
  }
});

test("Euro job + code books successfully with the $10 adjustment, never blocked", () => {
  const { quotes, totalDiscountCents, offerCodeApplied } = applyOffer([euroJobQuote()], "SOCIAL89", { mode: "booking" });
  // European price with $10 off the base: 13900 + 400 waste + 429
  // processing (3% of 14300, NOT waived) + 834 tax (6% of 13900).
  assert.equal(quotes[0].totalCents, 15563);
  assert.equal(quotes[0].discountCents, 1000);
  assert.equal(quotes[0].europeanAdjustmentCents, EUROPEAN_ADJUSTMENT_CENTS);
  assert.equal(quotes[0].processingFeeCents, 429);
  assert.equal(quotes[0].offerCodeApplied, "SOCIAL89");
  assert.equal(totalDiscountCents, 1000);
  assert.equal(offerCodeApplied, "SOCIAL89");
});

test("Euro job adjusts under a perk offer too, and in provisional mode", () => {
  const perk = applyOffer([euroJobQuote()], "WIPERS119", { mode: "booking" });
  assert.equal(perk.quotes[0].discountCents, 1000);
  assert.equal(perk.quotes[0].totalCents, 15563);
  const provisional = applyOffer([euroJobQuote()], "SOCIAL89", { mode: "provisional" });
  assert.equal(provisional.quotes[0].totalCents, 15563);
});

test("a European job that is also grade-excluded is governed by the adjustment, not the exclusion", () => {
  const { quotes } = applyOffer([euroJobQuote({ offerExcluded: true })], "SOCIAL89", { mode: "booking" });
  assert.equal(quotes[0].discountCents, 1000);
  assert.equal(quotes[0].europeanAdjustmentCents, 1000);
});

test("grade-excluded job + code books at full price with no discount and no error", () => {
  const { quotes, totalDiscountCents, offerCodeApplied } = applyOffer(
    [makeJobQuote({ offerExcluded: true })],
    "SOCIAL89",
    { mode: "booking" },
  );
  assert.equal(quotes[0].totalCents, 13383);
  assert.equal(quotes[0].discountCents, 0);
  assert.equal(quotes[0].offerCodeApplied, null);
  assert.equal(totalDiscountCents, 0);
  assert.equal(offerCodeApplied, null);
});

test("grade-excluded non-anchor job (Mobil 1) also books at list instead of failing", () => {
  const { quotes } = applyOffer(
    [makeJobQuote({ basePriceCents: 12900, offerExcluded: true })],
    "SOCIAL89",
    { mode: "booking" },
  );
  assert.equal(quotes[0].discountCents, 0);
  assert.equal(quotes[0].basePriceCents, 12900);
});

test("regular eligible job + code is unchanged: SOCIAL89 flat price with the fee waived", () => {
  const { quotes, totalDiscountCents } = applyOffer([makeJobQuote()], "SOCIAL89", { mode: "booking" });
  // 8900 + 400 waste + 0 processing (waived) + 534 tax = 9834.
  assert.equal(quotes[0].totalCents, 9834);
  assert.equal(quotes[0].discountCents, 3000);
  assert.equal(quotes[0].processingFeeCents, 0);
  assert.equal(quotes[0].europeanAdjustmentCents, 0);
  assert.equal(totalDiscountCents, 3000);
});

test("mixed booking: only the eligible job gets the deal, the Euro job gets its adjustment", () => {
  const { quotes, totalDiscountCents } = applyOffer(
    [makeJobQuote(), euroJobQuote()],
    "SOCIAL89",
    { mode: "booking" },
  );
  assert.equal(quotes[0].totalCents, 9834, "eligible job keeps the SOCIAL89 deal");
  assert.equal(quotes[1].totalCents, 15563, "Euro job adjusted, not blocked by the single-job scope");
  assert.equal(quotes[1].europeanAdjustmentCents, 1000);
  assert.equal(totalDiscountCents, 4000);
});

test("two regular jobs still trip the single-job scope", () => {
  assert.throws(
    () => applyOffer([makeJobQuote(), makeJobQuote()], "SOCIAL89", { mode: "booking" }),
    (error) => error instanceof OfferError && error.code === "offer_single_job_only",
  );
});

test("mixed booking: a grade-excluded job is skipped by an each-job deal", () => {
  const tuesday = "2026-11-03T15:00:00Z"; // Tuesday in America/New_York
  const { quotes } = applyOffer(
    [makeJobQuote({ offerExcluded: true }), makeJobQuote()],
    "TUESDAY15",
    { mode: "booking", scheduledStart: tuesday },
  );
  assert.equal(quotes[0].discountCents, 0);
  assert.equal(quotes[0].totalCents, 13383);
  assert.equal(quotes[1].discountCents, 1500, "$15 off the eligible job only");
});

test("non-excluded non-European ineligible job still fails in booking mode", () => {
  assert.throws(
    () => applyOffer([makeJobQuote({ basePriceCents: 12900 })], "SOCIAL89", { mode: "booking" }),
    (error) => error instanceof OfferError && error.code === "offer_not_applicable",
  );
});

test("the European advisory wording is plain and carries all three facts", () => {
  assert.equal(EUROPEAN_ADJUSTMENT_CENTS, 1000);
  assert.equal(
    europeanAdjustmentAdvisory("2020 Jaguar F-PACE"),
    "Your 2020 Jaguar F-PACE requires European-spec oil, so its service was adjusted to European Spec Oil Change and $10.00 was taken off.",
  );
});

// ---------------------------------------------------------------------
// H. Wiring contracts for the exclusion flagging, the stored
// discount, and the advisories (DB-bound flows, source-level).
// ---------------------------------------------------------------------

const pricingSource = readFileSync(
  new URL("../apps/api/src/domain/pricing.ts", import.meta.url),
  "utf8",
);
const schemaSource = readFileSync(
  new URL("../packages/db/src/schema.ts", import.meta.url),
  "utf8",
);
const migration006 = readFileSync(
  new URL("../packages/db/sql/006_booking_job_discounts.sql", import.meta.url),
  "utf8",
);
const emailSource = readFileSync(
  new URL("../apps/api/src/services/booking-email.ts", import.meta.url),
  "utf8",
);
const releaseDataChanges = readFileSync(
  new URL("../release-data-changes.sql", import.meta.url),
  "utf8",
);

test("quoteService resolves the grade from the spec dataset and flags the quote", () => {
  assert.ok(pricingSource.includes("resolveVehicleSpec("), "grade comes from the spec lookup behind oil capacity");
  assert.ok(pricingSource.includes("isDealExcludedOilGrade("));
  assert.ok(pricingSource.includes("service.slug === EUROPEAN_SPEC_SERVICE_SLUG"));
  assert.ok(pricingSource.includes("offerExcluded:"));
  assert.ok(pricingSource.includes("europeanSpec:"));
});

test("the per-job discount is stored and the confirmation carries advisories", () => {
  assert.ok(schemaSource.includes('discountCents: integer("discount_cents")'));
  assert.ok(migration006.includes("ADD COLUMN IF NOT EXISTS discount_cents"));
  assert.ok(bookingsSource.includes("discountCents: quote.discountCents"), "createBooking persists the discount");
  assert.ok(bookingsSource.includes("europeanAdjustmentAdvisory("), "confirmation response advises");
  assert.ok(bookingsSource.includes("advisories"), "advisories ride the booking response");
  assert.ok(emailSource.includes("europeanAdjustmentAdvisory("), "confirmation email advises");
  assert.ok(emailSource.includes("EUROPEAN_SPEC_SERVICE_SLUG"));
  assert.ok(emailSource.includes("discountCents"), "email reads the stored discount");
});

test("release data changes are prepared in one file, both databases sectioned", () => {
  assert.ok(releaseDataChanges.includes("NOT APPLIED"));
  assert.ok(releaseDataChanges.includes("moms_ops.services"));
  assert.ok(releaseDataChanges.includes("public.service_catalog"));
  assert.ok(releaseDataChanges.includes("base_price_cents = 3900"), "wiper + engine filter prices");
  assert.ok(releaseDataChanges.includes("Mobil 1 Full Synthetic"), "name alignment included");
  for (const id of Object.values(EXPECTED_SW_IDS).slice(3)) {
    assert.ok(releaseDataChanges.includes(id), `SW section addresses ${id}`);
  }
});
