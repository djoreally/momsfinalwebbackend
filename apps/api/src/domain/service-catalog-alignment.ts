/**
 * Service Writer is the master catalog (owner ruling, 2026-10-30):
 * whatever Service Writer calls a service is the name every other
 * system uses. The website push (repositories/internal-website-bookings.ts)
 * therefore sends Service Writer's own catalog names, not whatever
 * display name happens to be stored on the website's service row.
 *
 * This map is the website-side mirror of the MOMS workspace's ACTIVE
 * Service Writer catalog (verified live from Supabase service_catalog,
 * 2026-10-30). It is keyed by the website service slug, which is stable;
 * stored names are not (they drifted once already: the website sold
 * "Mobil 1 Advanced" while Service Writer's catalog says
 * "Mobil 1 Full Synthetic", and every Mobil 1 push was refused).
 *
 * Pure and DB-free so it can be unit-tested in isolation. When Ty
 * renames a service in Service Writer, update the name here in the
 * same change — this map is the contract the push matcher relies on
 * (Service Writer matches exact case-insensitively, then
 * punctuation-insensitively; it never guesses between different names).
 */
export const SW_MASTER_SERVICE_NAMES: Readonly<Record<string, string>> = {
  "full-synthetic-oil-change": "Full Synthetic Oil Change",
  "mobil-1-advanced": "Mobil 1 Full Synthetic",
  "european-spec-oil-change": "European Spec Oil Change",
  "cabin-air-filter": "Cabin Air Filter",
  "engine-air-filter": "Engine Air Filter",
  "wiper-blade": "Wiper Blade Replacement",
};

/**
 * The name Service Writer must receive for a website service. Known
 * slugs always resolve to the master catalog name; unknown slugs
 * (e.g. the $1 payment test service, which has no Service Writer
 * counterpart) pass their stored name through untouched.
 */
export function serviceWriterCatalogName(
  serviceSlug: string | null | undefined,
  storedName: string | null,
): string | null {
  if (serviceSlug && Object.prototype.hasOwnProperty.call(SW_MASTER_SERVICE_NAMES, serviceSlug)) {
    return SW_MASTER_SERVICE_NAMES[serviceSlug];
  }
  return storedName;
}
