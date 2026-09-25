import { requireAdminSession } from "../middleware/admin-session.js";
import { Hono } from "hono";
import { z } from "zod";
import { listPayments } from "../repositories/operations-payments.js";
import { getStripe } from "../integrations/stripe.js";
import { getSql } from "../../../../packages/db/src/index.js";

export const operationsPaymentRoutes=new Hono();
operationsPaymentRoutes.use("*",requireAdminSession);

operationsPaymentRoutes.get("/",async c=>{
  const q=z.object({limit:z.coerce.number().int().min(1).max(200).default(100),offset:z.coerce.number().int().min(0).default(0),status:z.enum(["pending","processing","paid","failed","refunded","cancelled"]).optional()}).safeParse(c.req.query());
  if(!q.success)return c.json({error:"invalid_query"},400);
  return c.json(await listPayments(q.data));
});

operationsPaymentRoutes.post("/terminal/connection-token",async c=>{
  const token=await getStripe().terminal.connectionTokens.create();
  return c.json({secret:token.secret});
});

operationsPaymentRoutes.post("/terminal/invoices/:id/prepare",async c=>{
  const id=c.req.param("id");
  if(!z.string().uuid().safeParse(id).success)return c.json({error:"invalid_invoice_id"},400);
  const sql=getSql();
  const rows=await sql`
    SELECT i.id,i.status,i.amount_due_cents AS "amountDueCents",i.currency,
      i.appointment_id AS "bookingId",i.customer_id AS "customerId",
      c.email
    FROM moms_ops.invoices i
    JOIN moms_ops.customers c ON c.id=i.customer_id
    WHERE i.id=${id}::uuid LIMIT 1
  `;
  const invoice=rows[0] as any;
  if(!invoice)return c.json({error:"invoice_not_found"},404);
  if(invoice.status==="paid"||Number(invoice.amountDueCents)<=0)return c.json({error:"invoice_already_paid"},409);
  if(invoice.status==="void")return c.json({error:"invoice_void"},409);

  let paymentRows=await sql`
    SELECT id,stripe_payment_intent_id AS "stripePaymentIntentId",status
    FROM moms_ops.payments
    WHERE invoice_id=${id}::uuid
    ORDER BY created_at DESC LIMIT 1
  `;
  let payment=paymentRows[0] as any;
  if(!payment){
    const created=await sql`
      INSERT INTO moms_ops.payments(booking_id,invoice_id,amount_cents,currency,status)
      VALUES(${invoice.bookingId}::uuid,${id}::uuid,${Number(invoice.amountDueCents)},${String(invoice.currency??"usd")},'pending')
      RETURNING id,status
    `;
    payment=created[0] as any;
  }

  const intent=await getStripe().paymentIntents.create({
    amount:Number(invoice.amountDueCents),
    currency:String(invoice.currency??"usd"),
    payment_method_types:["card_present"],
    capture_method:"automatic",
    metadata:{
      moms_payment_id:String(payment.id),
      moms_invoice_id:id,
      moms_booking_id:String(invoice.bookingId),
      moms_customer_id:String(invoice.customerId),
      moms_collection_channel:"terminal_tap_to_pay"
    }
  },{idempotencyKey:`moms-terminal-invoice-${id}-${Number(invoice.amountDueCents)}`});

  await sql`
    UPDATE moms_ops.payments
    SET stripe_payment_intent_id=${intent.id},amount_cents=${Number(invoice.amountDueCents)},status='processing',updated_at=now()
    WHERE id=${payment.id}::uuid
  `;

  return c.json({
    paymentId:payment.id,
    invoiceId:id,
    paymentIntentId:intent.id,
    clientSecret:intent.client_secret,
    amountCents:Number(invoice.amountDueCents),
    currency:String(invoice.currency??"usd")
  },201);
});
