import { getStripe } from "../integrations/stripe";

export type TaxAddress = {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
};

export async function calculateTax(input: {
  amountCents: number;
  reference: string;
  address: TaxAddress;
}) {
  const calculation = await getStripe().tax.calculations.create({
    currency: "usd",
    customer_details: {
      address: {
        line1: input.address.line1,
        line2: input.address.line2 ?? undefined,
        city: input.address.city,
        state: input.address.state,
        postal_code: input.address.postalCode,
        country: input.address.country ?? "US",
      },
      address_source: "shipping",
    },
    line_items: [
      {
        amount: input.amountCents,
        reference: input.reference,
      },
    ],
  });

  return {
    calculationId: calculation.id,
    subtotalCents: input.amountCents,
    taxCents: calculation.tax_amount_exclusive,
    totalCents: calculation.amount_total,
  };
}
