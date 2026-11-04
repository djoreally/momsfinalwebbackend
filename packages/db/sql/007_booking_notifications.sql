-- Booking notifications (website-backend half): Web Push subscription
-- storage, the fire-once notification log for reminder/changed moments,
-- and the per-booking tokens behind the customer's "your appointment"
-- page. Applied by scripts/migrate.mjs; do not run by hand against a
-- live database without the normal migration flow.

-- Web Push subscriptions, one row per browser endpoint. A subscription
-- can arrive before it is tied to a booking (the ask lives on the
-- booking confirmation page, so booking_id/customer_id are normally
-- filled in from that booking); endpoint is the natural key.
CREATE TABLE IF NOT EXISTS moms_ops.push_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 customer_id uuid REFERENCES moms_ops.customers(id) ON DELETE CASCADE,
 booking_id uuid REFERENCES moms_ops.bookings(id) ON DELETE CASCADE,
 endpoint text NOT NULL UNIQUE,
 p256dh text NOT NULL,
 auth text NOT NULL,
 user_agent text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 unsubscribed_at timestamptz
);
CREATE INDEX IF NOT EXISTS push_subscriptions_customer_idx ON moms_ops.push_subscriptions(customer_id) WHERE unsubscribed_at IS NULL;
CREATE INDEX IF NOT EXISTS push_subscriptions_booking_idx ON moms_ops.push_subscriptions(booking_id) WHERE unsubscribed_at IS NULL;

COMMENT ON TABLE moms_ops.push_subscriptions IS
  'Web Push subscriptions captured on the booking confirmation page. A row with unsubscribed_at set (browser unsubscribed, or the push service answered 404/410) is never sent to again.';
COMMENT ON COLUMN moms_ops.push_subscriptions.endpoint IS
  'Push service endpoint URL; unique per browser/profile. Upserts key on this column.';

-- Fire-once log for customer notification moments. The UNIQUE
-- (booking_id, moment, channel) constraint is the proof a moment can
-- only ever be sent once per channel; the sweep claims a row by moving
-- it pending -> sending before it sends.
CREATE TABLE IF NOT EXISTS moms_ops.booking_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 booking_id uuid NOT NULL REFERENCES moms_ops.bookings(id) ON DELETE CASCADE,
 moment text NOT NULL CHECK (moment IN ('reminder_24h','reminder_1h','changed')),
 channel text NOT NULL CHECK (channel IN ('email','push')),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','expired')),
 provider_message_id text,
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz,
 UNIQUE (booking_id, moment, channel)
);
CREATE INDEX IF NOT EXISTS booking_notifications_pending_idx ON moms_ops.booking_notifications(status) WHERE status IN ('pending','sending');

COMMENT ON TABLE moms_ops.booking_notifications IS
  'One row per (booking, moment, channel) the notification engine has considered. status=expired means the appointment time passed before the moment could be sent; expired rows are never sent late.';

-- The customer's credential for the /appointment/<token> page. Minted
-- at booking creation for new bookings only (no backfill in v1, so
-- older bookings simply have no link). sw_management_token is the
-- Service Writer customer-portal management token for the pushed
-- appointment, handed over by the Service Writer push-stamp callback;
-- it never leaves this server (the by-token view never returns it).
ALTER TABLE moms_ops.bookings
  ADD COLUMN IF NOT EXISTS manage_token text;
ALTER TABLE moms_ops.bookings
  ADD COLUMN IF NOT EXISTS sw_management_token text;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_manage_token_unique ON moms_ops.bookings(manage_token);

COMMENT ON COLUMN moms_ops.bookings.manage_token IS
  'Random per-booking token keying the public /appointment/<token> page; NULL for bookings created before the notifications feature.';
COMMENT ON COLUMN moms_ops.bookings.sw_management_token IS
  'Service Writer management token for the pushed appointment (server-side only); NULL until Service Writer hands it over in the push-stamp callback. Online reschedule is unavailable while NULL.';
