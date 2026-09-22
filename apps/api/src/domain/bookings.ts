import { quoteService } from "./pricing.js";
import { hasAppointmentConflict } from "../repositories/availability.js";
import { createBooking } from "../repositories/bookings.js";

export class BookingConflictError extends Error {}
export class BookingValidationError extends Error {}

export async function reserveBooking(input: {
  customerId: string;
  jobs: Array<{ vehicleId: string; serviceId: string }>;
  scheduledStart: Date;
  serviceAddressLine1: string;
  serviceAddressLine2?: string | null;
  serviceCity: string;
  serviceState: string;
  servicePostalCode: string;
  notes?: string | null;
}) {
  if (!input.jobs.length) throw new BookingValidationError("booking_requires_job");

  const unique = new Set(input.jobs.map((job) => `${job.vehicleId}:${job.serviceId}`));
  if (unique.size !== input.jobs.length) throw new BookingValidationError("duplicate_booking_job");

  const quotes = await Promise.all(input.jobs.map((job) => quoteService({
    customerId: input.customerId,
    vehicleId: job.vehicleId,
    serviceId: job.serviceId,
  })));
  if (quotes.some((quote) => !quote)) throw new BookingValidationError("quote_not_available");

  const resolved = quotes.filter((quote): quote is NonNullable<typeof quote> => Boolean(quote));
  const durationMinutes = resolved.reduce((sum, quote) => sum + quote.durationMinutes, 0);
  const quotedTotalCents = resolved.reduce((sum, quote) => sum + quote.totalCents, 0);
  const scheduledEnd = new Date(input.scheduledStart.getTime() + durationMinutes * 60_000);

  if (await hasAppointmentConflict(input.scheduledStart, scheduledEnd)) {
    throw new BookingConflictError("slot_unavailable");
  }

  return createBooking({
    customerId: input.customerId,
    scheduledStart: input.scheduledStart,
    scheduledEnd,
    serviceAddressLine1: input.serviceAddressLine1,
    serviceAddressLine2: input.serviceAddressLine2,
    serviceCity: input.serviceCity,
    serviceState: input.serviceState,
    servicePostalCode: input.servicePostalCode,
    quotedTotalCents,
    notes: input.notes,
    jobs: resolved.map((quote, position) => ({
      vehicleId: quote.vehicleId,
      serviceId: quote.serviceId,
      quotedPriceCents: quote.totalCents,
      durationMinutes: quote.durationMinutes,
      position,
    })),
  });
}
