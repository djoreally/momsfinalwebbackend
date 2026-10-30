import { quoteService } from "./pricing.js";
import { hasAppointmentConflict } from "../repositories/availability.js";
import { createAppointment } from "../repositories/appointments.js";
import { findVehicleForCustomer } from "../repositories/customer-vehicle.js";
import { getService, getServiceBySlug } from "../repositories/services.js";
import { EUROPEAN_SPEC_SERVICE_SLUG, resolveSwitchedServiceSlug } from "./european-services.js";

/**
 * European auto-switch (owner ruling, 2026-10-30), same rule as the
 * booking flow in domain/bookings.ts: a regular oil-change service
 * for a European vehicle is corrected to the European-spec service
 * before pricing, and the corrected service is what gets stored.
 * Fail-safe: unresolvable vehicle/service, or a missing/inactive
 * European service row, leaves the appointment exactly as booked.
 */
async function resolveEffectiveServiceId(input: {
  customerId: string;
  vehicleId: string;
  serviceId: string;
}): Promise<string> {
  const [vehicle, service] = await Promise.all([
    findVehicleForCustomer(input.customerId, input.vehicleId),
    getService(input.serviceId),
  ]);
  if (!vehicle || !service) return input.serviceId;
  if (resolveSwitchedServiceSlug(service.slug, vehicle.make) === service.slug) return input.serviceId;
  const european = await getServiceBySlug(EUROPEAN_SPEC_SERVICE_SLUG);
  return european && european.active ? european.id : input.serviceId;
}

export class AppointmentConflictError extends Error {}
export class AppointmentValidationError extends Error {}

export async function reserveAppointment(input: {
  customerId: string;
  vehicleId: string;
  serviceId: string;
  scheduledStart: Date;
  serviceAddressLine1: string;
  serviceAddressLine2?: string | null;
  serviceCity: string;
  serviceState: string;
  servicePostalCode: string;
  notes?: string | null;
}) {
  const effectiveServiceId = await resolveEffectiveServiceId(input);

  // Re-price at write time. Client-provided prices are never trusted.
  const quote = await quoteService({
    customerId: input.customerId,
    vehicleId: input.vehicleId,
    serviceId: effectiveServiceId,
  });
  if (!quote) throw new AppointmentValidationError("quote_not_available");

  const scheduledEnd = new Date(
    input.scheduledStart.getTime() + quote.durationMinutes * 60_000,
  );

  // Re-check capacity immediately before persistence.
  if (await hasAppointmentConflict(input.scheduledStart, scheduledEnd)) {
    throw new AppointmentConflictError("slot_unavailable");
  }

  try {
    return await createAppointment({
    customerId: input.customerId,
    vehicleId: input.vehicleId,
    serviceId: effectiveServiceId,
    scheduledStart: input.scheduledStart,
    scheduledEnd,
    serviceAddressLine1: input.serviceAddressLine1,
    serviceAddressLine2: input.serviceAddressLine2,
    serviceCity: input.serviceCity,
    serviceState: input.serviceState,
    servicePostalCode: input.servicePostalCode,
    quotedPriceCents: quote.totalCents,
    notes: input.notes,
    });
  } catch (error) {
    // PostgreSQL exclusion_violation: another request reserved the slot
    // after our optimistic availability check but before this insert.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "23P01"
    ) {
      throw new AppointmentConflictError("slot_unavailable");
    }
    throw error;
  }
}
