import { getSql } from "../../../../packages/db/src/index.js";
import { serviceWriterCatalogId, serviceWriterCatalogName } from "../domain/service-catalog-alignment.js";

/**
 * Website Bookings -> Service Writer selective push (website-backend half).
 *
 * Service Writer pulls website bookings from here over the authenticated
 * /internal/website-bookings routes and stamps each booking after it has
 * created the corresponding Service Writer appointment. The manual flow
 * only reads the queue and records the stamp / never-push flag a human
 * action produced.
 *
 * Auto-push extension (Ty, 2026-10-29): a PREPAID website booking is
 * pushed automatically when its payment completes (see
 * services/service-writer-auto-push.ts, hung off the Stripe webhook).
 * The functions at the bottom of this file support that trigger: an
 * atomic claim so webhook retries cannot double-push, and a staff-visible
 * record of the last failed attempt. A failed auto-push never stamps the
 * booking — it stays in the unpushed queue for the manual flow.
 *
 * There is no stored booking source channel in this schema: the Facebook
 * offer code accepted at booking creation is used for pricing only and is
 * never persisted, bookings.notes is free-form customer text, and payments
 * carry no metadata. `sourceChannel` is therefore always null.
 */

export type InternalWebsiteBookingFilter = "unpushed" | "never_push" | "pushed";

/**
 * One booking job = one vehicle + one service, priced per vehicle the way
 * Service Writer prices natively: subtotal + waste oil fee + card
 * processing fee + tax. Amounts are dollars with exact cents, following
 * the quotedTotalUsd convention.
 */
export type InternalWebsiteBookingJob = {
  position: number;
  serviceId: string;
  /**
   * The exact Service Writer catalog record this job's service is
   * bound to (domain/service-catalog-alignment.ts) — Service Writer
   * resolves the product by this id; `serviceName` rides alongside as
   * display text and as the fallback when no binding exists (null
   * here). Mirrors the bookyouroilchangeext template's binding
   * contract (its item snapshots carry `serviceCatalogId`).
   */
  serviceCatalogId: string | null;
  serviceName: string | null;
  vehicle: {
    year: number | null;
    make: string | null;
    model: string | null;
    engine: string | null;
    vin: string | null;
  };
  subtotalUsd: number;
  wasteFeeUsd: number;
  processingFeeUsd: number;
  taxUsd: number;
  totalUsd: number;
  durationMinutes: number;
};

export type InternalWebsiteBooking = {
  id: string;
  customer: string;
  email: string | null;
  phone: string;
  address: string;
  payment: "paid" | "pending" | "due_at_appointment";
  quotedTotalUsd: number;
  scheduledStart: string;
  scheduledEnd: string;
  service: string | null;
  sourceChannel: string | null;
  status: string;
  vehicle: { year: number | null; make: string | null; model: string | null; engine: string | null };
  /** Every job on the booking, ordered by position (the top-level
   *  service/vehicle fields above stay the FIRST job's, for compatibility). */
  jobs: InternalWebsiteBookingJob[];
  pushedSwAppointmentId: string | null;
  pushedAt: string | null;
  neverPush: boolean;
  autoPushLastError: string | null;
  autoPushLastAttemptAt: string | null;
};

type BookingRow = Record<string, unknown>;

function toIsoString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

const PAID_PAYMENT_STATUSES = new Set(["succeeded", "paid", "completed"]);

function derivePayment(row: BookingRow): InternalWebsiteBooking["payment"] {
  // payments.booking_id is unique (payments_booking_unique), so there is at
  // most one payment row per booking.
  if (row.paymentId === null || row.paymentId === undefined) return "due_at_appointment";
  if (row.paymentPaidAt !== null && row.paymentPaidAt !== undefined) return "paid";
  if (PAID_PAYMENT_STATUSES.has(String(row.paymentStatus ?? ""))) return "paid";
  return "pending";
}

function centsToUsd(value: unknown): number {
  return Number(value ?? 0) / 100;
}

