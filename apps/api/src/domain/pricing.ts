import { getService } from "../repositories/services.js";
import { findVehicleForCustomer } from "../repositories/customer-vehicle.js";
import { applyOffer } from "./offers.js";
import { calculatePriceComponents } from "./price-components.js";

export { calculatePriceComponents } from "./price-components.js";

export {
  SOCIAL99_OFFER_CODE,
  SOCIAL89_OFFER_CODE,
  WIPERS119_OFFER_CODE,
  FACEBOOK_OFFER_CODES,
} from "./offers.js";
export type { FacebookOfferCode } from "./offers.js";
export { OfferError } from "./offers.js";

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
  serviceSubtotalCents: number;
  wasteFeeCents: number;
  processingFeePercent: number;
  processingFeeCents: number;
  processingFeeWaived: boolean;
  taxRatePercent: number;
  taxCents: number;
  preTaxTotalCents: number;
  totalCents: number;
  durationMinutes: number;
  pricingVersion: "moms-v2";
  offerCodeApplied: string | null;
  discountCents: number;
  offerNote: string | null;
};

/**
 * Applies an offer code to a single standard-priced quote through the
 * offer registry, in provisional mode: weekday / min-jobs / single-job
 * rules are confirmed at booking time (see domain/offers.ts). Unknown
 * codes throw OfferError("offer_not_recognized") — a promised price never
 * silently becomes the standard price. An offer attached to a
 * non-eligible service (standard base price other than $119) leaves the
 * quote at standard pricing with `offerCodeApplied: null`, as before.
 */
function applyOfferToQuote(quote: PriceQuote, offerCode: string | null | undefined): PriceQuote {
  if (!offerCode) return quote;
  const { quotes, offerNote } = applyOffer([quote], offerCode, { mode: "provisional" });
  return { ...quotes[0], offerNote };
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

  const processingFeePercent = Number(service.processingFeePercent);
  const processingFeeWaived = Boolean(
    input.waiveProcessingFee && service.processingFeeWaivable,
  );
  const serviceSubtotalCents = service.basePriceCents + extraQuartChargeCents;
  const wasteFeeCents = service.wasteFeeCents;
  const taxRatePercent = Number(service.taxRatePercent);
  const { processingFeeCents, taxCents, preTaxTotalCents, totalCents } =
    calculatePriceComponents({
      serviceSubtotalCents,
      wasteFeeCents,
      processingFeePercent,
      processingFeeWaived,
      taxRatePercent,
    });

  const standardQuote: PriceQuote = {
    serviceId: service.id,
    vehicleId: vehicle.id,
    currency: "usd",
    basePriceCents: service.basePriceCents,
    oilCapacityQuarts: capacity,
    includedQuarts: included,
    extraQuarts,
    extraQuartPriceCents: service.extraQuartPriceCents,
    extraQuartChargeCents,
    extraQuartWaived,
    serviceSubtotalCents,
    wasteFeeCents,
    processingFeePercent,
    processingFeeCents,
    processingFeeWaived,
    taxRatePercent,
    taxCents,
    preTaxTotalCents,
    totalCents,
    durationMinutes: service.defaultDurationMinutes,
    pricingVersion: "moms-v2",
    offerCodeApplied: null,
    discountCents: 0,
    offerNote: null,
  };

  return applyOfferToQuote(standardQuote, input.offerCode);
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
  const processingFeePercent = Number(service.processingFeePercent);
  const serviceSubtotalCents = service.basePriceCents + extraQuartChargeCents;
  const wasteFeeCents = service.wasteFeeCents;
  const taxRatePercent = Number(service.taxRatePercent);
  const { processingFeeCents, taxCents, preTaxTotalCents, totalCents } =
    calculatePriceComponents({
      serviceSubtotalCents,
      wasteFeeCents,
      processingFeePercent,
      processingFeeWaived: false,
      taxRatePercent,
    });

  const standardQuote = {
    serviceId: service.id,
    currency: "usd" as const,
    basePriceCents: service.basePriceCents,
    oilCapacityQuarts: capacity,
    includedQuarts: included,
    extraQuarts,
    extraQuartPriceCents: service.extraQuartPriceCents,
    extraQuartChargeCents,
    serviceSubtotalCents,
    wasteFeeCents,
    processingFeePercent,
    processingFeeCents,
    processingFeeWaived: false,
    taxRatePercent,
    taxCents,
    preTaxTotalCents,
    totalCents,
    durationMinutes: service.defaultDurationMinutes,
    pricingVersion: "moms-v2" as const,
    offerCodeApplied: null,
    discountCents: 0,
    isExact: capacity !== null || service.includedQuarts === null,
    offerNote: null as string | null,
  };

  if (!input.offerCode) return standardQuote;
  const { quotes, offerNote } = applyOffer([standardQuote], input.offerCode, { mode: "provisional" });
  return { ...quotes[0], offerNote };
}
