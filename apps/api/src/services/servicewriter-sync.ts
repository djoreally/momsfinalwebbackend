import { createHmac } from "node:crypto";
import { getSql } from "../../../../packages/db/src/index.js";

type SyncPayload = {
  sourceBookingId: string;
  scheduledStart: string;
  customer: { firstName: string; lastName: string; email: string; phone: string };
  address: { line1: string; line2: string | null; city: string; state: string; postalCode: string };
  jobs: Array<{
    vehicle: { year: number; make: string; model: string; engine: string | null; vin: string | null; oilType: string | null; oilCapacityQuarts: number | null };
    service: { name: string; priceCents: number; durationMinutes: number };
  }>;
  totalCents: number;
  notes: string | null;
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 1000) : "Service Writer sync failed";
}

async function buildPayload(bookingId: string): Promise<SyncPayload | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT b.id AS "sourceBookingId", b.scheduled_start AS "scheduledStart",
      b.quoted_total_cents AS "totalCents", b.notes,
      c.first_name AS "firstName", c.last_name AS "lastName", c.email, c.phone,
      b.service_address_line_1 AS "line1", b.service_address_line_2 AS "line2",
      b.service_city AS city, b.service_state AS state, b.service_postal_code AS "postalCode",
      COALESCE(json_agg(json_build_object(
        'vehicle', json_build_object(
          'year', v.year, 'make', v.make, 'model', v.model, 'engine', v.engine,
          'vin', v.vin, 'oilType', v.oil_type, 'oilCapacityQuarts', v.oil_capacity_quarts
        ),
        'service', json_build_object(
          'name', s.name, 'priceCents', bj.quoted_price_cents,
          'durationMinutes', bj.duration_minutes
        )
      ) ORDER BY bj.position) FILTER (WHERE bj.id IS NOT NULL), '[]'::json) AS jobs
    FROM moms_ops.bookings b
    JOIN moms_ops.customers c ON c.id=b.customer_id
    LEFT JOIN moms_ops.booking_jobs bj ON bj.booking_id=b.id
    LEFT JOIN moms_ops.vehicles v ON v.id=bj.vehicle_id
    LEFT JOIN moms_ops.services s ON s.id=bj.service_id
    WHERE b.id = ${bookingId}::uuid
    GROUP BY b.id, c.id
    LIMIT 1
  `;
  if (!rows[0]) return null;
  const row = rows[0] as any;
  if (!row.email || !row.phone || !Array.isArray(row.jobs) || row.jobs.length < 1) {
    throw new Error("booking_missing_required_servicewriter_fields");
  }
  return {
    sourceBookingId: row.sourceBookingId,
    scheduledStart: new Date(row.scheduledStart).toISOString(),
    customer: { firstName: row.firstName, lastName: row.lastName, email: row.email, phone: row.phone },
    address: { line1: row.line1, line2: row.line2 ?? null, city: row.city, state: row.state, postalCode: row.postalCode },
    jobs: row.jobs,
    totalCents: Number(row.totalCents),
    notes: row.notes ?? null,
  };
}

export async function dispatchServiceWriterBooking(bookingId: string): Promise<boolean> {
  const sql = getSql();
  const [outbox] = await sql`
    SELECT status, attempts FROM moms_ops.servicewriter_sync_outbox WHERE booking_id=${bookingId}::uuid LIMIT 1
  `;
  if (!outbox || outbox.status === "synced") return outbox?.status === "synced";
  const endpoint = process.env.SERVICE_WRITER_BOOKING_WEBHOOK_URL;
  const secret = process.env.SERVICE_WRITER_BOOKING_WEBHOOK_SECRET;
  if (!endpoint || !secret) {
    console.warn("servicewriter_sync_not_configured", { bookingId });
    return false;
  }

  await sql`
    UPDATE moms_ops.servicewriter_sync_outbox
    SET status='processing', attempts=attempts+1, updated_at=now(), last_error=NULL
    WHERE booking_id=${bookingId}::uuid AND status <> 'synced'
  `;

  try {
    const payload = await buildPayload(bookingId);
    if (!payload) throw new Error("booking_not_found_for_servicewriter_sync");
    const body = JSON.stringify(payload);
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-moms-signature": `sha256=${signature}` },
      body,
      signal: AbortSignal.timeout(12_000),
    });
    const result = await response.json().catch(() => ({})) as { appointmentId?: string; error?: unknown };
    if (!response.ok || typeof result.appointmentId !== "string") {
      throw new Error(`servicewriter_http_${response.status}`);
    }
    await sql`
      UPDATE moms_ops.servicewriter_sync_outbox
      SET status='synced', external_appointment_id=${result.appointmentId},
          synced_at=now(), updated_at=now(), last_error=NULL, next_attempt_at=NULL
      WHERE booking_id=${bookingId}::uuid
    `;
    return true;
  } catch (error) {
    const message = errorText(error);
    await sql`
      UPDATE moms_ops.servicewriter_sync_outbox
      SET status='failed', last_error=${message},
          next_attempt_at=now() + LEAST(3600, power(2, LEAST(attempts, 10))::int) * interval '1 second',
          updated_at=now()
      WHERE booking_id=${bookingId}::uuid AND status <> 'synced'
    `;
    console.error("servicewriter_sync_failed", { bookingId, error: message });
    return false;
  }
}

export async function retryDueServiceWriterBookings(limit = 20): Promise<{ attempted: number; synced: number }> {
  const sql = getSql();
  const rows = await sql`
    SELECT booking_id FROM moms_ops.servicewriter_sync_outbox
    WHERE (
        (status IN ('pending','failed') AND (next_attempt_at IS NULL OR next_attempt_at <= now()))
        OR (status='processing' AND updated_at < now() - interval '5 minutes')
      )
      AND attempts < 12
    ORDER BY created_at ASC
    LIMIT ${Math.max(1, Math.min(limit, 100))}
  `;
  let synced = 0;
  for (const row of rows as Array<{ booking_id: string }>) {
    if (await dispatchServiceWriterBooking(row.booking_id)) synced++;
  }
  return { attempted: rows.length, synced };
}
