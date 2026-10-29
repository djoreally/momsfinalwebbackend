-- Website Bookings -> Service Writer selective push (website-backend half).
-- Records, per website booking, the Service Writer appointment it was
-- manually pushed to, and an operator-set "never push" exclusion flag.
-- Applied by scripts/migrate.mjs; do not run by hand against a live database
-- without the normal migration flow.

ALTER TABLE moms_ops.bookings
  ADD COLUMN IF NOT EXISTS pushed_sw_appointment_id text;
ALTER TABLE moms_ops.bookings
  ADD COLUMN IF NOT EXISTS pushed_at timestamptz;
ALTER TABLE moms_ops.bookings
  ADD COLUMN IF NOT EXISTS never_push boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN moms_ops.bookings.pushed_sw_appointment_id IS
  'Service Writer appointment id this website booking was pushed to; NULL until pushed. Set once via POST /internal/website-bookings/:id/push-stamp.';
COMMENT ON COLUMN moms_ops.bookings.pushed_at IS
  'When the Service Writer push was stamped; NULL until pushed.';
COMMENT ON COLUMN moms_ops.bookings.never_push IS
  'Operator exclusion: when true the booking never appears in the unpushed Service Writer queue.';
