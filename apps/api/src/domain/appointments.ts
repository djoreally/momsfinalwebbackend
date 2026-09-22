import { quoteService } from "./pricing.js";
import { hasAppointmentConflict } from "../repositories/availability.js";
import { createAppointment } from "../repositories/appointments.js";

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
  // Re-price at write time. Client-provided prices are never trusted.
  const quote = await quoteService({
    customerId: input.customerId,
    vehicleId: input.vehicleId,
    serviceId: input.serviceId,
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
    serviceId: input.serviceId,
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
