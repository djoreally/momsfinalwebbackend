/**
 * Deal exclusions by oil grade (owner ruling, 2026-10-30): a vehicle
 * whose specified oil grade is 0W-16, 0W-8, or 0W-30 is excluded from
 * ALL deals/offers. Exclusion is per job and is NOT a rejection: the
 * booking proceeds at full price; the offer simply does not discount
 * an excluded job (see applyOffer in domain/offers.ts).
 *
 * Grade source: the vehicle spec dataset (public.motor_oil_specs,
 * repositories/vehicle-specs.ts `engineOil`) — the same lookup whose
 * oil capacity prices the job's extra quarts. quoteService resolves
 * the spec for the job's vehicle and reads the grade from it. If no
 * grade can be resolved (no spec row, no engine on the vehicle, the
 * spec lookup unavailable), the job is treated as ELIGIBLE — an
 * unknown grade never silently strips a customer's deal, and it never
 * blocks a booking either.
 *
 * One precedence rule (owner refinement, 2026-10-30): a job that is
 * European-spec (switched by the auto-switch or booked directly) is
 * governed by the European adjustment rule in applyOffer ($10 off +
 * advisory) even when its grade is also listed here — the European
 * rule wins; this module only decides the plain exclusion.
 *
 * Pure and DB-free so the logic can be unit-tested in isolation.
 */

/** Oil grades excluded from every deal, in canonical "0W-16" form. */
export const DEAL_EXCLUDED_OIL_GRADES: readonly string[] = [
  "0W-16",
  "0W-8",
  "0W-30",
];

const EXCLUDED_GRADE_KEYS: ReadonlySet<string> = new Set(
  DEAL_EXCLUDED_OIL_GRADES.map((grade) => grade.replace(/[^0-9A-Za-z]+/g, "").toUpperCase()),
);

/**
 * Extracts the oil grade from a spec string, canonicalized to the
 * "0W-16" form. The spec dataset writes grades in forms like "0W-20"
 * (sometimes with surrounding words, e.g. an oil description); stored
 * vehicle text is free-form. Matching is tolerant of case, spacing,
 * and a missing hyphen ("0w16", "0W16", "SAE 0W-16" all extract to
 * "0W-16"). Returns null when no grade pattern is present.
 */
export function extractOilGrade(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/(\d)\s*W\s*-?\s*(\d{1,2})\b/i);
  if (!match) return null;
  return `${match[1]}W-${match[2]}`;
}

/** True when the given spec/oil text names a deal-excluded grade. */
export function isDealExcludedOilGrade(value: string | null | undefined): boolean {
  const grade = extractOilGrade(value);
  if (!grade) return false;
  return EXCLUDED_GRADE_KEYS.has(grade.replace(/[^0-9A-Za-z]+/g, "").toUpperCase());
}
