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
