import { getBooking } from "../repositories/bookings.js";
import { getSql } from "../../../../packages/db/src/index.js";

type Role = "customer" | "business";
const FROM = "MOMS Mobile Oil Change <support@momsoilchange.com>";
const OWNER = "support@momsoilchange.com";
const MAX_ATTEMPTS = 5;
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"} as Record<string,string>)[c]);
const money = (c: number) => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(c/100);
function details(booking: NonNullable<Awaited<ReturnType<typeof getBooking>>>, role: Role) {
 const when = new Intl.DateTimeFormat("en-US",{dateStyle:"full",timeStyle:"short",timeZone:"America/New_York"}).format(new Date(booking.scheduledStart));
 const jobs = booking.jobs.map(j => `<li>${esc(j.service.name)} — ${esc(j.vehicle.year)} ${esc(j.vehicle.make)} ${esc(j.vehicle.model)} (${money(j.quotedPriceCents)})</li>`).join("");
 const address = [booking.serviceAddressLine1,booking.serviceAddressLine2,booking.serviceCity,booking.serviceState,booking.servicePostalCode].filter(Boolean).map(esc).join(", ");
 const subject = role === "customer" ? `MOMS appointment confirmed — ${when}` : `New MOMS booking — ${when}`;
 const intro = role === "customer" ? `Hi ${esc(booking.customer?.firstName)}, your appointment is confirmed.` : `Customer: ${esc(booking.customer?.firstName)} ${esc(booking.customer?.lastName)} (${esc(booking.customer?.email)}; ${esc(booking.customer?.phone)}).`;
 const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#111"><h1>${role==="customer"?"Your MOMS appointment is confirmed":"New MOMS appointment"}</h1><p>${intro}</p><p><strong>Date:</strong> ${esc(when)}</p><ul>${jobs}</ul><p><strong>Address:</strong> ${address}</p><p><strong>Service subtotal before tax:</strong> ${money(booking.quotedTotalCents)}</p><p>Exact oil and filter specifications are verified before service.</p><p>MOMS Mobile Oil Change · Established 2013</p></div>`;
 return {subject,html};
}
async function enqueue(bookingId: string) {
 const booking = await getBooking(bookingId);
 if (!booking) throw new Error("booking_not_found_for_confirmation");
 const sql = getSql();
 const roles: Array<{role:Role;email:string}> = [{role:"business",email:OWNER}];
 if (booking.customer?.email) roles.unshift({role:"customer",email:booking.customer.email});
 for (const {role,email} of roles) {
   await sql`INSERT INTO moms_ops.booking_email_deliveries (booking_id,recipient_role,recipient_email)
     VALUES (${bookingId}::uuid,${role},${email})
     ON CONFLICT (booking_id,recipient_role) DO NOTHING`;
 }
 return booking;
}
export async function deliverBookingEmails(bookingId: string) {
 const booking = await enqueue(bookingId);
 const sql = getSql();
 const results: Array<{role:Role;status:string;messageId?:string}> = [];
 for (const role of ["customer","business"] as const) {
   // Atomic claim: only one request may send this role. A stale claim is retryable after 10 minutes.
   const claim = await sql`UPDATE moms_ops.booking_email_deliveries
     SET status='sending',attempts=attempts+1,updated_at=now()
     WHERE booking_id=${bookingId}::uuid AND recipient_role=${role}
       AND attempts < ${MAX_ATTEMPTS} AND next_attempt_at <= now()
       AND (status IN ('pending','failed') OR (status='sending' AND updated_at < now()-interval '10 minutes'))
     RETURNING recipient_email,attempts`;
   if (!claim.length) { results.push({role,status:"already_handled_or_not_due"});continue; }
   const email=String(claim[0].recipient_email), attempts=Number(claim[0].attempts);
   const apiKey=process.env.RESEND_API_KEY;
   try {
     if (!apiKey) throw new Error("RESEND_API_KEY not configured");
     const {subject,html}=details(booking,role);
     const response=await fetch("https://api.resend.com/emails",{
       method:"POST",
       headers:{"Authorization":`Bearer ${apiKey}`,"Content-Type":"application/json","Idempotency-Key":`moms-booking-${bookingId}-${role}`},
       body:JSON.stringify({from:FROM,to:[email],subject,html})
     });
     const data=await response.json().catch(()=>({})) as {id?:string;message?:string};
     if(!response.ok || !data.id) throw new Error(`resend_http_${response.status}:${data.message??"missing_provider_id"}`);
     await sql`UPDATE moms_ops.booking_email_deliveries SET status='accepted',provider_message_id=${data.id},last_error=NULL,sent_at=now(),updated_at=now()
       WHERE booking_id=${bookingId}::uuid AND recipient_role=${role}`;
     results.push({role,status:"accepted",messageId:data.id});
   } catch(error) {
     const message=error instanceof Error?error.message:"Unknown error";
     const nextStatus=attempts>=MAX_ATTEMPTS?"dead":"failed";
     // Exponential backoff: 2,4,8,16 minutes. State and provider ID survive restarts.
     const delay=Math.min(60,2**attempts);
     await sql`UPDATE moms_ops.booking_email_deliveries
       SET status=${nextStatus},last_error=${message.slice(0,500)},next_attempt_at=now()+(${delay}::int*interval '1 minute'),updated_at=now()
       WHERE booking_id=${bookingId}::uuid AND recipient_role=${role}`;
     console.error("booking_email_delivery_failed",{bookingId,role,attempts,message});
     results.push({role,status:nextStatus});
   }
 }
 return results;
}
export async function sendBookingConfirmation(bookingId:string) {
 return deliverBookingEmails(bookingId);
}
export async function retryDueBookingEmails(limit=25) {
 const sql=getSql();
 const due=await sql`SELECT DISTINCT booking_id FROM moms_ops.booking_email_deliveries
 WHERE attempts<${MAX_ATTEMPTS} AND next_attempt_at<=now()
 AND (status IN ('pending','failed') OR (status='sending' AND updated_at<now()-interval '10 minutes'))
 ORDER BY booking_id LIMIT ${limit}`;
 const results=[];
 for(const row of due) results.push({bookingId:row.booking_id,results:await deliverBookingEmails(String(row.booking_id))});
 return results;
}
