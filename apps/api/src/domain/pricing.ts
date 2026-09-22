import { getService } from "../repositories/services";
import { findVehicleForCustomer } from "../repositories/customer-vehicle";

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

  const serviceSubtotalCents = service.basePriceCents + extraQuartChargeCents;
  const processingFeePercent = Number(service.processingFeePercent);
  const processingFeeWaived = Boolean(
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
    basePriceCents: service.basePriceCents,
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
  };
}


export async function previewServicePrice(input: {
  serviceId: string;
  oilCapacityQuarts?: number | null;
}) {
  const service = await getService(input.serviceId);
  if (!service || !service.active) return null;

  const capacity = input.oilCapacityQuarts ?? null;
  const included = service.includedQuarts === null ? null : Number(service.includedQuarts);
  const extraQuarts =
    capacity !== null && included !== null ? Math.max(0, capacity - included) : 0;
  const extraQuartChargeCents =
    service.extraQuartPriceCents === null ? 0 : Math.round(extraQuarts * service.extraQuartPriceCents);
  const serviceSubtotalCents = service.basePriceCents + extraQuartChargeCents;
  const processingFeePercent = Number(service.processingFeePercent);
  const processingFeeCents = centsForPercent(serviceSubtotalCents, processingFeePercent);
  const totalCents = serviceSubtotalCents + processingFeeCents;

  return {
    serviceId: service.id,
    currency: "usd" as const,
    basePriceCents: service.basePriceCents,
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
    isExact: capacity !== null || service.includedQuarts === null,
  };
}