function mapJob(job: BookingRow): InternalWebsiteBookingJob {
  return {
    position: Number(job.position ?? 0),
    serviceId: String(job.serviceId ?? ""),
    serviceCatalogId: serviceWriterCatalogId(
      (job.serviceSlug as string | null) ?? null,
    ),
    // Service Writer is the master catalog (2026-10-30): the name SW
    // receives is its own catalog name for this service's slug, never
    // the website's stored display name.
    serviceName: serviceWriterCatalogName(
      (job.serviceSlug as string | null) ?? null,
      (job.serviceName as string | null) ?? null,
    ),
    vehicle: {
      year: job.vehicleYear === null || job.vehicleYear === undefined ? null : Number(job.vehicleYear),
      make: (job.vehicleMake as string | null) ?? null,
      model: (job.vehicleModel as string | null) ?? null,
      engine: (job.vehicleEngine as string | null) ?? null,
      vin: (job.vehicleVin as string | null) ?? null,
    },
    subtotalUsd: centsToUsd(job.subtotalCents),
    wasteFeeUsd: centsToUsd(job.wasteFeeCents),
    processingFeeUsd: centsToUsd(job.processingFeeCents),
    taxUsd: centsToUsd(job.taxCents),
    totalUsd: centsToUsd(job.totalCents),
    durationMinutes: Number(job.durationMinutes ?? 0),
  };
}

function mapJobs(value: unknown): InternalWebsiteBookingJob[] {
  let parsed: unknown = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return (parsed as BookingRow[]).map(mapJob);
}

function mapRow(row: BookingRow): InternalWebsiteBooking {
  const line2 = row.serviceAddressLine2 ? ` ${String(row.serviceAddressLine2)}` : "";
  return {
    id: String(row.id),
    customer: `${String(row.firstName ?? "")} ${String(row.lastName ?? "")}`.trim(),
    email: (row.email as string | null) ?? null,
    phone: String(row.phone ?? ""),
    address: `${String(row.serviceAddressLine1 ?? "")}${line2}, ${String(row.serviceCity ?? "")}, ${String(row.serviceState ?? "")} ${String(row.servicePostalCode ?? "")}`,
    payment: derivePayment(row),
    quotedTotalUsd: Number(row.quotedTotalCents ?? 0) / 100,
    scheduledStart: toIsoString(row.scheduledStart) ?? "",
    scheduledEnd: toIsoString(row.scheduledEnd) ?? "",
    service: serviceWriterCatalogName(
      (row.serviceSlug as string | null) ?? null,
      (row.serviceName as string | null) ?? null,
    ),
    sourceChannel: null,
    status: String(row.status ?? ""),
    vehicle: {
      year: row.vehicleYear === null || row.vehicleYear === undefined ? null : Number(row.vehicleYear),
      make: (row.vehicleMake as string | null) ?? null,
      model: (row.vehicleModel as string | null) ?? null,
      engine: (row.vehicleEngine as string | null) ?? null,
    },
    jobs: mapJobs(row.jobs),
    pushedSwAppointmentId: (row.pushedSwAppointmentId as string | null) ?? null,
    pushedAt: toIsoString(row.pushedAt),
    neverPush: Boolean(row.neverPush),
    autoPushLastError: (row.autoPushLastError as string | null) ?? null,
    autoPushLastAttemptAt: toIsoString(row.autoPushLastAttemptAt),
  };
}

