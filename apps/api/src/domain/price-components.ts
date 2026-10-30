/**
 * The per-job price build (owner ruling, 2026-10-30): every job is priced
 * per vehicle / per service the way Service Writer prices natively —
 * subtotal + waste oil fee + card processing fee + tax.
 *
 *   processing = processingFeePercent x (subtotal + waste fee), 0 if waived
 *   tax        = taxRatePercent x subtotal
 *   preTaxTotal = subtotal + waste + processing  (the total before tax)
 *   total       = preTaxTotal + tax
 *
 * Pure and DB-free (like offers.ts) so the math can be unit-tested in
 * isolation. Used by pricing.ts for standard quotes; offers.ts mirrors
 * this formula inline in repriceQuote (it must stay import-free for
 * direct unit testing) — keep the two in sync.
 */

export function centsForPercent(amountCents: number, percent: number) {
  return Math.round(amountCents * (percent / 100));
}

export function calculatePriceComponents(input: {
  serviceSubtotalCents: number;
  wasteFeeCents: number;
  processingFeePercent: number;
  processingFeeWaived: boolean;
  taxRatePercent: number;
}) {
  const processingFeeCents = input.processingFeeWaived
    ? 0
    : centsForPercent(input.serviceSubtotalCents + input.wasteFeeCents, input.processingFeePercent);
  const taxCents = centsForPercent(input.serviceSubtotalCents, input.taxRatePercent);
  const preTaxTotalCents = input.serviceSubtotalCents + input.wasteFeeCents + processingFeeCents;
  const totalCents = preTaxTotalCents + taxCents;
  return { processingFeeCents, taxCents, preTaxTotalCents, totalCents };
}
