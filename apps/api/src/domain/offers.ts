/**
 * Offer registry — the single source of truth for every advertised price
 * promise (ads, landing pages, coupons, mailers, partner pages).
 *
 * Config-as-code: this registry is the law. The frontend never invents a
 * price; it sends a code, and `applyOffer` confirms what that code does to
 * server-computed quotes. A code that is not in this registry is rejected
 * with `offer_not_recognized` — a promised price never silently becomes
 * the standard price.
 *
 * Eligibility (anchor rule, carried over from the original Facebook
 * offers): every registered offer requires the $119 standard
 * full-synthetic service, i.e. a job whose standard base price is
 * 11900 cents. An offer attached to a non-eligible job does not apply.
 *
 * Two per-job carve-outs sit on top of the anchor rule (owner
 * rulings, 2026-10-30), both marked on the quote by the pricing seam:
 *   - Deal-excluded jobs (`offerExcluded`: the vehicle's specified
 *     oil grade is 0W-16, 0W-8, or 0W-30 — see
 *     domain/deal-exclusions.ts) are outside every deal. They are
 *     returned unchanged and NEVER fail the booking.
 *   - European-spec jobs (`europeanSpec`) are never blocked either:
 *     instead of the offer's own discount they receive the $10
 *     European adjustment (EUROPEAN_ADJUSTMENT_CENTS below), and the
 *     customer is advised (see bookings.ts / booking-email.ts). A
 *     European job takes precedence over a grade exclusion on the
 *     same job.
 * A job that is neither excluded nor European and still not
 * anchor-eligible (e.g. Mobil 1 at its $129 base) keeps the original
 * behavior: skipped in provisional mode, `offer_not_applicable` in
 * booking mode.
 *
 * This module is intentionally free of repository/DB imports so the pure
 * pricing logic can be unit-tested in isolation.
 */

/**
 * The European deal adjustment: $10 off a European-spec job when an
 * offer is in play (see the header). Mirrored in
 * domain/european-services.ts (the advisory wording lives there);
 * the unit tests pin both copies and the applied behavior to 1000.
 * This module stays import-free by design, hence the mirror — the
 * same pattern price-components.ts documents for the pricing math.
 */
const EUROPEAN_ADJUSTMENT_CENTS = 1000;

export const SOCIAL99_OFFER_CODE = "SOCIAL99" as const;
export const SOCIAL89_OFFER_CODE = "SOCIAL89" as const;
export const WIPERS119_OFFER_CODE = "WIPERS119" as const;

/** The original Facebook offer codes, kept for existing importers. */
export const FACEBOOK_OFFER_CODES = [
  SOCIAL99_OFFER_CODE,
  SOCIAL89_OFFER_CODE,
  WIPERS119_OFFER_CODE,
] as const;
export type FacebookOfferCode = (typeof FACEBOOK_OFFER_CODES)[number];

/** Standard base price (cents) an oil-change job must have for any offer to apply. */
export const OFFER_ANCHOR_BASE_PRICE_CENTS = 11900;

export type OfferKind =
  | "flat_price"
  | "amount_off_first_job"
  | "amount_off_each_job"
  | "amount_off_each_job_min_jobs"
  | "amount_off_second_job"
  | "perk_only";

export type OfferScope =
  | "single_job"
  | "first_job"
  | "each_job"
  | "second_job"
  | "booking";

export interface OfferDefinition {
  code: string;
  kind: OfferKind;
  /** Discount per targeted job, for amount_off_* kinds. */
  amountCents?: number;
  /** Replacement base price, for flat_price. */
  flatPriceCents?: number;
  /** When true, the processing fee is waived on discounted jobs. */
  feeWaived: boolean;
  scope: OfferScope;
  /** Minimum number of jobs in the booking, enforced at booking. */
  minJobs?: number;
  /** Required weekday (0 = Sunday … 6 = Saturday) in America/New_York, enforced at booking. */
  weekday?: number;
  /** Customer-visible perk granted by perk_only offers. */
  perkLabel?: string;
  /** Customer-facing explanation of the confirmed offer. */
  note: string;
}

