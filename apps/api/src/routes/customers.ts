import { Hono } from "hono";
import { z } from "zod";
import {
  createCustomer,
  createVehicle,
  findCustomer,
  getCustomer,
  listCustomerVehicles,
} from "../repositories/customer-vehicle.js";

const customerInput = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(254).optional().nullable(),
  addressLine1: z.string().trim().max(200).optional().nullable(),
  addressLine2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  state: z.string().trim().max(50).optional().nullable(),
  postalCode: z.string().trim().max(20).optional().nullable(),
  marketingConsent: z.boolean().optional(),
});

const vehicleInput = z.object({
  vin: z.string().trim().length(17).toUpperCase().optional().nullable(),
  year: z.number().int().min(1886).max(new Date().getFullYear() + 2),
  make: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(100),
  trim: z.string().trim().max(100).optional().nullable(),
  engine: z.string().trim().max(100).optional().nullable(),
  oilType: z.string().trim().max(100).optional().nullable(),
  oilCapacityQuarts: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const customerRoutes = new Hono();

customerRoutes.post("/", async (c) => {
  const parsed = customerInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_customer", issues: parsed.error.issues }, 400);

  const existing = await findCustomer({ phone: parsed.data.phone, email: parsed.data.email ?? undefined });
  if (existing) return c.json({ error: "customer_exists", customerId: existing.id }, 409);

  return c.json({ customer: await createCustomer(parsed.data) }, 201);
});

customerRoutes.get("/:customerId", async (c) => {
  const customer = await getCustomer(c.req.param("customerId"));
  return customer ? c.json({ customer }) : c.json({ error: "customer_not_found" }, 404);
});

customerRoutes.get("/:customerId/vehicles", async (c) => {
  const customerId = c.req.param("customerId");
  if (!(await getCustomer(customerId))) return c.json({ error: "customer_not_found" }, 404);
  return c.json({ vehicles: await listCustomerVehicles(customerId) });
});

customerRoutes.post("/:customerId/vehicles", async (c) => {
  const customerId = c.req.param("customerId");
  if (!(await getCustomer(customerId))) return c.json({ error: "customer_not_found" }, 404);

  const parsed = vehicleInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_vehicle", issues: parsed.error.issues }, 400);

  return c.json({ vehicle: await createVehicle({ customerId, ...parsed.data }) }, 201);
});
