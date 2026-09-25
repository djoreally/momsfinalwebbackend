import { Hono } from "hono";
import { z } from "zod";
import { getSql } from "../../../../packages/db/src/index.js";
import { requireAdminSession } from "../middleware/admin-session.js";

export const settingsRoutes = new Hono();
settingsRoutes.use("*", requireAdminSession);

const businessSettings = z.object({
  businessName: z.string().trim().min(1).max(120),
  publicPhone: z.string().trim().max(40),
  publicEmail: z.string().trim().email().or(z.literal("")),
  timezone: z.string().trim().min(1).max(80),
  addressLine1: z.string().trim().max(200),
  addressLine2: z.string().trim().max(200),
  city: z.string().trim().max(100),
  state: z.string().trim().max(50),
  postalCode: z.string().trim().max(20),
}).strict();

settingsRoutes.get("/business", async (c) => {
  const sql = getSql();
  const rows = await sql("SELECT value, updated_at FROM moms_ops.operational_settings WHERE key='business' LIMIT 1");
  const row = rows[0];
  return c.json({ settings: row?.value ?? null, updatedAt: row?.updated_at ?? null });
});

settingsRoutes.put("/business", async (c) => {
  const parsed = businessSettings.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_business_settings" }, 400);
  const sql = getSql();
  const payload = JSON.stringify(parsed.data);
  await sql("INSERT INTO moms_ops.operational_settings (key,value,updated_at) VALUES ('business', $1::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()", [payload]);
  const rows = await sql("SELECT value, updated_at FROM moms_ops.operational_settings WHERE key='business' LIMIT 1");
  return c.json({ settings: rows[0]?.value ?? parsed.data, updatedAt: rows[0]?.updated_at ?? null });
});


const bookingSettings = z.object({
  bookingEnabled: z.boolean(),
  allowSameDay: z.boolean(),
  minimumLeadMinutes: z.number().int().min(0).max(10080),
  maximumAdvanceDays: z.number().int().min(1).max(365),
  maxVehiclesPerBooking: z.number().int().min(1).max(10),
}).strict();

settingsRoutes.get("/booking", async (c) => {
  const sql = getSql();
  const rows = await sql("SELECT value, updated_at FROM moms_ops.operational_settings WHERE key='booking' LIMIT 1");
  const row = rows[0];
  return c.json({ settings: row?.value ?? { bookingEnabled:true, allowSameDay:false, minimumLeadMinutes:1440, maximumAdvanceDays:90, maxVehiclesPerBooking:10 }, updatedAt: row?.updated_at ?? null });
});

settingsRoutes.put("/booking", async (c) => {
  const parsed = bookingSettings.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_booking_settings" }, 400);
  const sql = getSql();
  const payload = JSON.stringify(parsed.data);
  await sql("INSERT INTO moms_ops.operational_settings (key,value,updated_at) VALUES ('booking', $1::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()", [payload]);
  const rows = await sql("SELECT value, updated_at FROM moms_ops.operational_settings WHERE key='booking' LIMIT 1");
  return c.json({ settings: rows[0]?.value ?? parsed.data, updatedAt: rows[0]?.updated_at ?? null });
});
