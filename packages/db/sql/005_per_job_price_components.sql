-- Per-job price components (owner ruling, 2026-10-30): every website
-- booking job is priced per vehicle / per service the way Service Writer
-- prices natively — subtotal + waste oil fee + card processing fee + tax,
-- itemized on the job — instead of persisting only a single job total.
--
--   * services.waste_fee_cents — per-service waste oil fee. $4.00 for the
--     three oil-change services (set below by slug); 0 for everything else.
--   * services.tax_rate_percent — per-service tax rate; 6% default.
--   * booking_jobs.subtotal_cents / waste_fee_cents /
--     processing_fee_cents / tax_cents — the components behind each job's
--     quoted_price_cents (the job total). Existing rows keep the default 0:
--     their component split was never recorded and is not reconstructed.
--
-- The waste-fee UPDATE matches the three oil-change services by slug (the
-- slugs the live site uses for these services). If a slug does not match,
-- that UPDATE simply touches no row and the service keeps waste_fee_cents
-- = 0 until it is set in the operations dashboard.
-- Applied by scripts/migrate.mjs; do not run by hand against a live
-- database without the normal migration flow.

ALTER TABLE moms_ops.services
  ADD COLUMN IF NOT EXISTS waste_fee_cents integer NOT NULL DEFAULT 0;
ALTER TABLE moms_ops.services
  ADD COLUMN IF NOT EXISTS tax_rate_percent numeric(5,2) NOT NULL DEFAULT 6;

UPDATE moms_ops.services
  SET waste_fee_cents = 400
  WHERE slug IN (
    'full-synthetic-oil-change',
    'mobil-1-advanced',
    'european-spec-oil-change'
  );

ALTER TABLE moms_ops.booking_jobs
  ADD COLUMN IF NOT EXISTS subtotal_cents integer NOT NULL DEFAULT 0;
ALTER TABLE moms_ops.booking_jobs
  ADD COLUMN IF NOT EXISTS waste_fee_cents integer NOT NULL DEFAULT 0;
ALTER TABLE moms_ops.booking_jobs
  ADD COLUMN IF NOT EXISTS processing_fee_cents integer NOT NULL DEFAULT 0;
ALTER TABLE moms_ops.booking_jobs
  ADD COLUMN IF NOT EXISTS tax_cents integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN moms_ops.services.waste_fee_cents IS
  'Per-service waste oil fee in cents, charged per job on top of the service subtotal (before the processing fee and tax). $4.00 (400) for oil-change services; 0 otherwise.';
COMMENT ON COLUMN moms_ops.services.tax_rate_percent IS
  'Per-service tax rate in percent, applied to the job subtotal (base + extra quarts, after offer discounts). Default 6.';
COMMENT ON COLUMN moms_ops.booking_jobs.subtotal_cents IS
  'Job service subtotal in cents: vehicle-priced base + extra-quart charge, after any offer discount. One of the components of quoted_price_cents.';
COMMENT ON COLUMN moms_ops.booking_jobs.waste_fee_cents IS
  'Waste oil fee charged on this job in cents (from services.waste_fee_cents at quote time). One of the components of quoted_price_cents.';
COMMENT ON COLUMN moms_ops.booking_jobs.processing_fee_cents IS
  'Card processing fee charged on this job in cents: processing_fee_percent x (subtotal + waste fee), 0 when waived. One of the components of quoted_price_cents.';
COMMENT ON COLUMN moms_ops.booking_jobs.tax_cents IS
  'Tax charged on this job in cents: services.tax_rate_percent x subtotal at quote time. One of the components of quoted_price_cents. quoted_price_cents = subtotal + waste + processing + tax.';
