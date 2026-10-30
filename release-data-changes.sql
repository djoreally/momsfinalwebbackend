-- =====================================================================
-- RELEASE DATA CHANGES — PREPARED, NOT APPLIED (2026-10-30)
-- =====================================================================
-- Owner rulings (2026-10-30):
--   * Service Writer is the master catalog; the website's stored
--     service names align TO Service Writer's names.
--   * Prices: wiper blades starting at $39, engine air filters
--     starting at $39, cabin air filters $59 — on BOTH sides.
--
-- This file touches TWO DIFFERENT DATABASES. Run each section only
-- in its own console at release time:
--   SECTION A → Neon database `moms_newsletter`, schema `moms_ops`
--               (the website backend's database)
--   SECTION B → Supabase SQL Editor, project rjfbrfognxqkyhdrpibx
--               (Service Writer's database, table public.service_catalog)
-- Do NOT run the whole file in one place.
--
-- Current stored values below were read read-only on 2026-10-30;
-- re-run the verification SELECT at the top of each section before
-- applying, and stop if the "before" values no longer match.
--
-- NOT in this file: the code migration
-- packages/db/sql/006_booking_job_discounts.sql (adds
-- booking_jobs.discount_cents) ships with the code and is applied by
-- scripts/migrate.mjs in the normal flow.
-- =====================================================================


-- =====================================================================
-- SECTION A — WEBSITE (Neon, moms_ops.services)
-- =====================================================================

-- A0. Verify BEFORE (expected as of 2026-10-30):
--   cabin-air-filter          'Cabin Air Filter Replacement'   5900
--   engine-air-filter         'Engine Air Filter Replacement'  5900
--   european-spec-oil-change  'European Spec Oil Change'       14900
--   full-synthetic-oil-change 'Full Synthetic Oil Change'      11900
--   mobil-1-advanced          'Mobil 1 Advanced'               12900
--   payment-test-1-dollar     (test service)                   100
--   wiper-blade               'Wiper Blade Replacement'        2400
SELECT slug, name, base_price_cents, is_active
FROM moms_ops.services
ORDER BY slug;

-- A1. Name alignment to the Service Writer master catalog.
-- (The booking code already sends the master names at the push seam;
-- these UPDATEs align the stored rows themselves. Each is guarded by
-- the drifted stored name, so re-running is a no-op.)
UPDATE moms_ops.services
SET name = 'Mobil 1 Full Synthetic'
WHERE slug = 'mobil-1-advanced' AND name = 'Mobil 1 Advanced';

UPDATE moms_ops.services
SET name = 'Cabin Air Filter'
WHERE slug = 'cabin-air-filter' AND name = 'Cabin Air Filter Replacement';

UPDATE moms_ops.services
SET name = 'Engine Air Filter'
WHERE slug = 'engine-air-filter' AND name = 'Engine Air Filter Replacement';

-- A2. Prices.
-- Wiper blades: $24.00 -> $39.00 (starting price).
UPDATE moms_ops.services
SET base_price_cents = 3900
WHERE slug = 'wiper-blade';

-- Engine air filters: $59.00 -> $39.00 (starting price).
UPDATE moms_ops.services
SET base_price_cents = 3900
WHERE slug = 'engine-air-filter';

-- Cabin air filters: already $59.00 (5900) — NO UPDATE. Verified by
-- the SELECT below.

-- A3. Verify AFTER: wiper-blade 3900, engine-air-filter 3900,
-- cabin-air-filter 5900, and the three names from A1 aligned.
SELECT slug, name, base_price_cents, is_active
FROM moms_ops.services
ORDER BY slug;


-- =====================================================================
-- SECTION B — SERVICE WRITER (Supabase SQL Editor,
-- public.service_catalog, MOMS workspace
-- 250c258f-fad6-46e1-86de-3de41a7d4e1a)
-- =====================================================================
-- Targets are the ACTIVE catalog rows, addressed by their exact
-- record ids (the same ids the website's exact-product binding
-- points at). Inactive duplicate rows for these names exist in the
-- catalog and are deliberately NOT touched.

-- B0. Verify BEFORE: read the three rows as they stand.
SELECT id, name, labor_price, is_active
FROM public.service_catalog
WHERE id IN (
  '8610bfd9-ae83-420f-a273-8ad035f28680',
  '1f19daa3-8813-4bc2-91dc-0f0a04b9a240',
  '787864f9-4f2e-40dc-999b-c49563215306'
);

-- B1. Prices: wipers $39, engine air filters $39, cabin $59.
UPDATE public.service_catalog
SET labor_price = 39.00
WHERE id = '8610bfd9-ae83-420f-a273-8ad035f28680';  -- Wiper Blade Replacement

UPDATE public.service_catalog
SET labor_price = 39.00
WHERE id = '1f19daa3-8813-4bc2-91dc-0f0a04b9a240';  -- Engine Air Filter

UPDATE public.service_catalog
SET labor_price = 59.00
WHERE id = '787864f9-4f2e-40dc-999b-c49563215306';  -- Cabin Air Filter

-- B2. Verify AFTER: 39.00 / 39.00 / 59.00 on the three rows above.
SELECT id, name, labor_price, is_active
FROM public.service_catalog
WHERE id IN (
  '8610bfd9-ae83-420f-a273-8ad035f28680',
  '1f19daa3-8813-4bc2-91dc-0f0a04b9a240',
  '787864f9-4f2e-40dc-999b-c49563215306'
);
