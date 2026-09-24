import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.js";

let client: ReturnType<typeof neon> | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;
let vehicleSpecsClient: ReturnType<typeof neon> | undefined;

function connectionString(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required");
  return value;
}

function vehicleSpecsConnectionString(): string {
  const value = process.env.VEHICLE_SPECS_DATABASE_URL;
  if (!value) throw new Error("VEHICLE_SPECS_DATABASE_URL is required");
  return value;
}

export function getSql() {
  client ??= neon(connectionString());
  return client;
}

export function getVehicleSpecsSql() {
  vehicleSpecsClient ??= neon(vehicleSpecsConnectionString());
  return vehicleSpecsClient;
}

export function getDb() {
  database ??= drizzle(getSql(), { schema });
  return database;
}

export async function databaseHealth(): Promise<void> {
  await getSql()`select 1 as ok`;
}

export async function vehicleSpecsDatabaseHealth(): Promise<void> {
  await getVehicleSpecsSql()`select 1 as ok`;
}

export * from "./schema.js";


export async function applyStripeMonetaryEventsMigration(): Promise<void> {
  const sql = getSql();
  await sql`CREATE TABLE IF NOT EXISTS moms_ops.schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS moms_ops.stripe_monetary_events (
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
  )`;
  await sql`CREATE INDEX IF NOT EXISTS stripe_monetary_events_booking_idx ON moms_ops.stripe_monetary_events(moms_booking_id)`;
  await sql`CREATE INDEX IF NOT EXISTS stripe_monetary_events_intent_idx ON moms_ops.stripe_monetary_events(stripe_payment_intent_id)`;
  await sql`CREATE INDEX IF NOT EXISTS stripe_monetary_events_status_idx ON moms_ops.stripe_monetary_events(intent_status)`;
  await sql`CREATE INDEX IF NOT EXISTS stripe_monetary_events_occurred_idx ON moms_ops.stripe_monetary_events(occurred_at DESC)`;
  await sql`COMMENT ON TABLE moms_ops.stripe_monetary_events IS 'Append-only Stripe evidence ledger. Operational payment state remains in moms_ops.payments.'`;
  await sql`INSERT INTO moms_ops.schema_migrations (filename) VALUES ('001_stripe_monetary_events.sql') ON CONFLICT (filename) DO NOTHING`;
}

export async function applyCampaignSettingsMigration(): Promise<void> {
  const sql = getSql();
  await sql`CREATE TABLE IF NOT EXISTS moms_ops.campaign_settings (
    campaign_id text PRIMARY KEY,
    config jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
}
