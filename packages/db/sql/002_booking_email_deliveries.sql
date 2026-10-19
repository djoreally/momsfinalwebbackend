CREATE TABLE IF NOT EXISTS moms_ops.booking_email_deliveries (
 booking_id uuid NOT NULL REFERENCES moms_ops.bookings(id) ON DELETE CASCADE,
 recipient_role text NOT NULL CHECK (recipient_role IN ('customer','business')),
 recipient_email text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','accepted','failed','dead')),
 provider_message_id text,
 attempts integer NOT NULL DEFAULT 0,
 last_error text,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (booking_id,recipient_role)
);
CREATE INDEX IF NOT EXISTS booking_email_deliveries_retry_idx ON moms_ops.booking_email_deliveries(next_attempt_at) WHERE status IN ('pending','failed','sending');
