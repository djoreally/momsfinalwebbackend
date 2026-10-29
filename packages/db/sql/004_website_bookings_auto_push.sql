-- Website Bookings -> Service Writer AUTO-push for prepaid bookings
-- (follow-up to 003_website_bookings_push.sql).
--
-- Extends the SAME push-tracking surface on moms_ops.bookings — no new
-- table, no new subsystem:
--   * auto_push_claimed_at — atomic in-flight claim. The Stripe webhook
--     trigger claims a booking with a single conditional UPDATE before
--     calling Service Writer, so webhook retries / double-fires cannot
--     run two pushes at once. A claim older than 15 minutes is stale and
--     may be re-claimed (a crashed attempt must never wedge the booking).
--   * auto_push_last_attempt_at / auto_push_last_error — the staff-visible
--     failure record. A prepaid booking whose auto-push fails is NOT
--     stamped and stays in the manual (unpushed) queue; these columns say
--     why the automatic attempt did not land. Cleared on a later success.
-- Applied by scripts/migrate.mjs; do not run by hand against a live
-- database without the normal migration flow.

ALTER TABLE moms_ops.bookings
  ADD COLUMN IF NOT EXISTS auto_push_claimed_at timestamptz;
ALTER TABLE moms_ops.bookings
  ADD COLUMN IF NOT EXISTS auto_push_last_attempt_at timestamptz;
ALTER TABLE moms_ops.bookings
  ADD COLUMN IF NOT EXISTS auto_push_last_error text;

COMMENT ON COLUMN moms_ops.bookings.auto_push_claimed_at IS
  'Atomic in-flight claim for the prepaid auto-push trigger; NULL when no auto-push attempt is running. Claims older than 15 minutes are stale and re-claimable.';
COMMENT ON COLUMN moms_ops.bookings.auto_push_last_attempt_at IS
  'When the prepaid auto-push last attempted this booking (claim time).';
COMMENT ON COLUMN moms_ops.bookings.auto_push_last_error IS
  'Why the last prepaid auto-push attempt failed, verbatim from the push pipeline; NULL when the last attempt succeeded or none ran. The booking stays in the manual queue while this is set.';
