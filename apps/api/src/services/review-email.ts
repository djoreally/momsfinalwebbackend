import { getBooking } from "../repositories/bookings.js";
import { getSql } from "../../../../packages/db/src/index.js";

const RESEND_API="https://api.resend.com/emails";
function esc(value:unknown){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));}

export async function sendPostServiceReviewRequest(bookingId:string){
 const sql=getSql();
 const rows=await sql`SELECT value FROM moms_ops.operational_settings WHERE key='notifications' LIMIT 1`;
 const settings=(rows[0]?.value as {postServiceReviewEmail?:boolean;ownerBccEmail?:string}|undefined)??{postServiceReviewEmail:true,ownerBccEmail:"support@momsoilchange.com"};
 if(settings.postServiceReviewEmail===false)return {sent:false,reason:"disabled"} as const;
 const apiKey=process.env.RESEND_API_KEY;
 if(!apiKey)return {sent:false,reason:"not_configured"} as const;
 const reviewUrl=process.env.GOOGLE_REVIEW_URL;
 if(!reviewUrl)return {sent:false,reason:"review_url_not_configured"} as const;
 const booking=await getBooking(bookingId);
 if(!booking)throw new Error("booking_not_found_for_review");
 if(booking.status!=="completed")return {sent:false,reason:"booking_not_completed"} as const;
 if(!booking.customer?.email)return {sent:false,reason:"customer_email_missing"} as const;\n const consentRows=await sql`SELECT email_marketing_accepted FROM moms_ops.booking_consents WHERE booking_id=${bookingId}::uuid LIMIT 1`;\n if(consentRows[0]?.email_marketing_accepted===false)return {sent:false,reason:"email_marketing_opted_out"} as const;
 const from=process.env.BOOKING_EMAIL_FROM||"MOMS Mobile Oil Change <bookings@momsoilchange.com>";
 const html=`<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#111"><h1>How did we do?</h1><p>Hi ${esc(booking.customer.firstName)},</p><p>Thanks for choosing MOMS Mobile Oil Change. If you have a moment, we'd appreciate your feedback.</p><p><a href="${esc(reviewUrl)}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Leave a Google review</a></p><p>MOMS Mobile Oil Change<br>Established 2013</p></div>`;
 const bcc=settings.ownerBccEmail&&settings.ownerBccEmail.toLowerCase()!==booking.customer.email.toLowerCase()?[settings.ownerBccEmail]:undefined;
 const response=await fetch(RESEND_API,{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[booking.customer.email],bcc,subject:"How was your MOMS service?",html})});
 if(!response.ok)throw new Error(`resend_review_request_failed:${response.status}:${(await response.text()).slice(0,300)}`);
 return {sent:true} as const;
}
