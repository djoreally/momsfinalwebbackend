import { Hono } from "hono";
import { z } from "zod";
import { previewServicePrice, quoteService } from "../domain/pricing.js";
import { getOffer, OfferError } from "../domain/offers.js";

// Offer codes are validated against the registry (domain/offers.ts), not
// a fixed enum: any registered code is accepted, anything else is
// rejected with offer_not_recognized.
const offerCodeInput = z.string().trim().min(1).max(64).optional().nullable();

const quoteInput = z.object({
  customerId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  serviceId: z.string().uuid(),
  offerCode: offerCodeInput,
});

export const pricingRoutes = new Hono();

pricingRoutes.post("/quote", async (c) => {
  const parsed = quoteInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_quote_request", issues: parsed.error.issues }, 400);
  }
  if (parsed.data.offerCode && !getOffer(parsed.data.offerCode)) {
    return c.json({ error: "offer_not_recognized" }, 400);
  }

  try {
    const quote = await quoteService(parsed.data);
    if (!quote) return c.json({ error: "quote_not_available" }, 404);
    return c.json({ quote });
  } catch (error) {
    if (error instanceof OfferError) return c.json({ error: error.code }, 400);
    throw error;
  }
});


const previewInput = z.object({
  serviceId: z.string().uuid(),
  oilCapacityQuarts: z.number().positive().max(30).optional().nullable(),
  offerCode: offerCodeInput,
});

pricingRoutes.post("/preview", async (c) => {
  const parsed = previewInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_price_preview", issues: parsed.error.issues }, 400);
  }
  if (parsed.data.offerCode && !getOffer(parsed.data.offerCode)) {
    return c.json({ error: "offer_not_recognized" }, 400);
  }

  try {
    const quote = await previewServicePrice(parsed.data);
    if (!quote) return c.json({ error: "quote_not_available" }, 404);
    return c.json({ quote });
  } catch (error) {
    if (error instanceof OfferError) return c.json({ error: error.code }, 400);
    throw error;
  }
});