const WEEKDAY_TUESDAY = 2;
const WEEKDAY_WEDNESDAY = 3;
const WEEKDAY_THURSDAY = 4;
const WEEKDAY_SATURDAY = 6;

export const OFFER_REGISTRY: Readonly<Record<string, OfferDefinition>> = {
  // --- Flat prices (Facebook) -------------------------------------------------
  // Flat price replaces the base price before the processing fee is
  // calculated; the fee is waived. Single job only (legacy rule kept).
  SOCIAL99: {
    code: "SOCIAL99",
    kind: "flat_price",
    flatPriceCents: 9900,
    feeWaived: true,
    scope: "single_job",
    note: "$99 offer price locked. Processing fee waived.",
  },
  SOCIAL89: {
    code: "SOCIAL89",
    kind: "flat_price",
    flatPriceCents: 8900,
    feeWaived: true,
    scope: "single_job",
    note: "$89 offer price locked. Processing fee waived.",
  },

  // --- Amount off the first job ----------------------------------------------
  FIRST20: {
    code: "FIRST20",
    kind: "amount_off_first_job",
    amountCents: 2000,
    feeWaived: false,
    scope: "first_job",
    note: "$20 off your first oil change.",
  },
  "WIS-TEACHER-15": {
    code: "WIS-TEACHER-15",
    kind: "amount_off_first_job",
    amountCents: 1500,
    feeWaived: false,
    scope: "first_job",
    note: "Wissahickon teacher offer: $15 off your first oil change.",
  },
  "WIS-STAFF-15": {
    code: "WIS-STAFF-15",
    kind: "amount_off_first_job",
    amountCents: 1500,
    feeWaived: false,
    scope: "first_job",
    note: "Wissahickon staff offer: $15 off your first oil change.",
  },
  "WIS-STUDENT-10": {
    code: "WIS-STUDENT-10",
    kind: "amount_off_first_job",
    amountCents: 1000,
    feeWaived: false,
    scope: "first_job",
    note: "Wissahickon student offer: $10 off your first oil change.",
  },
  "WIS-STUDENT-FIRST": {
    code: "WIS-STUDENT-FIRST",
    kind: "amount_off_first_job",
    amountCents: 1000,
    feeWaived: false,
    scope: "first_job",
    note: "Wissahickon student offer: $10 off your first oil change.",
  },
  "WIS-PARENT-10": {
    code: "WIS-PARENT-10",
    kind: "amount_off_first_job",
    amountCents: 1000,
    feeWaived: false,
    scope: "first_job",
    note: "Wissahickon parent offer: $10 off your first oil change.",
  },
  "WIS-GAMEDAY-1": {
    code: "WIS-GAMEDAY-1",
    kind: "amount_off_first_job",
    amountCents: 1000,
    feeWaived: false,
    scope: "first_job",
    note: "Wissahickon game day offer: $10 off your first oil change.",
  },

  // --- Amount off each job, weekday-locked (coupons page) ---------------------
  TUESDAY15: {
    code: "TUESDAY15",
    kind: "amount_off_each_job",
    amountCents: 1500,
    feeWaived: false,
    scope: "each_job",
    weekday: WEEKDAY_TUESDAY,
    note: "Tuesday special: $15 off each oil change.",
  },
  WORKWED10: {
    code: "WORKWED10",
    kind: "amount_off_each_job",
    amountCents: 1000,
    feeWaived: false,
    scope: "each_job",
    weekday: WEEKDAY_WEDNESDAY,
    note: "Wednesday special: $10 off each oil change.",
  },
  SATURDAY10: {
    code: "SATURDAY10",
    kind: "amount_off_each_job",
    amountCents: 1000,
    feeWaived: false,
    scope: "each_job",
    weekday: WEEKDAY_SATURDAY,
    note: "Saturday special: $10 off each oil change.",
  },
  FLEETTHU10: {
    code: "FLEETTHU10",
    kind: "amount_off_each_job",
    amountCents: 1000,
    feeWaived: false,
    scope: "each_job",
    weekday: WEEKDAY_THURSDAY,
    note: "Thursday fleet special: $10 off each oil change.",
  },

  // --- Amount off each job, minimum job count ---------------------------------
  "WIS-GAMEDAY-2PLUS": {
    code: "WIS-GAMEDAY-2PLUS",
    kind: "amount_off_each_job_min_jobs",
    amountCents: 1500,
    feeWaived: false,
    scope: "each_job",
    minJobs: 2,
    note: "Wissahickon game day group offer: $15 off each oil change (2+ vehicles).",
  },
  "WIS-STAFF-GROUP": {
    code: "WIS-STAFF-GROUP",
    kind: "amount_off_each_job_min_jobs",
    amountCents: 1500,
    feeWaived: false,
    scope: "each_job",
    minJobs: 3,
    note: "Wissahickon staff group offer: $15 off each oil change (3+ vehicles).",
  },

  // --- Amount off the second job ----------------------------------------------
  // 2000 off the cheapest job after the first; requires 2+ jobs.
  TWOCAR20: {
    code: "TWOCAR20",
    kind: "amount_off_second_job",
    amountCents: 2000,
    feeWaived: false,
    scope: "second_job",
    minJobs: 2,
    note: "Two-car offer: $20 off the second vehicle.",
  },
  "WIS-TEACHER-2CAR": {
    code: "WIS-TEACHER-2CAR",
    kind: "amount_off_second_job",
    amountCents: 2000,
    feeWaived: false,
    scope: "second_job",
    minJobs: 2,
    note: "Wissahickon teacher two-car offer: $20 off the second vehicle.",
  },
  "WIS-PARENT-2CAR": {
    code: "WIS-PARENT-2CAR",
    kind: "amount_off_second_job",
    amountCents: 2000,
    feeWaived: false,
    scope: "second_job",
    minJobs: 2,
    note: "Wissahickon parent two-car offer: $20 off the second vehicle.",
  },

  // --- Perks (price unchanged; the promise is attached to the booking) ---------
  WIPERS119: {
    code: "WIPERS119",
    kind: "perk_only",
    feeWaived: false,
    scope: "single_job",
    perkLabel: "Free wiper blades",
    note: "$119 price with free wiper blades at your appointment.",
  },
  "WIS-TEACHER-FILTER": {
    code: "WIS-TEACHER-FILTER",
    kind: "perk_only",
    feeWaived: false,
    scope: "booking",
    perkLabel: "$10 off a filter add-on",
    note: "Wissahickon teacher offer: $10 off an eligible engine or cabin air filter added to your oil change.",
  },
  "WIS-STUDENT-WIPERS": {
    code: "WIS-STUDENT-WIPERS",
    kind: "perk_only",
    feeWaived: false,
    scope: "booking",
    perkLabel: "$10 off wiper blades",
    note: "Wissahickon student offer: $10 off an eligible pair of replacement wipers added to your oil change.",
  },
  "WIS-PARENT-CABIN": {
    code: "WIS-PARENT-CABIN",
    kind: "perk_only",
    feeWaived: false,
    scope: "booking",
    perkLabel: "$10 off a cabin air filter",
    note: "Wissahickon parent offer: $10 off an eligible cabin air filter added to your oil change.",
  },
  "WIS-STAFF-FILTER": {
    code: "WIS-STAFF-FILTER",
    kind: "perk_only",
    feeWaived: false,
    scope: "booking",
    perkLabel: "$10 off a filter add-on",
    note: "Wissahickon staff offer: $10 off an eligible engine or cabin air filter added to your oil change.",
  },
  ROADTRIP: {
    code: "ROADTRIP",
    kind: "perk_only",
    feeWaived: false,
    scope: "booking",
    perkLabel: "Free 21-point inspection",
    note: "Free 21-point inspection with your oil change.",
  },
};

