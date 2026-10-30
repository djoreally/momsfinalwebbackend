import { quoteService, type PriceQuote } from "./pricing.js";
import { applyOffer, getOffer, OfferError } from "./offers.js";
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
  offerCode?: string | null;
}) {
  if (!input.jobs.length) throw new BookingValidationError("booking_requires_job");

  // Offer rules come from the registry (domain/offers.ts). An unknown
  // code is rejected before any pricing work — a promised price never
  // silently becomes the standard price.
  const offer = input.offerCode ? getOffer(input.offerCode) : null;
  if (input.offerCode && !offer) throw new BookingValidationError("offer_not_recognized");

  const unique = new Set(input.jobs.map((job) => `${job.vehicleId}:${job.serviceId}`));
  if (unique.size !== input.jobs.length) throw new BookingValidationError("duplicate_booking_job");

  // Jobs are priced at standard rates first; the registry then confirms
  // what the offer code does to those quotes.
  const quotes = await Promise.all(input.jobs.map((job) => quoteService({
    customerId: input.customerId,
    vehicleId: job.vehicleId,
    serviceId: job.serviceId,
  })));
  if (quotes.some((quote) => !quote)) throw new BookingValidationError("quote_not_available");

  const standardQuotes = quotes.filter((quote): quote is PriceQuote => Boolean(quote));
  let resolved = standardQuotes;
  if (offer) {
    try {
      // Booking mode enforces the registry rules against this booking:
      // single-job-only offers reject multi-job bookings, min-jobs and
      // weekday (America/New_York, against scheduledStart) are checked,
      // and an offer attached to a non-eligible job fails the booking.
      resolved = applyOffer(standardQuotes, offer.code, {
        scheduledStart: input.scheduledStart,
        mode: "booking",
      }).quotes;
    } catch (error) {
      if (error instanceof OfferError) throw new BookingValidationError(error.code);
      throw error;
    }
  }
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
      subtotalCents: quote.serviceSubtotalCents,
      wasteFeeCents: quote.wasteFeeCents,
      processingFeeCents: quote.processingFeeCents,
      taxCents: quote.taxCents,
      durationMinutes: quote.durationMinutes,
      position,
    })),
  });
}
