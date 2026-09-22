import { getService } from "../repositories/services";
import { findVehicleForCustomer } from "../repositories/customer-vehicle";

export type PriceQuote = {
  serviceId: string;
  vehicleId: string;
  currency: "usd";
  basePriceCents: number;
  vehicleAdjustmentCents: number;
  subtotalCents: number;
  totalCents: number;
  durationMinutes: number;
  pricingVersion: "moms-v1";
};

/**
 * Server-authoritative pricing boundary.
 *
 * v1 deliberately applies no inferred vehicle surcharge. We will only add
 * adjustments backed by explicit MOMS pricing rules/data. This prevents the
 * frontend from inventing prices while the detailed oil/filter rules are built.
 */
export async function quoteService(input: {
  customerId: string;
  vehicleId: string;
  serviceId: string;
}): Promise<PriceQuote | null> {
  const [vehicle, service] = await Promise.all([
    findVehicleForCustomer(input.customerId, input.vehicleId),
    getService(input.serviceId),
  ]);

  if (!vehicle || !service || !service.active) return null;

  const vehicleAdjustmentCents = 0;
  const subtotalCents = service.basePriceCents + vehicleAdjustmentCents;

  return {
    serviceId: service.id,
    vehicleId: vehicle.id,
    currency: "usd",
    basePriceCents: service.basePriceCents,
    vehicleAdjustmentCents,
    subtotalCents,
    totalCents: subtotalCents,
    durationMinutes: service.defaultDurationMinutes,
    pricingVersion: "moms-v1",
  };
}
