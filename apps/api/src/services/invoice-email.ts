import { getSql } from "../../../../packages/db/src/index.js";

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
 const items=(invoice.items??[]).map((x:any)=>`<tr><td style="padding:8px;border-bottom:1px solid #eee">${esc(x.description)}</td><td style="padding:8px;border-bottom:1px solid #eee">${esc(x.quantity)}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${money(Number(x.totalCents))}</td></tr>`).join("");
 const html=`<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#111"><h1>MOMS Mobile Oil Change invoice</h1><p>Hi ${esc(invoice.firstName)},</p><p>Here is your invoice from MOMS Mobile Oil Change.</p><table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:8px">Service</th><th style="text-align:left;padding:8px">Qty</th><th style="text-align:right;padding:8px">Amount</th></tr></thead><tbody>${items}</tbody></table><p style="font-size:18px"><strong>Amount due: ${money(Number(invoice.amountDueCents))}</strong></p>${invoice.notes?`<p><strong>Notes:</strong> ${esc(invoice.notes)}</p>`:""}<p>Payment is due according to the payment method selected for your appointment.</p><p>MOMS Mobile Oil Change<br>Established 2013</p></div>`;
 const from=process.env.BOOKING_EMAIL_FROM||"MOMS Mobile Oil Change <bookings@momsoilchange.com>";
 const response=await fetch(RESEND_API,{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[invoice.email],bcc:["support@momsoilchange.com"],subject:`MOMS invoice — ${money(Number(invoice.amountDueCents))} due`,html})});
 if(!response.ok){const body=await response.text();throw new Error(`invoice_email_failed:${response.status}:${body.slice(0,200)}`)}
 return {sent:true,email:invoice.email};
}
