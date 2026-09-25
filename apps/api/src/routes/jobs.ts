import { Hono } from "hono";
import { getSql } from "../../../../packages/db/src/index.js";
import { send24HourReminder } from "../services/reminder-email.js";

export const jobRoutes=new Hono();

function authorized(value:string|undefined){
 const secret=process.env.CRON_SECRET;
 if(!secret)return false;
 return value===`Bearer ${secret}`;
}

jobRoutes.get("/appointment-reminders",async c=>{
 if(!authorized(c.req.header("authorization")))return c.json({error:"unauthorized"},401);
 const sql=getSql();
 // A narrow 15-minute window lets this run every 15 minutes while targeting ~24h ahead.
 const due=await sql`SELECT b.id
 FROM moms_ops.bookings b
 WHERE b.status NOT IN ('completed','cancelled')
   AND b.scheduled_start >= now()+interval '23 hours 52 minutes'
   AND b.scheduled_start < now()+interval '24 hours 8 minutes'
   AND NOT EXISTS(
     SELECT 1 FROM moms_ops.operational_notification_log l
     WHERE l.booking_id=b.id AND l.notification_type='appointment_24h_reminder'
   )
 ORDER BY b.scheduled_start
 LIMIT 100`;
 let sent=0,skipped=0,failed=0;
 for(const row of due){
  const bookingId=String(row.id);
  try{
   // Claim first. The unique key makes concurrent/retried cron invocations idempotent.
   const claim=await sql`INSERT INTO moms_ops.operational_notification_log(booking_id,notification_type,status,created_at,updated_at)
     VALUES(${bookingId}::uuid,'appointment_24h_reminder','claimed',now(),now())
     ON CONFLICT(booking_id,notification_type) DO NOTHING RETURNING booking_id`;
   if(!claim.length){skipped++;continue;}
   const result=await send24HourReminder(bookingId);
   await sql`UPDATE moms_ops.operational_notification_log SET status=${result.sent?"sent":"skipped"},detail=${result.sent?null:result.reason},sent_at=${result.sent?new Date().toISOString():null}::timestamptz,updated_at=now() WHERE booking_id=${bookingId}::uuid AND notification_type='appointment_24h_reminder'`;
   result.sent?sent++:skipped++;
  }catch(error){
   failed++;
   await sql`UPDATE moms_ops.operational_notification_log SET status='failed',detail=${error instanceof Error?error.message.slice(0,500):"unknown_error"},updated_at=now() WHERE booking_id=${bookingId}::uuid AND notification_type='appointment_24h_reminder'`;
  }
 }
 return c.json({ok:true,candidates:due.length,sent,skipped,failed});
});