export const OFFER_CODES: readonly string[] = Object.keys(OFFER_REGISTRY);

/**
 * Distinct failure for offer handling. `code` is the machine-readable
 * reason (e.g. "offer_not_recognized") and is also the message, matching
 * the BookingValidationError convention of carrying the error string.
 */
export class OfferError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "OfferError";
    this.code = code;
  }
}

export function normalizeOfferCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Registry lookup. Returns null for any code that is not registered. */
export function getOffer(code: string | null | undefined): OfferDefinition | null {
  if (!code) return null;
  return OFFER_REGISTRY[normalizeOfferCode(code)] ?? null;
}

export function isOfferCode(code: string | null | undefined): boolean {
  return getOffer(code) !== null;
}

const NEW_YORK_WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
});
const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Weekday (0 = Sunday … 6 = Saturday) of an instant in America/New_York. */
export function weekdayInNewYork(date: Date): number {
  return WEEKDAY_INDEX[NEW_YORK_WEEKDAY_FORMAT.format(date)] ?? -1;
}

/**
 * The minimal quote shape `applyOffer` reads and rewrites. Matches the
 * pricing domain's PriceQuote fields; extra fields are carried through
 * untouched.
 */
export interface OfferQuoteLike {
  basePriceCents: number;
  extraQuartChargeCents: number;
  /** Effective service subtotal (base + extra quarts, after discounts). */
  serviceSubtotalCents?: number;
  /** Per-job waste oil fee; fixed per service, never discounted. */
  wasteFeeCents?: number;
  processingFeePercent: number;
  processingFeeCents: number;
  processingFeeWaived: boolean;
  /** Per-service tax rate in percent, applied to the subtotal. */
  taxRatePercent?: number;
  taxCents?: number;
  preTaxTotalCents: number;
  totalCents: number;
  offerCodeApplied: string | null;
  discountCents: number;
  /**
   * Deal exclusion (oil grade 0W-16 / 0W-8 / 0W-30): the job is
   * outside every deal — returned unchanged, never fails the booking.
   * Set by the pricing seam, which resolves the vehicle's grade.
   */
  offerExcluded?: boolean;
  /**
   * The job's service is the European-spec oil change: with an offer
   * in play it receives the European adjustment instead of the offer's
   * discount (and instead of any grade exclusion on the same job).
   */
  europeanSpec?: boolean;
  /** European adjustment actually applied to this quote, in cents. */
  europeanAdjustmentCents?: number;
}

