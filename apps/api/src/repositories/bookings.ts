import { asc, eq } from "drizzle-orm";
import { bookingJobs, bookings, customers, getDb, getSql, services, vehicles } from "../../../../packages/db/src/index.js";

export type CreateBookingInput = {
  customerId: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  serviceAddressLine1: string;
  serviceAddressLine2?: string | null;
  serviceCity: string;
  serviceState: string;
  servicePostalCode: string;
  quotedTotalCents: number;
  notes?: string | null;
  jobs: Array<{ vehicleId: string; serviceId: string; quotedPriceCents: number; durationMinutes: number; position: number }>;
};

export async function createBooking(input: CreateBookingInput) {
  const sql = getSql();
  const jobsJson = JSON.stringify(input.jobs);
  const rows = await sql`
    WITH new_booking AS (
      INSERT INTO moms_ops.bookings (
        customer_id,status,scheduled_start,scheduled_end,service_address_line_1,
        service_address_line_2,service_city,service_state,service_postal_code,
        quoted_total_cents,notes
      ) VALUES (
        ${input.customerId}::uuid,'pending',${input.scheduledStart.toISOString()}::timestamptz,
        ${input.scheduledEnd.toISOString()}::timestamptz,${input.serviceAddressLine1},
        ${input.serviceAddressLine2 ?? null},${input.serviceCity},${input.serviceState},
        ${input.servicePostalCode},${input.quotedTotalCents},${input.notes ?? null}
      ) RETURNING *
    ), new_jobs AS (
      INSERT INTO moms_ops.booking_jobs (
        booking_id,vehicle_id,service_id,quoted_price_cents,duration_minutes,position,status
      )
      SELECT b.id,j."vehicleId"::uuid,j."serviceId"::uuid,j."quotedPriceCents",j."durationMinutes",j."position",'pending'
      FROM new_booking b
      CROSS JOIN LATERAL jsonb_to_recordset(${jobsJson}::jsonb)
        AS j("vehicleId" text,"serviceId" text,"quotedPriceCents" integer,"durationMinutes" integer,"position" integer)
      RETURNING *
    )
    SELECT row_to_json(b) AS booking,
           COALESCE((SELECT json_agg(j ORDER BY j.position) FROM new_jobs j),'[]'::json) AS jobs
    FROM new_booking b
  `;
  const row = rows[0] as { booking: Record<string, unknown>; jobs: unknown[] } | undefined;
  if (!row) throw new Error("booking_insert_failed");
  return { ...row.booking, jobs: row.jobs };
}

export async function getBooking(bookingId: string) {
  const [booking] = await getDb().select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking) return null;
  const db=getDb();
  const [customer]=await db.select({
    id:customers.id,firstName:customers.firstName,lastName:customers.lastName,
    email:customers.email,phone:customers.phone,
  }).from(customers).where(eq(customers.id,booking.customerId)).limit(1);
  const jobs=await db.select({
    id:bookingJobs.id,status:bookingJobs.status,quotedPriceCents:bookingJobs.quotedPriceCents,
    durationMinutes:bookingJobs.durationMinutes,position:bookingJobs.position,
    vehicle:{id:vehicles.id,year:vehicles.year,make:vehicles.make,model:vehicles.model,engine:vehicles.engine},
    service:{id:services.id,name:services.name,slug:services.slug},
  }).from(bookingJobs)
    .innerJoin(vehicles,eq(vehicles.id,bookingJobs.vehicleId))
    .innerJoin(services,eq(services.id,bookingJobs.serviceId))
    .where(eq(bookingJobs.bookingId,bookingId)).orderBy(asc(bookingJobs.position));
  return { ...booking, customer: customer??null, jobs };
}
