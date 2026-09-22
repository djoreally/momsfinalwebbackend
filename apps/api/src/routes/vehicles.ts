import { Hono } from "hono";
import { z } from "zod";
import { decodeVin } from "../integrations/nhtsa.js";
import { listSpecYears, listSpecMakes, listSpecModels, listSpecEngines, resolveVehicleSpec } from "../repositories/vehicle-specs.js";

export const vehicleRoutes = new Hono();
const yearSchema = z.coerce.number().int().min(1999).max(2027);

function normalizeOilCapacityQuarts(value: string | null): number | null {
  if (!value) return null;
  const match = value.trim().match(/(\d+(?:\.\d+)?)\s*(liters?|litres?|l|quarts?|qts?)/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2].toLowerCase();
  const quarts = unit.startsWith("l") ? amount * 1.05668821 : amount;
  return Math.round(quarts * 100) / 100;
}

function toBookingVehicleSpec(spec: Awaited<ReturnType<typeof resolveVehicleSpec>>) {
  if (!spec) return null;
  return {
    year: spec.year,
    make: spec.make,
    model: spec.model,
    engine: spec.engine,
    oilCapacityQuarts: normalizeOilCapacityQuarts(spec.oilCapacity),
    hasOilSpecification: Boolean(spec.engineOil?.trim()),
  };
}

vehicleRoutes.get("/years", async (c) => {
  try { return c.json({ years: await listSpecYears() }); }
  catch (error) { console.error("Vehicle year lookup failed", error); return c.json({ error: "vehicle_specs_unavailable" }, 503); }
});

vehicleRoutes.get("/makes", async (c) => {
  const parsed = z.object({ year: yearSchema }).safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "invalid_vehicle_lookup", issues: parsed.error.issues }, 400);
  try { return c.json({ makes: await listSpecMakes(parsed.data.year) }); }
  catch (error) { console.error("Vehicle make lookup failed", error); return c.json({ error: "vehicle_specs_unavailable" }, 503); }
});

vehicleRoutes.get("/models", async (c) => {
  const parsed = z.object({ year: yearSchema, make: z.string().trim().min(1).max(100) }).safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "invalid_vehicle_lookup", issues: parsed.error.issues }, 400);
  try { return c.json({ models: await listSpecModels(parsed.data.year, parsed.data.make) }); }
  catch (error) { console.error("Vehicle model lookup failed", error); return c.json({ error: "vehicle_specs_unavailable" }, 503); }
});

vehicleRoutes.get("/engines", async (c) => {
  const parsed = z.object({ year: yearSchema, make: z.string().trim().min(1).max(100), model: z.string().trim().min(1).max(150) }).safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "invalid_vehicle_lookup", issues: parsed.error.issues }, 400);
  try { return c.json({ engines: await listSpecEngines(parsed.data.year, parsed.data.make, parsed.data.model) }); }
  catch (error) { console.error("Vehicle engine lookup failed", error); return c.json({ error: "vehicle_specs_unavailable" }, 503); }
});

vehicleRoutes.get("/spec", async (c) => {
  const parsed = z.object({ year: yearSchema, make: z.string().trim().min(1).max(100), model: z.string().trim().min(1).max(150), engine: z.string().trim().min(1).max(200) }).safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "invalid_vehicle_lookup", issues: parsed.error.issues }, 400);
  try {
    const spec = await resolveVehicleSpec(parsed.data.year, parsed.data.make, parsed.data.model, parsed.data.engine);
    return spec ? c.json({ spec: toBookingVehicleSpec(spec) }) : c.json({ error: "vehicle_spec_not_found" }, 404);
  } catch (error) { console.error("Vehicle spec lookup failed", error); return c.json({ error: "vehicle_specs_unavailable" }, 503); }
});

vehicleRoutes.post("/decode-vin", async (c) => {
  const parsed = z.object({ vin: z.string().trim().length(17).toUpperCase() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_vin", issues: parsed.error.issues }, 400);
  try {
    const vehicle = await decodeVin(parsed.data.vin);
    return vehicle ? c.json({ vehicle }) : c.json({ error: "vin_not_decoded" }, 422);
  } catch (error) { console.error("VIN decode failed", error); return c.json({ error: "vehicle_provider_unavailable" }, 503); }
});
