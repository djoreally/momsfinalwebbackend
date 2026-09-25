import { getSql } from "../../../../packages/db/src/index.js";
import { getStripe } from "../integrations/stripe.js";

const RESEND_API="https://api.resend.com/emails";
const money=(c:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(c/100);
const esc=(v:unknown)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));

export async function sendInvoiceEmail(invoiceId:string){
 const rows=await getSql()`SELECT i.id,i.status,i.total_cents AS "totalCents",i.amount_due_cents AS "amountDueCents",i.notes,
  c.first_name AS "firstName",c.last_name AS "lastName",c.email,
  COALESCE((SELECT json_agg(json_build_object('description',ii.description,'quantity',ii.quantity,'totalCents',ii.total_cents) ORDER BY ii.position,ii.created_at) FROM moms_ops.invoice_items ii WHERE ii.invoice_id=i.id),'[]'::json) items
  FROM moms_ops.invoices i JOIN moms_ops.customers c ON c.id=i.customer_id WHERE i.id=${invoiceId}::uuid LIMIT 1`;
 const invoice=rows[0] as any;if(!invoice)throw new Error("invoice_not_found");
 if(invoice.status!=="issued")throw new Error("invoice_not_issued");
 if(!invoice.email)throw new Error("customer_email_missing");
 const apiKey=process.env.RESEND_API_KEY;if(!apiKey)throw new Error("invoice_email_not_configured");
 const sql=getSql();
 const paymentRows=await sql`SELECT p.id,p.stripe_payment_intent_id FROM moms_ops.payments p WHERE p.invoice_id=${invoiceId}::uuid OR p.booking_id=(SELECT appointment_id FROM moms_ops.invoices WHERE id=${invoiceId}::uuid) ORDER BY p.created_at DESC LIMIT 1`;
 let payment=paymentRows[0] as any;
 if(!payment){const created=await sql`INSERT INTO moms_ops.payments(booking_id,invoice_id,amount_cents,currency,status) SELECT appointment_id,id,amount_due_cents,currency,'pending' FROM moms_ops.invoices WHERE id=${invoiceId}::uuid RETURNING id`;payment=created[0];}
 else await sql`UPDATE moms_ops.payments SET invoice_id=${invoiceId}::uuid,amount_cents=${Number(invoice.amountDueCents)},status=CASE WHEN status='due_at_appointment' THEN 'pending' ELSE status END,updated_at=now() WHERE id=${payment.id}::uuid`;
 const site=(process.env.PUBLIC_SITE_URL||"https://momsoilchange.com").replace(/\/$/,"");
 const session=await getStripe().checkout.sessions.create({mode:"payment",customer_email:invoice.email,line_items:[{quantity:1,price_data:{currency:"usd",unit_amount:Number(invoice.amountDueCents),product_data:{name:"MOMS Mobile Oil Change invoice"}}}],payment_intent_data:{metadata:{moms_payment_id:String(payment.id),moms_invoice_id:invoiceId,moms_booking_id:String((await sql`SELECT appointment_id FROM moms_ops.invoices WHERE id=${invoiceId}::uuid`)[0]?.appointment_id??"")}},success_url:`${site}/payment/complete?invoice=${invoiceId}`,cancel_url:`${site}/payment/cancelled?invoice=${invoiceId}`,metadata:{moms_payment_id:String(payment.id),moms_invoice_id:invoiceId}},{idempotencyKey:`moms-invoice-checkout-${invoiceId}-${Number(invoice.amountDueCents)}`});
 if(!session.url)throw new Error("invoice_payment_link_failed");
 const paymentUrl=session.url;
 const items=(invoice.items??[]).map((x:any)=>`<tr><td style="padding:8px;border-bottom:1px solid #eee">${esc(x.description)}</td><td style="padding:8px;border-bottom:1px solid #eee">${esc(x.quantity)}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${money(Number(x.totalCents))}</td></tr>`).join("");
 const html=`<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#111"><h1>MOMS Mobile Oil Change invoice</h1><p>Hi ${esc(invoice.firstName)},</p><p>Here is your invoice from MOMS Mobile Oil Change.</p><table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:8px">Service</th><th style="text-align:left;padding:8px">Qty</th><th style="text-align:right;padding:8px">Amount</th></tr></thead><tbody>${items}</tbody></table><p style="font-size:18px"><strong>Amount due: ${money(Number(invoice.amountDueCents))}</strong></p>${invoice.notes?`<p><strong>Notes:</strong> ${esc(invoice.notes)}</p>`:""}<p><a href="${esc(paymentUrl)}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;font-weight:bold;padding:14px 20px;border-radius:8px">Pay Invoice Online</a></p><p>You can pay securely online by card using the button above. If you prefer, your existing pay-at-appointment option remains available.</p><p>MOMS Mobile Oil Change<br>Established 2013</p></div>`;
 const from=process.env.BOOKING_EMAIL_FROM||"MOMS Mobile Oil Change <bookings@momsoilchange.com>";
 const response=await fetch(RESEND_API,{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[invoice.email],bcc:["support@momsoilchange.com"],subject:`MOMS invoice — ${money(Number(invoice.amountDueCents))} due`,html})});
 if(!response.ok){const body=await response.text();throw new Error(`invoice_email_failed:${response.status}:${body.slice(0,200)}`)}
 return {sent:true,email:invoice.email,paymentUrl};
}