export interface ApplyOfferOptions {
  /** Appointment start; required to enforce weekday rules in booking mode. */
  scheduledStart?: Date | string | null;
  /**
   * "booking" (default): weekday, min-jobs, single-job and eligibility
   * rules are enforced — violations throw OfferError.
   * "provisional": used by price previews and single quotes, which cannot
   * yet know the final job list or (always) the appointment day. The price
   * math is applied as if the rules will pass, and the note states that
   * final eligibility is confirmed at booking. Unknown codes throw in
   * both modes.
   */
  mode?: "booking" | "provisional";
}

export interface ApplyOfferResult<T extends OfferQuoteLike> {
  quotes: T[];
  offer: OfferDefinition;
  /** The confirmed code, or null if no job was eligible (provisional mode only). */
  offerCodeApplied: string | null;
  totalDiscountCents: number;
  offerNote: string | null;
}



function centsForPercent(amountCents: number, percent: number) {
  return Math.round(amountCents * (percent / 100));
}

/**
 * Rebuilds a quote around an effective base price, recalculating every
 * price component on the discounted subtotal — the same per-job build
 * the standard quote uses (calculatePriceComponents in
 * price-components.ts; the formula is mirrored here because this module
 * must stay import-free for direct unit testing — keep the two in sync):
 * the waste oil fee is per vehicle/service and never discounted, the
 * processing fee is recalculated on (subtotal + waste fee) unless
 * waived, and tax is recalculated on the discounted subtotal. A flat
 * price replaces the base price before the components are calculated,
 * exactly as the original Facebook offers worked.
 *
 * Component fields are optional on OfferQuoteLike so quotes built
 * without them (older callers/fixtures) reprice with 0 waste / 0 tax.
 */
