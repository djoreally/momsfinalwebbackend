-- Per-job discount record (owner rulings, 2026-10-30): a booking
-- job's discount — an offer discount, or the $10 European adjustment
-- applied when a deal is in play on a European-spec job — is stored
-- on the job itself (booking_jobs.discount_cents), mirroring the
-- PriceQuote.discountCents the pricing domain already computes.
-- Until now the discount existed only inside the job's quoted
-- components; the confirmation email could not tell an adjusted
-- European job from a full-price one. Existing rows keep the
-- default 0: their discounts were never recorded per job and are
-- not reconstructed.
--
-- Applied by scripts/migrate.mjs; do not run by hand against a live
-- database without the normal migration flow.

ALTER TABLE moms_ops.booking_jobs
  ADD COLUMN IF NOT EXISTS discount_cents integer NOT NULL DEFAULT 0;
