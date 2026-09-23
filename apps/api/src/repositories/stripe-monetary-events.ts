import { getDb, stripeMonetaryEvents } from "../../../../packages/db/src/index.js";

export type StripeMonetaryEvidenceInput = {
  evidenceKey:string;
  evidenceSource:"webhook"|"backfill";
  stripeEventId?:string|null;
  stripeEventType:string;
  stripePaymentIntentId?:string|null;
  stripeChargeId?:string|null;
  stripeCustomerId?:string|null;
  stripeBalanceTransactionId?:string|null;
  momsBookingId?:string|null;
  momsCustomerId?:string|null;
  momsPaymentId?:string|null;
  correlationConfidence:"direct"|"stripe_linked"|"matched"|"unlinked";
  attemptedCents?:number;
  grossCents?:number;
  feeCents?:number;
  netCents?:number;
  refundedCents?:number;
  currency?:string;
  intentStatus?:string|null;
  paymentMethodType?:string|null;
  walletType?:string|null;
  failureCode?:string|null;
  failureMessage?:string|null;
  cancellationReason?:string|null;
  radarRiskLevel?:string|null;
  payload:Record<string,unknown>;
  occurredAt:Date;
};

export async function recordStripeMonetaryEvidence(input:StripeMonetaryEvidenceInput){
  const db=getDb();
  await db.insert(stripeMonetaryEvents).values({
    evidenceKey:input.evidenceKey,
    evidenceSource:input.evidenceSource,
    stripeEventId:input.stripeEventId??null,
    stripeEventType:input.stripeEventType,
    stripePaymentIntentId:input.stripePaymentIntentId??null,
    stripeChargeId:input.stripeChargeId??null,
    stripeCustomerId:input.stripeCustomerId??null,
    stripeBalanceTransactionId:input.stripeBalanceTransactionId??null,
    momsBookingId:input.momsBookingId??null,
    momsCustomerId:input.momsCustomerId??null,
    momsPaymentId:input.momsPaymentId??null,
    correlationConfidence:input.correlationConfidence,
    attemptedCents:input.attemptedCents??0,
    grossCents:input.grossCents??0,
    feeCents:input.feeCents??0,
    netCents:input.netCents??0,
    refundedCents:input.refundedCents??0,
    currency:input.currency??"usd",
    intentStatus:input.intentStatus??null,
    paymentMethodType:input.paymentMethodType??null,
    walletType:input.walletType??null,
    failureCode:input.failureCode??null,
    failureMessage:input.failureMessage??null,
    cancellationReason:input.cancellationReason??null,
    radarRiskLevel:input.radarRiskLevel??null,
    payload:input.payload,
    occurredAt:input.occurredAt,
  }).onConflictDoNothing({target:stripeMonetaryEvents.evidenceKey});
}