function repriceQuote<T extends OfferQuoteLike>(
  quote: T,
  effectiveBasePriceCents: number,
  feeWaivedByOffer: boolean,
  offerCodeApplied: string | null,
): T {
  const discountCents = quote.basePriceCents - effectiveBasePriceCents;
  const serviceSubtotalCents = effectiveBasePriceCents + quote.extraQuartChargeCents;
  const wasteFeeCents = quote.wasteFeeCents ?? 0;
  const taxRatePercent = quote.taxRatePercent ?? 0;
  const processingFeeWaived = feeWaivedByOffer || quote.processingFeeWaived;
  const processingFeeCents = processingFeeWaived
    ? 0
    : centsForPercent(serviceSubtotalCents + wasteFeeCents, quote.processingFeePercent);
  const taxCents = centsForPercent(serviceSubtotalCents, taxRatePercent);
  const preTaxTotalCents = serviceSubtotalCents + wasteFeeCents + processingFeeCents;
  const totalCents = preTaxTotalCents + taxCents;
  return {
    ...quote,
    basePriceCents: effectiveBasePriceCents,
    serviceSubtotalCents,
    wasteFeeCents,
    processingFeeCents,
    processingFeeWaived,
    taxRatePercent,
    taxCents,
    preTaxTotalCents,
    totalCents,
    offerCodeApplied,
    discountCents,
  };
}

/**
 * Applies a registered offer to standard-priced quotes.
 *
 * Discounts always reduce the job's effective base price (the waste fee,
 * processing fee and tax are then recalculated around the discounted
 * subtotal), so per-job `discountCents`
 * stays consistent with the PriceQuote shape: standard base minus
 * effective base. Eligible jobs report `offerCodeApplied` set to the
 * code — including jobs that receive no discount under first-job /
 * second-job / perk offers — so the promise is attached to every
 * eligible job in the booking. Ineligible jobs (standard base price
 * other than 11900) are returned unchanged with `offerCodeApplied: null`
 * in provisional mode, and reject the whole call in booking mode —
 * EXCEPT the two carve-outs from the header: deal-excluded jobs and
 * European-spec jobs are outside the offer's own world. They never
 * reject the call and never count toward the single-job scope;
 * excluded jobs come back unchanged, and European jobs come back with
 * the $10 European adjustment applied (their `discountCents` and
 * `europeanAdjustmentCents` both record it) — "don't block Euro
 * booking, adjust them with $10 off and advise" (owner, 2026-10-30).
 */
