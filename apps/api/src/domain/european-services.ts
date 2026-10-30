/**
 * European vehicle auto-switch (owner ruling, 2026-10-30): customers
 * book the wrong oil change for European cars, so the system corrects
 * it — any job for a European vehicle booked on a regular oil-change
 * service is switched to the European-spec oil change and repriced at
 * the European tier. The switch happens at booking creation, before
 * pricing, so the stored booking job records the European service and
 * the quote, the confirmation email, and the Service Writer push all
 * agree. It is never a hidden adjustment.
 *
 * Pure and DB-free (like price-components.ts) so the decision can be
 * unit-tested in isolation; the booking flows resolve the European
 * service row by slug and substitute its id.
 */

export const EUROPEAN_SPEC_SERVICE_SLUG = "european-spec-oil-change";

/**
 * Oil-change services a European vehicle may be switched FROM. The
 * European service itself is deliberately absent (already correct),
 * and add-on services (filters, wipers) are never switched.
 */
export const SWITCHABLE_OIL_SERVICE_SLUGS: readonly string[] = [
  "full-synthetic-oil-change",
  "mobil-1-advanced",
];

/**
 * European makes, spelled the way the vehicle-spec dataset and
 * customer vehicle records spell them. Matching is normalization-based
 * (see normalizeVehicleMake), so case, spacing, and hyphenation
 * variants of these names all match. Extend this list — and only this
 * list — when a new European make shows up.
 */
export const EUROPEAN_MAKES: readonly string[] = [
  "BMW",
  "Mercedes-Benz",
  "Audi",
  "Volkswagen",
  "Volvo",
  "Jaguar",
  "Land Rover",
  "Porsche",
  "MINI",
  "Alfa Romeo",
  "Fiat",
  "Maserati",
  "Bentley",
  "Rolls-Royce",
  "Ferrari",
  "Lamborghini",
  "McLaren",
  "Aston Martin",
  "Lotus",
  "smart",
  "Maybach",
];

/**
 * Spelling variants seen in the wild that normalize differently from
 * the canonical entry. Keys and values are both in normalized form.
 */
const MAKE_ALIASES: Readonly<Record<string, string>> = {
  mercedes: "mercedesbenz",
  vw: "volkswagen",
  minicooper: "mini",
};

/** Lowercase and strip everything that is not a letter or digit. */
export function normalizeVehicleMake(make: string | null | undefined): string {
  if (!make) return "";
  const stripped = make.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return MAKE_ALIASES[stripped] ?? stripped;
}

const EUROPEAN_MAKE_KEYS: ReadonlySet<string> = new Set(
  EUROPEAN_MAKES.map((make) => normalizeVehicleMake(make)),
);

export function isEuropeanMake(make: string | null | undefined): boolean {
  const key = normalizeVehicleMake(make);
  return key !== "" && EUROPEAN_MAKE_KEYS.has(key);
}

/**
 * The service slug a job should actually be booked under. A switchable
 * oil-change service for a European vehicle becomes the European-spec
 * service; everything else is returned unchanged.
 */
export function resolveSwitchedServiceSlug(
  serviceSlug: string | null | undefined,
  vehicleMake: string | null | undefined,
): string | null | undefined {
  if (!serviceSlug) return serviceSlug;
  if (!SWITCHABLE_OIL_SERVICE_SLUGS.includes(serviceSlug)) return serviceSlug;
  return isEuropeanMake(vehicleMake) ? EUROPEAN_SPEC_SERVICE_SLUG : serviceSlug;
}
