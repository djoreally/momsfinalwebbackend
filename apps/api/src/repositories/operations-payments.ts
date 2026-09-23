import { getSql } from "../../../../packages/db/src/index.js";

export async function listPayments(input:{limit?:number;offset?:number;status?:string}={}){
  const sql=getSql(),limit=Math.min(Math.max(input.limit??100,1),200),offset=Math.max(input.offset??0,0),status=input.status??null;
  const payments=await sql`
    SELECT p.id,p.status,p.amount_cents AS "amountCents",p.currency,p.paid_at AS "paidAt",p.created_at AS "createdAt",
      p.booking_id AS "appointmentId",p.invoice_id AS "invoiceId",p.stripe_payment_intent_id AS "stripePaymentIntentId",
      c.id AS "customerId",c.first_name AS "firstName",c.last_name AS "lastName",
      i.status AS "invoiceStatus",i.total_cents AS "invoiceTotalCents",
      (SELECT json_build_object(
        'eventType',sme.stripe_event_type,'intentStatus',sme.intent_status,
        'grossCents',sme.gross_cents,'feeCents',sme.fee_cents,'netCents',sme.net_cents,
        'refundedCents',sme.refunded_cents,'paymentMethodType',sme.payment_method_type,
        'walletType',sme.wallet_type,'correlationConfidence',sme.correlation_confidence,
        'occurredAt',sme.occurred_at
      ) FROM moms_ops.stripe_monetary_events sme
        WHERE sme.stripe_payment_intent_id=p.stripe_payment_intent_id OR sme.moms_payment_id=p.id
        ORDER BY sme.occurred_at DESC,sme.created_at DESC LIMIT 1) AS "stripeEvidence"
    FROM moms_ops.payments p
    LEFT JOIN moms_ops.bookings b ON b.id=p.booking_id
    LEFT JOIN moms_ops.invoices i ON i.id=p.invoice_id
    LEFT JOIN moms_ops.customers c ON c.id=COALESCE(i.customer_id,b.customer_id)
    WHERE (${status}::text IS NULL OR p.status=${status})
    ORDER BY p.created_at DESC,p.id DESC LIMIT ${limit} OFFSET ${offset}
  `;
  const count=await sql`SELECT count(*)::int total FROM moms_ops.payments p WHERE (${status}::text IS NULL OR p.status=${status})`;
  return {payments,total:Number(count[0]?.total??0),limit,offset};
}
