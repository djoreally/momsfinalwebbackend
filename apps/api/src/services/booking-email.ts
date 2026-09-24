import { getBooking } from "../repositories/bookings.js";

const RESEND_API = "https://api.resend.com/emails";

function money(cents: number) { return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(cents/100); }
function esc(value: unknown) { return String(value ?? "").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c] || c)); }

export async function sendBookingConfirmation(bookingId: string) {
  const apiKey=process.env.RESEND_API_KEY;
  if(!apiKey){ console.warn("RESEND_API_KEY is not configured; booking confirmation skipped"); return {sent:false,reason:"not_configured"} as const; }
  const booking=await getBooking(bookingId);
  if(!booking) throw new Error("booking_not_found_for_confirmation");
  const customer=booking.customer;
  if(!customer?.email) return {sent:false,reason:"customer_email_missing"} as const;

  const from=process.env.BOOKING_EMAIL_FROM || "MOMS Mobile Oil Change <bookings@momsoilchange.com>";
  const owner="support@momsoilchange.com";
  const when=new Intl.DateTimeFormat("en-US",{dateStyle:"full",timeStyle:"short",timeZone:"America/New_York"}).format(new Date(booking.scheduledStart));
  const jobs=booking.jobs.map((j)=>`<li><strong>${esc(j.service.name)}</strong> — ${esc(j.vehicle.year)} ${esc(j.vehicle.make)} ${esc(j.vehicle.model)} (${money(j.quotedPriceCents)})</li>`).join("");
  const address=[booking.serviceAddressLine1,booking.serviceAddressLine2,booking.serviceCity,booking.serviceState,booking.servicePostalCode].filter(Boolean).map(esc).join(", ");
  const total=money(booking.quotedTotalCents);
  const html=`<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#111"><h1>Your MOMS appointment is confirmed</h1><p>Hi ${esc(customer.firstName)},</p><p>We have your mobile service appointment scheduled for <strong>${esc(when)}</strong>.</p><ul>${jobs}</ul><p><strong>Service location:</strong> ${address}</p><p><strong>Quoted total:</strong> ${total}</p><p>We'll come to you. Please make sure the vehicle is accessible at the scheduled location.</p><p>MOMS Mobile Oil Change<br>Established 2013</p></div>`;

  const to=[customer.email];
  const bcc=owner && owner.toLowerCase()!==customer.email.toLowerCase() ? [owner] : undefined;
  const response=await fetch(RESEND_API,{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({from,to,bcc,subject:`MOMS booking confirmed — ${when}`,html})});
  if(!response.ok){ const body=await response.text(); throw new Error(`resend_booking_confirmation_failed:${response.status}:${body.slice(0,300)}`); }
  return {sent:true} as const;
}
