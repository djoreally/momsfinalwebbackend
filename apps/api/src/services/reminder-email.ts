import { getBooking } from "../repositories/bookings.js";
import { getSql } from "../../../../packages/db/src/index.js";

const RESEND_API="https://api.resend.com/emails";
function esc(value:unknown){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));}
function money(cents:number){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(cents/100);}

export async function send24HourReminder(bookingId:string){
 const sql=getSql();
 const rows=await sql`SELECT value FROM moms_ops.operational_settings WHERE key='notifications' LIMIT 1`;
 const settings=(rows[0]?.value as {appointmentReminderEmail?:boolean;ownerBccEmail?:string}|undefined)??{appointmentReminderEmail:true,ownerBccEmail:"support@momsoilchange.com"};
 if(settings.appointmentReminderEmail===false)return {sent:false,reason:"disabled"} as const;
 const apiKey=process.env.RESEND_API_KEY;if(!apiKey)return {sent:false,reason:"not_configured"} as const;
 const booking=await getBooking(bookingId);if(!booking)throw new Error("booking_not_found_for_reminder");
 if(["completed","cancelled"].includes(booking.status))return {sent:false,reason:"booking_closed"} as const;
 if(!booking.customer?.email)return {sent:false,reason:"customer_email_missing"} as const;
 const when=new Intl.DateTimeFormat("en-US",{month:"2-digit",day:"2-digit",year:"numeric",hour:"numeric",minute:"2-digit",timeZone:"America/New_York"}).format(new Date(booking.scheduledStart));
 const address=[booking.serviceAddressLine1,booking.serviceAddressLine2,booking.serviceCity,booking.serviceState,booking.servicePostalCode].filter(Boolean).map(esc).join(", ");
 const html=`<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#111"><h1>Your MOMS appointment is tomorrow</h1><p>Hi ${esc(booking.customer.firstName)},</p><p>This is a reminder for your mobile service appointment on <strong>${esc(when)}</strong>.</p><p><strong>Service location:</strong> ${address}</p><p><strong>Quoted total:</strong> ${money(booking.quotedTotalCents)}</p><p>Please make sure the vehicle is accessible at the scheduled location.</p><p>MOMS Mobile Oil Change<br>Established 2013</p></div>`;
 const from=process.env.BOOKING_EMAIL_FROM||"MOMS Mobile Oil Change <bookings@momsoilchange.com>";
 const bcc=settings.ownerBccEmail&&settings.ownerBccEmail.toLowerCase()!==booking.customer.email.toLowerCase()?[settings.ownerBccEmail]:undefined;
 const response=await fetch(RESEND_API,{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[booking.customer.email],bcc,subject:`MOMS appointment reminder — ${when}`,html})});
 if(!response.ok)throw new Error(`resend_reminder_failed:${response.status}:${(await response.text()).slice(0,300)}`);
 return {sent:true} as const;
}
