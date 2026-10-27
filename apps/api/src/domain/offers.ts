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
 * This module is intentionally free of repository/DB imports so the pure
 * pricing logic can be unit-tested in isolation.
 */

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
  processingFeePercent: number;
  processingFeeCents: number;
  processingFeeWaived: boolean;
  preTaxTotalCents: number;
  totalCents: number;
  offerCodeApplied: string | null;
  discountCents: number;
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
 * Rebuilds a quote around an effective base price, recalculating the
 * processing fee on the discounted subtotal — the same math the original
 * Facebook offers used (flat price replaces base before fee calculation).
 */
function repriceQuote<T extends OfferQuoteLike>(
  quote: T,
  effectiveBasePriceCents: number,
  feeWaivedByOffer: boolean,
  offerCodeApplied: string | null,
): T {
  const discountCents = quote.basePriceCents - effectiveBasePriceCents;
  const serviceSubtotalCents = effectiveBasePriceCents + quote.extraQuartChargeCents;
  const processingFeeWaived = feeWaivedByOffer || quote.processingFeeWaived;
  const processingFeeCents = processingFeeWaived
    ? 0
    : centsForPercent(serviceSubtotalCents, quote.processingFeePercent);
  const totalCents = serviceSubtotalCents + processingFeeCents;
  return {
    ...quote,
    basePriceCents: effectiveBasePriceCents,
    processingFeeCents,
    processingFeeWaived,
    preTaxTotalCents: totalCents,
    totalCents,
    offerCodeApplied,
    discountCents,
  };
}

/**
 * Applies a registered offer to standard-priced quotes.
 *
 * Discounts always reduce the job's effective base price (fee is then
 * recalculated on the discounted subtotal), so per-job `discountCents`
 * stays consistent with the PriceQuote shape: standard base minus
 * effective base. Eligible jobs report `offerCodeApplied` set to the
 * code — including jobs that receive no discount under first-job /
 * second-job / perk offers — so the promise is attached to every
 * eligible job in the booking. Ineligible jobs (standard base price
 * other than 11900) are returned unchanged with `offerCodeApplied: null`
 * in provisional mode, and reject the whole call in booking mode.
 */
export function applyOffer<T extends OfferQuoteLike>(
  quotes: readonly T[],
  code: string | null | undefined,
  opts: ApplyOfferOptions = {},
): ApplyOfferResult<T> {
  const offer = getOffer(code);
  if (!offer) throw new OfferError("offer_not_recognized");

  const strict = (opts.mode ?? "booking") === "booking";

  if (strict) {
    if (offer.scope === "single_job" && quotes.length !== 1) {
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

  const eligible = quotes.map((quote) => quote.basePriceCents === OFFER_ANCHOR_BASE_PRICE_CENTS);
  if (strict && eligible.some((isEligible) => !isEligible)) {
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
  const updatedQuotes = quotes.map((quote, index) => {
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
    offerCodeApplied: appliedToAnyJob ? offer.code : null,
    totalDiscountCents,
    offerNote,
  };
}
