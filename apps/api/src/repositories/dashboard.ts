import { getSql } from "../../../../packages/db/src/index.js";

export async function getDashboardToday(date: string) {
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
      json_build_object(
        'id', c.id,
        'firstName', c.first_name,
        'lastName', c.last_name,
        'phone', c.phone,
        'email', c.email
      ) AS customer,
      COALESCE(
        json_agg(
          json_build_object(
            'id', bj.id,
            'status', bj.status,
            'quotedPriceCents', bj.quoted_price_cents,
            'durationMinutes', bj.duration_minutes,
            'vehicle', json_build_object(
              'id', v.id, 'year', v.year, 'make', v.make, 'model', v.model, 'engine', v.engine
            ),
            'service', json_build_object('id', s.id, 'name', s.name, 'slug', s.slug)
          ) ORDER BY bj.position
        ) FILTER (WHERE bj.id IS NOT NULL),
        '[]'::json
      ) AS jobs,
      CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object(
        'id', p.id, 'status', p.status, 'amountCents', p.amount_cents, 'currency', p.currency
      ) END AS payment
    FROM moms_ops.bookings b
    JOIN moms_ops.customers c ON c.id = b.customer_id
    LEFT JOIN moms_ops.booking_jobs bj ON bj.booking_id = b.id
    LEFT JOIN moms_ops.vehicles v ON v.id = bj.vehicle_id
    LEFT JOIN moms_ops.services s ON s.id = bj.service_id
    LEFT JOIN moms_ops.payments p ON p.booking_id = b.id
    WHERE (b.scheduled_start AT TIME ZONE 'America/New_York')::date = ${date}::date
    GROUP BY b.id,c.id,p.id
    ORDER BY b.scheduled_start ASC
  `;
  const visits = rows as Array<Record<string, any>>;
  return {
    date,
    timezone: "America/New_York",
    summary: {
      appointments: visits.length,
      vehicles: visits.reduce((n,v)=>n+(Array.isArray(v.jobs)?v.jobs.length:0),0),
      revenueScheduledCents: visits.reduce((n,v)=>n+Number(v.quotedTotalCents??0),0),
      paidCents: visits.reduce((n,v)=>n+(v.payment?.status==="succeeded"?Number(v.payment.amountCents??0):0),0),
      dueCents: visits.reduce((n,v)=>n+(v.payment?.status==="due_at_appointment"?Number(v.payment.amountCents??0):0),0),
      needsAttention: visits.filter(v=>["failed","requires_payment_method"].includes(v.payment?.status)).length,
    },
    visits,
  };
}


export async function listDashboardBookings(input: { status?: string; limit: number; offset?: number }) {
  const sql = getSql();
  const offset = Math.max(0, input.offset ?? 0);
  const status = input.status ?? null;
  const [countRow] = await sql`
    SELECT count(*)::int AS total
    FROM moms_ops.bookings b
    WHERE (${status}::text IS NULL OR b.status=${status})
  `;
  const rows = await sql`
    SELECT b.id,b.status,b.scheduled_start AS "scheduledStart",b.scheduled_end AS "scheduledEnd",
      b.service_address_line_1 AS "serviceAddressLine1",b.service_city AS "serviceCity",b.service_state AS "serviceState",
      b.quoted_total_cents AS "quotedTotalCents",
      json_build_object('id',c.id,'firstName',c.first_name,'lastName',c.last_name,'phone',c.phone,'email',c.email) AS customer,
      COALESCE((SELECT json_agg(json_build_object('id',bj.id,'status',bj.status,'quotedPriceCents',bj.quoted_price_cents,
        'vehicle',json_build_object('id',v.id,'year',v.year,'make',v.make,'model',v.model,'engine',v.engine),
        'service',json_build_object('id',s.id,'name',s.name,'slug',s.slug)) ORDER BY bj.position)
        FROM moms_ops.booking_jobs bj
        LEFT JOIN moms_ops.vehicles v ON v.id=bj.vehicle_id
        LEFT JOIN moms_ops.services s ON s.id=bj.service_id
        WHERE bj.booking_id=b.id),'[]'::json) AS jobs,
      (SELECT json_build_object('id',p.id,'status',p.status,'amountCents',p.amount_cents,'currency',p.currency)
       FROM moms_ops.payments p WHERE p.booking_id=b.id ORDER BY p.created_at DESC LIMIT 1) AS payment
    FROM moms_ops.bookings b
    JOIN moms_ops.customers c ON c.id=b.customer_id
    WHERE (${status}::text IS NULL OR b.status=${status})
    ORDER BY b.scheduled_start DESC,b.id DESC
    LIMIT ${input.limit} OFFSET ${offset}
  `;
  return { bookings: rows, total: Number((countRow as any)?.total ?? 0), limit: input.limit, offset };
}
