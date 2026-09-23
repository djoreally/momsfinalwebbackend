CREATE TABLE IF NOT EXISTS moms_ops.stripe_monetary_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_key text NOT NULL UNIQUE,
  evidence_source text NOT NULL DEFAULT 'webhook',
  stripe_event_id text UNIQUE,
  stripe_event_type text NOT NULL,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_customer_id text,
  stripe_balance_transaction_id text,
  moms_booking_id uuid,
  moms_customer_id uuid,
  moms_payment_id uuid,
  correlation_confidence text NOT NULL DEFAULT 'unlinked',
  attempted_cents integer NOT NULL DEFAULT 0,
  gross_cents integer NOT NULL DEFAULT 0,
  fee_cents integer NOT NULL DEFAULT 0,
  net_cents integer NOT NULL DEFAULT 0,
  refunded_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  intent_status text,
  payment_method_type text,
  wallet_type text,
  failure_code text,
  failure_message text,
  cancellation_reason text,
  radar_risk_level text,
  billing_name text,
  billing_email text,
  billing_phone text,
  billing_city text,
  billing_state text,
  billing_postal_code text,
  billing_country text,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stripe_monetary_events_booking_idx
  ON moms_ops.stripe_monetary_events(moms_booking_id);
CREATE INDEX IF NOT EXISTS stripe_monetary_events_intent_idx
  ON moms_ops.stripe_monetary_events(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS stripe_monetary_events_status_idx
  ON moms_ops.stripe_monetary_events(intent_status);
CREATE INDEX IF NOT EXISTS stripe_monetary_events_occurred_idx
  ON moms_ops.stripe_monetary_events(occurred_at DESC);

COMMENT ON TABLE moms_ops.stripe_monetary_events IS
  'Append-only Stripe evidence ledger. Operational payment state remains in moms_ops.payments.';