export function applyOffer<T extends OfferQuoteLike>(
  quotes: readonly T[],
  code: string | null | undefined,
  opts: ApplyOfferOptions = {},
): ApplyOfferResult<T> {
  const offer = getOffer(code);
  if (!offer) throw new OfferError("offer_not_recognized");

  const strict = (opts.mode ?? "booking") === "booking";

  // The offer's own world: jobs it can discount, scope, or reject.
  // Excluded and European jobs are handled by their own rules below
  // and are invisible to these checks.
  const excluded = quotes.map((quote) => quote.offerExcluded === true);
  const european = quotes.map((quote) => quote.europeanSpec === true);
  const inOfferWorld = quotes.map((_, index) => !excluded[index] && !european[index]);

  if (strict) {
    if (offer.scope === "single_job" && inOfferWorld.filter(Boolean).length > 1) {
      throw new OfferError("offer_single_job_only");
    }
    if (offer.minJobs !== undefined && quotes.length < offer.minJobs) {
      throw new OfferError("offer_min_jobs_not_met");
    }
    if (offer.weekday !== undefined) {
      const scheduledStart = opts.scheduledStart ? new Date(opts.scheduledStart) : null;
      if (!scheduledStart || weekdayInNewYork(scheduledStart) !== offer.weekday) {
        throw new OfferError("offer_weekday_mismatch");
      }
    }
  }

  const eligible = quotes.map(
    (quote, index) => inOfferWorld[index] && quote.basePriceCents === OFFER_ANCHOR_BASE_PRICE_CENTS,
  );
  if (strict && quotes.some((_, index) => inOfferWorld[index] && !eligible[index])) {
    throw new OfferError("offer_not_applicable");
  }

  // Which jobs receive a price change, per kind.
  const discountByIndex = new Map<number, number>();
  const flatByIndex = new Map<number, number>();
  switch (offer.kind) {
    case "flat_price": {
      const flatPriceCents = offer.flatPriceCents ?? 0;
      quotes.forEach((_, index) => {
        if (eligible[index]) flatByIndex.set(index, flatPriceCents);
      });
      break;
    }
    case "amount_off_first_job": {
      if (quotes.length > 0 && eligible[0]) discountByIndex.set(0, offer.amountCents ?? 0);
      break;
    }
    case "amount_off_each_job":
    case "amount_off_each_job_min_jobs": {
      quotes.forEach((_, index) => {
        if (eligible[index]) discountByIndex.set(index, offer.amountCents ?? 0);
      });
      break;
    }
    case "amount_off_second_job": {
      // 2000 off the cheapest job after the first (by pre-offer total).
      let cheapestIndex = -1;
      for (let index = 1; index < quotes.length; index += 1) {
        if (!eligible[index]) continue;
        if (cheapestIndex === -1 || quotes[index].totalCents < quotes[cheapestIndex].totalCents) {
          cheapestIndex = index;
        }
      }
      if (cheapestIndex !== -1) discountByIndex.set(cheapestIndex, offer.amountCents ?? 0);
      break;
    }
    case "perk_only": {
      break;
    }
  }

  let totalDiscountCents = 0;
  let appliedToAnyJob = false;
  let adjustedAnyEuropeanJob = false;
  const updatedQuotes = quotes.map((quote, index) => {
    if (european[index]) {
      // European adjustment: $10 off the job's effective base price
      // (components recompute on the adjusted subtotal), recorded as
      // the job's discount and flagged via europeanAdjustmentCents so
      // the confirmation can advise the customer. The offer's fee
      // waiver does NOT ride along — only the $10 comes off.
      adjustedAnyEuropeanJob = true;
      const effectiveBasePriceCents = Math.max(0, quote.basePriceCents - EUROPEAN_ADJUSTMENT_CENTS);
      const updated = repriceQuote(
        { ...quote, europeanAdjustmentCents: EUROPEAN_ADJUSTMENT_CENTS },
        effectiveBasePriceCents,
        false,
        offer.code,
      );
      totalDiscountCents += updated.discountCents;
      return updated;
    }
    if (!eligible[index]) return quote;
    appliedToAnyJob = true;
    if (flatByIndex.has(index)) {
      const updated = repriceQuote(quote, flatByIndex.get(index) ?? quote.basePriceCents, offer.feeWaived, offer.code);
      totalDiscountCents += updated.discountCents;
      return updated;
    }
    if (discountByIndex.has(index)) {
      const effectiveBasePriceCents = Math.max(0, quote.basePriceCents - (discountByIndex.get(index) ?? 0));
      const updated = repriceQuote(quote, effectiveBasePriceCents, offer.feeWaived, offer.code);
      totalDiscountCents += updated.discountCents;
      return updated;
    }
    // Eligible but not a discount target (first-job/second-job/perk
    // offers): price is unchanged, the code is attached.
    return repriceQuote(quote, quote.basePriceCents, offer.feeWaived, offer.code);
  });

  let offerNote: string | null = null;
  if (appliedToAnyJob) {
    offerNote = offer.note;
    const needsBookingConfirmation =
      offer.weekday !== undefined || offer.minJobs !== undefined || offer.scope === "single_job";
    if (!strict && needsBookingConfirmation) {
      offerNote += " Final eligibility is confirmed at booking.";
    }
  }

  return {
    quotes: updatedQuotes,
    offer,
    // A booking whose only deal effect is European adjustments still
    // had the offer in play — the code is what triggered them — but
    // the offer's own note does not describe that treatment, so it is
    // only attached when the offer itself touched a job (the European
    // advisory carries the wording for adjusted jobs).
    offerCodeApplied: appliedToAnyJob || adjustedAnyEuropeanJob ? offer.code : null,
    totalDiscountCents,
    offerNote,
  };
}
