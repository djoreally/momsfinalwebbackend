import { getSql } from "../../../../packages/db/src/index.js";

export async function ensureServiceOrdersForBooking(bookingId:string){
  const sql=getSql();
  const rows=await sql`
    WITH source AS (
      SELECT b.id appointment_id,b.customer_id,bj.id booking_job_id,bj.vehicle_id,bj.service_id,
             bj.quoted_price_cents,bj.position,s.name service_name,b.notes
      FROM moms_ops.bookings b
      JOIN moms_ops.booking_jobs bj ON bj.booking_id=b.id
      JOIN moms_ops.services s ON s.id=bj.service_id
      WHERE b.id=${bookingId}::uuid
    ), new_orders AS (
      INSERT INTO moms_ops.service_orders (appointment_id,customer_id,vehicle_id,status,notes)
      SELECT DISTINCT ON (src.vehicle_id) src.appointment_id,src.customer_id,src.vehicle_id,'authorized',src.notes
      FROM source src
      WHERE NOT EXISTS (
        SELECT 1 FROM moms_ops.service_orders so
        WHERE so.appointment_id=src.appointment_id AND so.vehicle_id=src.vehicle_id
      )
      RETURNING *
    ), all_orders AS (
      SELECT so.id,so.appointment_id,so.vehicle_id
      FROM moms_ops.service_orders so WHERE so.appointment_id=${bookingId}::uuid
    ), new_items AS (
      INSERT INTO moms_ops.service_order_items
        (service_order_id,booking_job_id,service_id,description,quantity,unit_price_cents,total_cents,status,position)
      SELECT ao.id,src.booking_job_id,src.service_id,src.service_name,1,src.quoted_price_cents,src.quoted_price_cents,'authorized',src.position
      FROM source src JOIN all_orders ao ON ao.appointment_id=src.appointment_id AND ao.vehicle_id=src.vehicle_id
      WHERE NOT EXISTS (SELECT 1 FROM moms_ops.service_order_items i WHERE i.booking_job_id=src.booking_job_id)
      RETURNING id
    )
    SELECT so.id,so.appointment_id AS "appointmentId",so.customer_id AS "customerId",
           so.vehicle_id AS "vehicleId",so.status,so.notes,so.created_at AS "createdAt",
           COALESCE(json_agg(json_build_object('id',i.id,'bookingJobId',i.booking_job_id,'serviceId',i.service_id,
             'description',i.description,'quantity',i.quantity,'unitPriceCents',i.unit_price_cents,
             'totalCents',i.total_cents,'status',i.status,'position',i.position)
             ORDER BY i.position) FILTER (WHERE i.id IS NOT NULL),'[]'::json) items
    FROM moms_ops.service_orders so
    LEFT JOIN moms_ops.service_order_items i ON i.service_order_id=so.id
    WHERE so.appointment_id=${bookingId}::uuid
    GROUP BY so.id ORDER BY so.created_at
  `;
  return rows;
}
