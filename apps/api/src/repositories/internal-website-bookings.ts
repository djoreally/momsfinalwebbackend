import { getSql } from "../../../../packages/db/src/index.js";

/**
 * Website Bookings -> Service Writer selective push (website-backend half).
 *
 * Service Writer pulls website bookings from here over the authenticated
 * /internal/website-bookings routes and stamps each booking after it has
 * created the corresponding Service Writer appointment. Nothing here ever
 * pushes automatically; these functions only read the queue and record the
 * stamp / never-push flag a human action produced.
 *
 * There is no stored booking source channel in this schema: the Facebook
 * offer code accepted at booking creation is used for pricing only and is
 * never persisted, bookings.notes is free-form customer text, and payments
 * carry no metadata. `sourceChannel` is therefore always null.
 */

export type InternalWebsiteBookingFilter = "unpushed" | "never_push" | "pushed";

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
  pushedSwAppointmentId: string | null;
  pushedAt: string | null;
  neverPush: boolean;
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
    service: (row.serviceName as string | null) ?? null,
    sourceChannel: null,
    status: String(row.status ?? ""),
    vehicle: {
      year: row.vehicleYear === null || row.vehicleYear === undefined ? null : Number(row.vehicleYear),
      make: (row.vehicleMake as string | null) ?? null,
      model: (row.vehicleModel as string | null) ?? null,
      engine: (row.vehicleEngine as string | null) ?? null,
    },
    pushedSwAppointmentId: (row.pushedSwAppointmentId as string | null) ?? null,
    pushedAt: toIsoString(row.pushedAt),
    neverPush: Boolean(row.neverPush),
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
      c.first_name AS "firstName",
      c.last_name AS "lastName",
      c.email AS "email",
      c.phone AS "phone",
      first_job.service_name AS "serviceName",
      first_job.vehicle_year AS "vehicleYear",
      first_job.vehicle_make AS "vehicleMake",
      first_job.vehicle_model AS "vehicleModel",
      first_job.vehicle_engine AS "vehicleEngine",
      p.id AS "paymentId",
      p.status AS "paymentStatus",
      p.paid_at AS "paymentPaidAt"
    FROM moms_ops.bookings b
    JOIN moms_ops.customers c ON c.id = b.customer_id
    LEFT JOIN LATERAL (
      SELECT
        s.name AS service_name,
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
      b.pushed_sw_appointment_id AS "pushedSwAppointmentId",
      b.pushed_at AS "pushedAt",
      b.never_push AS "neverPush"
    FROM moms_ops.bookings b
    WHERE b.id = ${bookingId}::uuid
    LIMIT 1
  `;
  const row = (rows as BookingRow[])[0];
  if (!row) return null;
  return {
    id: String(row.id),
    pushedSwAppointmentId: (row.pushedSwAppointmentId as string | null) ?? null,
    pushedAt: toIsoString(row.pushedAt),
    neverPush: Boolean(row.neverPush),
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
