import type Stripe from "stripe";
import { getStripe } from "../integrations/stripe.js";
import { recordStripeMonetaryEvidence } from "../repositories/stripe-monetary-events.js";

function cleanPayload(value:unknown):Record<string,unknown>{
  const redact=(input:unknown):unknown=>{
    if(Array.isArray(input))return input.map(redact);
    if(input&&typeof input==="object"){
      const out:Record<string,unknown>={};
      for(const [key,val] of Object.entries(input as Record<string,unknown>)){
        if(["client_secret","receipt_url","fingerprint"].includes(key))continue;
        out[key]=redact(val);
      }
      return out;
    }
    return input;
  };
  return redact(value) as Record<string,unknown>;
}
function ids(meta:Stripe.Metadata|null|undefined){
  const booking=meta?.moms_booking_id||null;
  const customer=meta?.moms_customer_id||null;
  const payment=meta?.moms_payment_id||null;
  return {booking,customer,payment,confidence:booking?"direct":customer?"stripe_linked":"unlinked" as const};
}
async function chargeAndBalance(pi:Stripe.PaymentIntent){
  if(!pi.latest_charge)return {charge:null as Stripe.Charge|null,balance:null as Stripe.BalanceTransaction|null};
  const stripe=getStripe();
  const charge=typeof pi.latest_charge==="string"
    ? await stripe.charges.retrieve(pi.latest_charge,{expand:["balance_transaction"]})
    : pi.latest_charge as Stripe.Charge;
  const balance=typeof charge.balance_transaction==="string"
    ? await stripe.balanceTransactions.retrieve(charge.balance_transaction)
    : charge.balance_transaction as Stripe.BalanceTransaction|null;
  return {charge,balance};
}
function walletType(charge:Stripe.Charge|null){
  const details=charge?.payment_method_details;
  if(!details)return null;
  if(details.type==="card")return details.card.wallet?.type??null;
  if(details.type==="card_present")return details.card_present.wallet?.type??null;
  return null;
}
function billing(charge:Stripe.Charge|null){
  const b=charge?.billing_details;
  return {
    billingName:b?.name??null,billingEmail:b?.email??null,billingPhone:b?.phone??null,
    billingCity:b?.address?.city??null,billingState:b?.address?.state??null,
    billingPostalCode:b?.address?.postal_code??null,billingCountry:b?.address?.country??null,
  };
}

export async function recordPaymentIntentEvent(event:Stripe.Event,pi:Stripe.PaymentIntent){
  const {charge,balance}=await chargeAndBalance(pi);
  const anchor=ids(pi.metadata&&Object.keys(pi.metadata).length?pi.metadata:charge?.metadata);
  await recordStripeMonetaryEvidence({
    evidenceKey:"stripe_event:"+event.id,evidenceSource:"webhook",stripeEventId:event.id,stripeEventType:event.type,
    stripePaymentIntentId:pi.id,stripeChargeId:charge?.id??null,
    stripeCustomerId:typeof pi.customer==="string"?pi.customer:pi.customer?.id??null,
    stripeBalanceTransactionId:balance?.id??null,momsBookingId:anchor.booking,momsCustomerId:anchor.customer,momsPaymentId:anchor.payment,
    correlationConfidence:anchor.confidence,attemptedCents:pi.amount,
    grossCents:event.type==="payment_intent.succeeded"?(charge?.amount??pi.amount_received):0,
    feeCents:event.type==="payment_intent.succeeded"?(balance?.fee??0):0,
    netCents:event.type==="payment_intent.succeeded"?(balance?.net??0):0,
    refundedCents:charge?.amount_refunded??0,currency:pi.currency,intentStatus:pi.status,
    paymentMethodType:charge?.payment_method_details?.type??null,walletType:walletType(charge),
    failureCode:pi.last_payment_error?.code??charge?.failure_code??null,
    failureMessage:pi.last_payment_error?.message??charge?.failure_message??null,
    cancellationReason:pi.cancellation_reason??null,radarRiskLevel:charge?.outcome?.risk_level??null,
    ...billing(charge),payload:cleanPayload(event),occurredAt:new Date(event.created*1000),
  });
}

export async function recordRefundEvent(event:Stripe.Event,refund:Stripe.Refund){
  const stripe=getStripe();
  const piId=typeof refund.payment_intent==="string"?refund.payment_intent:null;
  const pi=piId?await stripe.paymentIntents.retrieve(piId):null;
  const anchor=ids(pi?.metadata);
  const balance=typeof refund.balance_transaction==="string"
    ? await stripe.balanceTransactions.retrieve(refund.balance_transaction)
    : refund.balance_transaction as Stripe.BalanceTransaction|null;
  await recordStripeMonetaryEvidence({
    evidenceKey:"stripe_event:"+event.id,evidenceSource:"webhook",stripeEventId:event.id,stripeEventType:event.type,
    stripePaymentIntentId:piId,stripeChargeId:typeof refund.charge==="string"?refund.charge:null,
    stripeCustomerId:typeof refund.customer==="string"?refund.customer:refund.customer?.id??null,
    stripeBalanceTransactionId:balance?.id??null,momsBookingId:anchor.booking,momsCustomerId:anchor.customer,momsPaymentId:anchor.payment,
    correlationConfidence:anchor.confidence,refundedCents:refund.amount,feeCents:balance?.fee??0,netCents:balance?.net??0,
    currency:refund.currency,intentStatus:"refunded",payload:cleanPayload(event),occurredAt:new Date(event.created*1000),
  });
}

export async function recordDisputeEvent(event:Stripe.Event,dispute:Stripe.Dispute){
  const stripe=getStripe();
  const chargeId=typeof dispute.charge==="string"?dispute.charge:dispute.charge?.id??null;
  const charge=chargeId?await stripe.charges.retrieve(chargeId):null;
  const piId=charge&&typeof charge.payment_intent==="string"?charge.payment_intent:null;
  const pi=piId?await stripe.paymentIntents.retrieve(piId):null;
  const anchor=ids(pi?.metadata&&Object.keys(pi.metadata).length?pi.metadata:charge?.metadata);
  await recordStripeMonetaryEvidence({
    evidenceKey:"stripe_event:"+event.id,evidenceSource:"webhook",stripeEventId:event.id,stripeEventType:event.type,
    stripePaymentIntentId:piId,stripeChargeId:chargeId,stripeCustomerId:typeof charge?.customer==="string"?charge.customer:charge?.customer?.id??null,
    momsBookingId:anchor.booking,momsCustomerId:anchor.customer,momsPaymentId:anchor.payment,correlationConfidence:anchor.confidence,
    grossCents:0,feeCents:0,netCents:event.type==="charge.dispute.created"?-dispute.amount:0,
    currency:dispute.currency,intentStatus:"disputed",failureCode:dispute.reason,
    failureMessage:"Stripe dispute "+event.type,...billing(charge),payload:cleanPayload(event),occurredAt:new Date(event.created*1000),
  });
}
