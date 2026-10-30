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
 *
 * Exact-product binding (owner confirmation, 2026-10-30): services map
 * to the exact Service Writer catalog RECORD, not just its name. This
 * mirrors how the bookyouroilchangeext template binds its services:
 * every service carries the id of its Service Writer catalog product
 * (its `sw_service_catalog_id` binding), push/read paths resolve the
 * product by that exact id, and the name is kept alongside as display
 * text and as the fallback when no binding exists. This backend's
 * services table has no binding column, so the binding lives in the
 * maps below — same contract, one place. The payload field is named
 * `serviceCatalogId`, matching the template's item snapshots.
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
 * The exact Service Writer catalog record id for each website service
 * (public.service_catalog, MOMS workspace
 * 250c258f-fad6-46e1-86de-3de41a7d4e1a, verified live 2026-10-30 —
 * these are the ACTIVE rows; the catalog also carries inactive
 * duplicates for the filter/wiper names, which are never bound here).
 *
 * Additional Oil (per quart) — SW id
 * 239ad326-a4df-4fba-a77e-5d94ed744b9c — is deliberately NOT in this
 * map: the website has no additional-oil service slug (verified live
 * 2026-10-30: seven services, none for it). Extra quarts are priced
 * inside the oil-change services themselves
 * (services.extra_quart_price_cents) and ride inside the job subtotal,
 * so there is no standalone website job to bind to that record.
 */
export const SW_MASTER_SERVICE_IDS: Readonly<Record<string, string>> = {
  "full-synthetic-oil-change": "5c1c4f88-5ee9-40ab-87a5-e061f59c0e4c",
  "mobil-1-advanced": "d0aa9821-cc62-4ce1-8383-29987464323f",
  "european-spec-oil-change": "0f7ad876-eade-419d-82de-32627cfe158c",
  "cabin-air-filter": "787864f9-4f2e-40dc-999b-c49563215306",
  "engine-air-filter": "1f19daa3-8813-4bc2-91dc-0f0a04b9a240",
  "wiper-blade": "8610bfd9-ae83-420f-a273-8ad035f28680",
};

/**
 * The exact Service Writer catalog record id for a website service
 * slug, or null when the slug has no binding (unknown slugs, the $1
 * payment test service). The push payload carries this per job as
 * `serviceCatalogId` so Service Writer resolves the exact product
 * record; the aligned name rides alongside as display + fallback.
 */
export function serviceWriterCatalogId(
  serviceSlug: string | null | undefined,
): string | null {
  if (serviceSlug && Object.prototype.hasOwnProperty.call(SW_MASTER_SERVICE_IDS, serviceSlug)) {
    return SW_MASTER_SERVICE_IDS[serviceSlug];
  }
  return null;
}

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