export async function listInternalWebsiteBookings(filter: InternalWebsiteBookingFilter) {
  const sql = getSql();
  const rows = await sql`
    SELECT
      b.id,
      b.status,
      b.scheduled_start AS "scheduledStart",
      b.scheduled_end AS "scheduledEnd",
      b.service_address_line_1 AS "serviceAddressLine1",
      b.service_address_line_2 AS "serviceAddressLine2",
      b.service_city AS "serviceCity",
      b.service_state AS "serviceState",
      b.service_postal_code AS "servicePostalCode",
      b.quoted_total_cents AS "quotedTotalCents",
      b.pushed_sw_appointment_id AS "pushedSwAppointmentId",
      b.pushed_at AS "pushedAt",
      b.never_push AS "neverPush",
      b.auto_push_last_error AS "autoPushLastError",
      b.auto_push_last_attempt_at AS "autoPushLastAttemptAt",
      c.first_name AS "firstName",
      c.last_name AS "lastName",
      c.email AS "email",
      c.phone AS "phone",
      first_job.service_name AS "serviceName",
      first_job.service_slug AS "serviceSlug",
      first_job.vehicle_year AS "vehicleYear",
      first_job.vehicle_make AS "vehicleMake",
      first_job.vehicle_model AS "vehicleModel",
      first_job.vehicle_engine AS "vehicleEngine",
      COALESCE((SELECT json_agg(json_build_object(
          'position', bj.position,
          'serviceId', bj.service_id,
          'serviceSlug', s.slug,
          'serviceName', s.name,
          'vehicleYear', v.year,
          'vehicleMake', v.make,
          'vehicleModel', v.model,
          'vehicleEngine', v.engine,
          'vehicleVin', v.vin,
          'subtotalCents', bj.subtotal_cents,
          'wasteFeeCents', bj.waste_fee_cents,
          'processingFeeCents', bj.processing_fee_cents,
          'taxCents', bj.tax_cents,
          'totalCents', bj.quoted_price_cents,
          'durationMinutes', bj.duration_minutes
        ) ORDER BY bj.position ASC, bj.created_at ASC, bj.id ASC)
        FROM moms_ops.booking_jobs bj
        LEFT JOIN moms_ops.services s ON s.id = bj.service_id
        LEFT JOIN moms_ops.vehicles v ON v.id = bj.vehicle_id
        WHERE bj.booking_id = b.id), '[]'::json) AS "jobs",
      p.id AS "paymentId",
      p.status AS "paymentStatus",
      p.paid_at AS "paymentPaidAt"
    FROM moms_ops.bookings b
    JOIN moms_ops.customers c ON c.id = b.customer_id
    LEFT JOIN LATERAL (
      SELECT
        s.name AS service_name,
        s.slug AS service_slug,
        v.year AS vehicle_year,
        v.make AS vehicle_make,
        v.model AS vehicle_model,
        v.engine AS vehicle_engine
      FROM moms_ops.booking_jobs bj
      LEFT JOIN moms_ops.services s ON s.id = bj.service_id
      LEFT JOIN moms_ops.vehicles v ON v.id = bj.vehicle_id
      WHERE bj.booking_id = b.id
      ORDER BY bj.position ASC, bj.created_at ASC, bj.id ASC
      LIMIT 1
    ) first_job ON true
    LEFT JOIN moms_ops.payments p ON p.booking_id = b.id
    WHERE (
      (${filter} = 'unpushed'
        AND b.pushed_sw_appointment_id IS NULL
        AND b.never_push = false
        AND b.status <> 'cancelled')
      OR (${filter} = 'never_push'
        AND b.never_push = true
        AND b.pushed_sw_appointment_id IS NULL)
      OR (${filter} = 'pushed'
        AND b.pushed_sw_appointment_id IS NOT NULL)
    )
    ORDER BY b.scheduled_start ASC, b.id ASC
  `;
  return (rows as BookingRow[]).map(mapRow);
}

export async function getInternalWebsiteBooking(bookingId: string) {
  const sql = getSql();
  const rows = await sql`
    SELECT
      b.id,
      b.status,
      b.pushed_sw_appointment_id AS "pushedSwAppointmentId",
      b.pushed_at AS "pushedAt",
      b.never_push AS "neverPush",
      b.auto_push_claimed_at AS "autoPushClaimedAt",
      b.auto_push_last_error AS "autoPushLastError",
      b.auto_push_last_attempt_at AS "autoPushLastAttemptAt"
    FROM moms_ops.bookings b
    WHERE b.id = ${bookingId}::uuid
    LIMIT 1
  `;
  const row = (rows as BookingRow[])[0];
  if (!row) return null;
  return {
    id: String(row.id),
    status: String(row.status ?? ""),
    pushedSwAppointmentId: (row.pushedSwAppointmentId as string | null) ?? null,
    pushedAt: toIsoString(row.pushedAt),
    neverPush: Boolean(row.neverPush),
    autoPushClaimedAt: toIsoString(row.autoPushClaimedAt),
    autoPushLastError: (row.autoPushLastError as string | null) ?? null,
    autoPushLastAttemptAt: toIsoString(row.autoPushLastAttemptAt),
  };
}

