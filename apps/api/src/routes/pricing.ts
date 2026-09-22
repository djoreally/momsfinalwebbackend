import { Hono } from "hono";
import { z } from "zod";
import { previewServicePrice, quoteService } from "../domain/pricing.js";

const quoteInput = z.object({
  customerId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  serviceId: z.string().uuid(),
});

export const pricingRoutes = new Hono();

pricingRoutes.post("/quote", async (c) => {
  const parsed = quoteInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_quote_request", issues: parsed.error.issues }, 400);
  }

  const quote = await quoteService(parsed.data);
  if (!quote) return c.json({ error: "quote_not_available" }, 404);

  return c.json({ quote });
});


const previewInput = z.object({
  serviceId: z.string().uuid(),
  oilCapacityQuarts: z.number().positive().max(30).optional().nullable(),
});

pricingRoutes.post("/preview", async (c) => {
  const parsed = previewInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_price_preview", issues: parsed.error.issues }, 400);
  }

  const quote = await previewServicePrice(parsed.data);
  if (!quote) return c.json({ error: "quote_not_available" }, 404);
  return c.json({ quote });
});
