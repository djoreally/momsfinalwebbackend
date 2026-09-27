import { getBooking } from "../repositories/bookings.js";
import { getSql } from "../../../../packages/db/src/index.js";
import { detailRow, emailShell, escapeHtml, money, sendResendEmail } from "./email-system.js";

type NotificationSettings={bookingConfirmationEmail?:boolean;ownerBccEmail?:string};
type BusinessSettings={businessName?:string;publicEmail?:string};

async function getEmailSettings(){
  const rows=await getSql()`SELECT key,value FROM moms_ops.operational_settings WHERE key IN ('notifications','business')`;
  const values=Object.fromEntries(rows.map((r:any)=>[String(r.key),r.value]));
  const notifications=(values.notifications as NotificationSettings|undefined)??{bookingConfirmationEmail:true};
  const business=(values.business as BusinessSettings|undefined)??{};
  const ownerEmail=String(business.publicEmail||notifications.ownerBccEmail||"").trim();
  return {notifications,business,ownerEmail};
}

function bookingDetails(booking:any){
  const when=new Intl.DateTimeFormat("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",timeZone:"America/New_York",timeZoneName:"short"}).format(new Date(booking.scheduledStart));
  const address=[booking.serviceAddressLine1,booking.serviceAddressLine2,booking.serviceCity,booking.serviceState,booking.servicePostalCode].filter(Boolean).join(", ");
  const vehicleServices=booking.jobs.map((j:any)=>({
    vehicle:`${j.vehicle.year} ${j.vehicle.make} ${j.vehicle.model}`,
    service:j.service.name,
    price:money(j.quotedPriceCents)
  }));
  return {when,address,vehicleServices,total:money(booking.quotedTotalCents)};
}

export async function sendBookingConfirmation(bookingId:string){
  const {notifications,ownerEmail}=await getEmailSettings();
  if(notifications.bookingConfirmationEmail===false)return {sent:false,reason:"disabled"} as const;
  const booking=await getBooking(bookingId);
  if(!booking)throw new Error("booking_not_found_for_confirmation");
  const customer=booking.customer;
  if(!customer?.email)return {sent:false,reason:"customer_email_missing"} as const;
  const d=bookingDetails(booking);

  const services=d.vehicleServices.map((x:any)=>`<tr><td style="padding:12px 0;border-bottom:1px solid #e5e7eb"><div style="font-weight:800">${escapeHtml(x.service)}</div><div style="margin-top:3px;color:#6b7280;font-size:13px">${escapeHtml(x.vehicle)}</div></td><td style="padding:12px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:800">${escapeHtml(x.price)}</td></tr>`).join("");
  const customerHtml=emailShell({
    eyebrow:"Appointment confirmed",
    title:`You're scheduled, ${customer.firstName}`,
    intro:"Your MOMS mobile service appointment is confirmed. We'll come to the service location below.",
    body:`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px">${detailRow("Date & time",d.when)}${detailRow("Service location",d.address)}${detailRow("Booking reference",booking.id)}</table>
      <div style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin:24px 0 4px">Scheduled service</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${services}<tr><td style="padding:16px 0;font-size:17px;font-weight:900">Quoted total</td><td style="padding:16px 0;text-align:right;font-size:18px;font-weight:900">${escapeHtml(d.total)}</td></tr></table>
      <div style="margin-top:20px;padding:16px;background:#f9fafb;border-radius:10px;color:#374151;font-size:14px;line-height:1.6">Please make sure the vehicle is accessible at the scheduled service location. If anything changes, contact MOMS before your appointment.</div>`,
    footerNote:"This is a transactional message about your scheduled appointment."
  });
  const customerSend=await sendResendEmail({to:[customer.email],subject:`MOMS appointment confirmed — ${d.when}`,html:customerHtml});
  if(!customerSend.sent)return customerSend;

  let ownerSent=false;
  let ownerReason:string|undefined;
  if(ownerEmail && ownerEmail.toLowerCase()!==customer.email.toLowerCase()){
    const ownerHtml=emailShell({
      eyebrow:"Operations alert",
      title:"New appointment booked",
      intro:"A customer completed a booking on momsoilchange.com.",
      body:`<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${detailRow("Customer",`${customer.firstName} ${customer.lastName||""}`.trim())}${detailRow("Email",customer.email)}${detailRow("Phone",customer.phone||"—")}${detailRow("Date & time",d.when)}${detailRow("Location",d.address)}${detailRow("Service",d.vehicleServices.map((x:any)=>`${x.service} — ${x.vehicle}`).join("; "))}${detailRow("Quoted total",d.total)}${detailRow("Booking ID",booking.id)}</table>`,
      footerNote:"Internal MOMS operations notification."
    });
    const ownerSend=await sendResendEmail({to:[ownerEmail],subject:`New MOMS appointment — ${customer.firstName} — ${d.when}`,html:ownerHtml});
    ownerSent=ownerSend.sent;
    if(!ownerSend.sent)ownerReason=ownerSend.reason;
  }else{
    ownerReason=ownerEmail?"same_as_customer":"owner_email_missing";
  }
  return {sent:true,providerMessageId:customerSend.providerMessageId,ownerSent,ownerReason} as const;
}
