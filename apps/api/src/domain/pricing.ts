import { getService } from "../repositories/services.js";
import { findVehicleForCustomer } from "../repositories/customer-vehicle.js";

export const SOCIAL99_OFFER_CODE = "SOCIAL99" as const;
export const SOCIAL89_OFFER_CODE = "SOCIAL89" as const;
export const WIPERS119_OFFER_CODE = "WIPERS119" as const;

export const FACEBOOK_OFFER_CODES = [
  SOCIAL99_OFFER_CODE,
  SOCIAL89_OFFER_CODE,
  WIPERS119_OFFER_CODE,
] as const;
export type FacebookOfferCode = (typeof FACEBOOK_OFFER_CODES)[number];

/**
 * Facebook-only offers. Every one anchors to the $119 standard
 * full-synthetic price: SOCIAL99 and SOCIAL89 set a flat Facebook price,
 * WIPERS119 keeps the regular $119 price and adds free wiper blades at
 * the appointment. Discounted offers waive the processing fee;
 * WIPERS119 is priced exactly like a regular booking.
 */
const FACEBOOK_OFFER_BASE_PRICE_CENTS: Record<FacebookOfferCode, number> = {
  SOCIAL99: 9900,
  SOCIAL89: 8900,
  WIPERS119: 11900,
};

function resolveFacebookOffer(
  offerCode: string | null | undefined,
  basePriceCents: number,
): { code: FacebookOfferCode; effectiveBasePriceCents: number; feeWaived: boolean } | null {
  const code = FACEBOOK_OFFER_CODES.find((candidate) => candidate === offerCode) ?? null;
  if (!code || basePriceCents !== 11900) return null;
  return {
    code,
    effectiveBasePriceCents: FACEBOOK_OFFER_BASE_PRICE_CENTS[code],
    feeWaived: code !== WIPERS119_OFFER_CODE,
  };
}

export type PriceQuote = {
  serviceId: string;
  vehicleId: string;
  currency: "usd";
  basePriceCents: number;
  oilCapacityQuarts: number | null;
  includedQuarts: number | null;
  extraQuarts: number;
  extraQuartPriceCents: number | null;
  extraQuartChargeCents: number;
  extraQuartWaived: boolean;
  processingFeePercent: number;
  processingFeeCents: number;
  processingFeeWaived: boolean;
  preTaxTotalCents: number;
  totalCents: number;
  durationMinutes: number;
  pricingVersion: "moms-v2";
  offerCodeApplied: string | null;
  discountCents: number;
};

function centsForPercent(amountCents: number, percent: number) {
  return Math.round(amountCents * (percent / 100));
}

export async function quoteService(input: {
  customerId: string;
  vehicleId: string;
  serviceId: string;
  waiveExtraQuarts?: boolean;
  waiveProcessingFee?: boolean;
  offerCode?: string | null;
}): Promise<PriceQuote | null> {
  const [vehicle, service] = await Promise.all([
    findVehicleForCustomer(input.customerId, input.vehicleId),
    getService(input.serviceId),
  ]);

  if (!vehicle || !service || !service.active) return null;

  const capacity = vehicle.oilCapacityQuarts === null ? null : Number(vehicle.oilCapacityQuarts);
  const included = service.includedQuarts === null ? null : Number(service.includedQuarts);
  const extraQuarts =
    capacity !== null && included !== null ? Math.max(0, capacity - included) : 0;

  const extraQuartWaived = Boolean(input.waiveExtraQuarts && service.extraQuartWaivable);
  const extraQuartChargeCents =
    extraQuartWaived || service.extraQuartPriceCents === null
      ? 0
      : Math.round(extraQuarts * service.extraQuartPriceCents);

  const offer = resolveFacebookOffer(input.offerCode, service.basePriceCents);
  const effectiveBasePriceCents = offer ? offer.effectiveBasePriceCents : service.basePriceCents;
  const discountCents = service.basePriceCents - effectiveBasePriceCents;
  const serviceSubtotalCents = effectiveBasePriceCents + extraQuartChargeCents;
  const processingFeePercent = Number(service.processingFeePercent);
  const processingFeeWaived = Boolean(offer?.feeWaived) || Boolean(
    input.waiveProcessingFee && service.processingFeeWaivable,
  );
  const processingFeeCents = processingFeeWaived
    ? 0
    : centsForPercent(serviceSubtotalCents, processingFeePercent);
  const preTaxTotalCents = serviceSubtotalCents + processingFeeCents;

  return {
    serviceId: service.id,
    vehicleId: vehicle.id,
    currency: "usd",
    basePriceCents: effectiveBasePriceCents,
    oilCapacityQuarts: capacity,
    includedQuarts: included,
    extraQuarts,
    extraQuartPriceCents: service.extraQuartPriceCents,
    extraQuartChargeCents,
    extraQuartWaived,
    processingFeePercent,
    processingFeeCents,
    processingFeeWaived,
    preTaxTotalCents,
    totalCents: preTaxTotalCents,
    durationMinutes: service.defaultDurationMinutes,
    pricingVersion: "moms-v2",
    offerCodeApplied: offer ? offer.code : null,
    discountCents,
  };
}


export async function previewServicePrice(input: {
  serviceId: string;
  oilCapacityQuarts?: number | null;
  offerCode?: string | null;
}) {
  const service = await getService(input.serviceId);
  if (!service || !service.active) return null;

  const capacity = input.oilCapacityQuarts ?? null;
  const included = service.includedQuarts === null ? null : Number(service.includedQuarts);
  const extraQuarts =
    capacity !== null && included !== null ? Math.max(0, capacity - included) : 0;
  const extraQuartChargeCents =
    service.extraQuartPriceCents === null ? 0 : Math.round(extraQuarts * service.extraQuartPriceCents);
  const offer = resolveFacebookOffer(input.offerCode, service.basePriceCents);
  const effectiveBasePriceCents = offer ? offer.effectiveBasePriceCents : service.basePriceCents;
  const discountCents = service.basePriceCents - effectiveBasePriceCents;
  const serviceSubtotalCents = effectiveBasePriceCents + extraQuartChargeCents;
  const processingFeePercent = Number(service.processingFeePercent);
  const processingFeeCents = offer?.feeWaived ? 0 : centsForPercent(serviceSubtotalCents, processingFeePercent);
  const totalCents = serviceSubtotalCents + processingFeeCents;

  return {
    serviceId: service.id,
    currency: "usd" as const,
    basePriceCents: effectiveBasePriceCents,
    oilCapacityQuarts: capacity,
    includedQuarts: included,
    extraQuarts,
    extraQuartPriceCents: service.extraQuartPriceCents,
    extraQuartChargeCents,
    processingFeePercent,
    processingFeeCents,
    preTaxTotalCents: totalCents,
    totalCents,
    durationMinutes: service.defaultDurationMinutes,
    pricingVersion: "moms-v2" as const,
    offerCodeApplied: offer ? offer.code : null,
    discountCents,
    isExact: capacity !== null || service.includedQuarts === null,
  };
}
