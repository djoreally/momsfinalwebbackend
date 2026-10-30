import { quoteService, type PriceQuote } from "./pricing.js";
import { applyOffer, getOffer, OfferError } from "./offers.js";
import { hasAppointmentConflict } from "../repositories/availability.js";
import { createBooking } from "../repositories/bookings.js";
import { findVehicleForCustomer, getCustomer } from "../repositories/customer-vehicle.js";
import { getService, getServiceBySlug } from "../repositories/services.js";
import { EUROPEAN_SPEC_SERVICE_SLUG, resolveSwitchedServiceSlug } from "./european-services.js";
import { BookingConflictError, BookingValidationError, requireCustomerEmailForBooking } from "./booking-validation.js";

export { BookingConflictError, BookingValidationError } from "./booking-validation.js";

/**
 * European auto-switch (owner ruling, 2026-10-30): a job booked on a
 * regular oil-change service for a European vehicle is corrected to
 * the European-spec service BEFORE pricing, so the stored job records
 * the European service and the quote, the confirmation email, and the
 * Service Writer push all agree. Fail-safe: a job whose vehicle or
 * service cannot be resolved here — or any job, if the European
 * service row is missing/inactive — is left exactly as booked;
 * pricing surfaces real problems as quote_not_available, as before.
 */
async function resolveEffectiveJobs(
  customerId: string,
  jobs: Array<{ vehicleId: string; serviceId: string }>,
): Promise<Array<{ vehicleId: string; serviceId: string }>> {
  let europeanServiceId: string | null | undefined;
  return Promise.all(jobs.map(async (job) => {
    const [vehicle, service] = await Promise.all([
      findVehicleForCustomer(customerId, job.vehicleId),
      getService(job.serviceId),
    ]);
    if (!vehicle || !service) return job;
    if (resolveSwitchedServiceSlug(service.slug, vehicle.make) === service.slug) return job;
    if (europeanServiceId === undefined) {
      const european = await getServiceBySlug(EUROPEAN_SPEC_SERVICE_SLUG);
      europeanServiceId = european && european.active ? european.id : null;
    }
    return europeanServiceId ? { vehicleId: job.vehicleId, serviceId: europeanServiceId } : job;
  }));
}

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

  // Email gate first, before any pricing or slot work: no valid
  // customer email, no booking (see requireCustomerEmailForBooking).
  // A customer id that does not resolve has no email on file and is
  // rejected the same way.
  const customer = await getCustomer(input.customerId);
  requireCustomerEmailForBooking(customer?.email);

  // Offer rules come from the registry (domain/offers.ts). An unknown
  // code is rejected before any pricing work — a promised price never
  // silently becomes the standard price.
  const offer = input.offerCode ? getOffer(input.offerCode) : null;
  if (input.offerCode && !offer) throw new BookingValidationError("offer_not_recognized");

  // The European switch runs on the effective jobs: duplicates are
  // judged after correction (two different regular oil services for
  // one European vehicle correct to the same European job, which is a
  // duplicate), and pricing sees only the corrected services.
  const effectiveJobs = await resolveEffectiveJobs(input.customerId, input.jobs);

  const unique = new Set(effectiveJobs.map((job) => `${job.vehicleId}:${job.serviceId}`));
  if (unique.size !== effectiveJobs.length) throw new BookingValidationError("duplicate_booking_job");

  // Jobs are priced at standard rates first; the registry then confirms
  // what the offer code does to those quotes.
  const quotes = await Promise.all(effectiveJobs.map((job) => quoteService({
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
