import { Hono } from "hono";
import { z } from "zod";
import { decodeVin, listMakes, listModels } from "../integrations/nhtsa";

export const vehicleRoutes = new Hono();

vehicleRoutes.get("/years", (c) => {
  const current = new Date().getFullYear();
  const years = Array.from({ length: current + 2 - 1980 + 1 }, (_, index) => current + 2 - index);
  return c.json({ years });
});

vehicleRoutes.get("/makes", async (c) => {
  try {
    return c.json({ makes: await listMakes() });
  } catch (error) {
    console.error("Vehicle make lookup failed", error);
    return c.json({ error: "vehicle_provider_unavailable" }, 503);
  }
});

vehicleRoutes.get("/models", async (c) => {
  const parsed = z.object({
    make: z.string().trim().min(1).max(100),
    year: z.coerce.number().int().min(1980).max(new Date().getFullYear() + 2),
  }).safeParse(c.req.query());

  if (!parsed.success) return c.json({ error: "invalid_vehicle_lookup", issues: parsed.error.issues }, 400);

  try {
    return c.json({ models: await listModels(parsed.data.make, parsed.data.year) });
  } catch (error) {
    console.error("Vehicle model lookup failed", error);
    return c.json({ error: "vehicle_provider_unavailable" }, 503);
  }
});

vehicleRoutes.post("/decode-vin", async (c) => {
  const parsed = z.object({ vin: z.string().trim().length(17).toUpperCase() })
    .safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) return c.json({ error: "invalid_vin", issues: parsed.error.issues }, 400);

  try {
    const vehicle = await decodeVin(parsed.data.vin);
    return vehicle
      ? c.json({ vehicle })
      : c.json({ error: "vin_not_decoded" }, 422);
  } catch (error) {
    console.error("VIN decode failed", error);
    return c.json({ error: "vehicle_provider_unavailable" }, 503);
  }
});