export async function stampInternalWebsiteBookingPush(bookingId: string, swAppointmentId: string) {
  const sql = getSql();
  const rows = await sql`
    UPDATE moms_ops.bookings
    SET pushed_sw_appointment_id = ${swAppointmentId},
        pushed_at = now(),
        updated_at = now()
    WHERE id = ${bookingId}::uuid
      AND pushed_sw_appointment_id IS NULL
    RETURNING
      id,
      pushed_sw_appointment_id AS "pushedSwAppointmentId",
      pushed_at AS "pushedAt"
  `;
  const row = (rows as BookingRow[])[0];
  if (!row) return null;
  return {
    id: String(row.id),
    pushedSwAppointmentId: String(row.pushedSwAppointmentId),
    pushedAt: toIsoString(row.pushedAt) ?? "",
  };
}

/**
 * How long an auto-push claim is considered live. A claim older than this
 * is stale (the attempt crashed or the caller died) and may be re-claimed,
 * so a booking can never be wedged out of both the automatic and the
 * manual flow. Mirrored by isAutoPushClaimLive in
 * services/service-writer-auto-push.ts.
 */
export const AUTO_PUSH_CLAIM_STALE_MINUTES = 15;

/**
 * Atomically claim a booking for one auto-push attempt. The claim lands
 * only when the booking is still pushable by the automatic path:
 * not already pushed, not never-push, and not cancelled. Returns true
 * when THIS caller won the claim.
 */
export async function claimInternalWebsiteBookingAutoPush(bookingId: string) {
  const sql = getSql();
  const rows = await sql`
    UPDATE moms_ops.bookings
    SET auto_push_claimed_at = now(),
        auto_push_last_attempt_at = now(),
        updated_at = now()
    WHERE id = ${bookingId}::uuid
      AND pushed_sw_appointment_id IS NULL
      AND never_push = false
      AND status <> 'cancelled'
      AND (
        auto_push_claimed_at IS NULL
        OR auto_push_claimed_at < now() - (${AUTO_PUSH_CLAIM_STALE_MINUTES} * interval '1 minute')
      )
    RETURNING id
  `;
  return (rows as BookingRow[]).length > 0;
}

/**
 * Record why an auto-push attempt failed and release the claim so the
 * booking stays fully available to the manual queue (and to a later
 * automatic retry once the blocker is fixed). Never stamps anything.
 */
export async function recordInternalWebsiteBookingAutoPushFailure(bookingId: string, reason: string) {
  const sql = getSql();
  const rows = await sql`
    UPDATE moms_ops.bookings
    SET auto_push_claimed_at = NULL,
        auto_push_last_attempt_at = now(),
        auto_push_last_error = ${reason.slice(0, 2000)},
        updated_at = now()
    WHERE id = ${bookingId}::uuid
      AND pushed_sw_appointment_id IS NULL
    RETURNING
      id,
      auto_push_last_error AS "autoPushLastError",
      auto_push_last_attempt_at AS "autoPushLastAttemptAt"
  `;
  const row = (rows as BookingRow[])[0];
  if (!row) return null;
  return {
    id: String(row.id),
    autoPushLastError: (row.autoPushLastError as string | null) ?? null,
    autoPushLastAttemptAt: toIsoString(row.autoPushLastAttemptAt),
  };
}

/** Clear the claim + failure record after a successful auto-push. */
export async function recordInternalWebsiteBookingAutoPushSuccess(bookingId: string) {
  const sql = getSql();
  const rows = await sql`
    UPDATE moms_ops.bookings
    SET auto_push_claimed_at = NULL,
        auto_push_last_error = NULL,
        updated_at = now()
    WHERE id = ${bookingId}::uuid
    RETURNING id
  `;
  return (rows as BookingRow[]).length > 0;
}

export async function setInternalWebsiteBookingNeverPush(bookingId: string, neverPush: boolean) {
  const sql = getSql();
  const rows = await sql`
    UPDATE moms_ops.bookings
    SET never_push = ${neverPush},
        updated_at = now()
    WHERE id = ${bookingId}::uuid
    RETURNING
      id,
      never_push AS "neverPush"
  `;
  const row = (rows as BookingRow[])[0];
  if (!row) return null;
  return { id: String(row.id), neverPush: Boolean(row.neverPush) };
}
