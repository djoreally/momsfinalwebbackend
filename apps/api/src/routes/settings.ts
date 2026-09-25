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


const availabilitySettings = z.object({
  timezone: z.string().trim().min(1).max(80),
  slotIntervalMinutes: z.number().int().min(15).max(240),
  weeklyHours: z.array(z.object({
    day: z.number().int().min(0).max(6),
    enabled: z.boolean(),
    open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    close: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  })).length(7),
  blackoutDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366),
}).strict();

const availabilityDefaults = {
  timezone:"America/New_York",
  slotIntervalMinutes:30,
  weeklyHours:[
    {day:0,enabled:false,open:"08:00",close:"17:00"},
    {day:1,enabled:true,open:"08:00",close:"17:00"},
    {day:2,enabled:true,open:"08:00",close:"17:00"},
    {day:3,enabled:true,open:"08:00",close:"17:00"},
    {day:4,enabled:true,open:"08:00",close:"17:00"},
    {day:5,enabled:true,open:"08:00",close:"17:00"},
    {day:6,enabled:true,open:"08:00",close:"17:00"},
  ],
  blackoutDates:[],
};

settingsRoutes.get("/availability", async (c) => {
  const sql=getSql(); const rows=await sql("SELECT value, updated_at FROM moms_ops.operational_settings WHERE key='availability' LIMIT 1"); const row=rows[0];
  return c.json({settings:row?.value ?? availabilityDefaults,updatedAt:row?.updated_at ?? null});
});
settingsRoutes.put("/availability", async (c) => {
  const parsed=availabilitySettings.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({error:"invalid_availability_settings"},400);
  if(parsed.data.weeklyHours.some(x=>x.enabled && x.close<=x.open))return c.json({error:"availability_close_must_follow_open"},400);
  const sql=getSql(),payload=JSON.stringify(parsed.data);
  await sql("INSERT INTO moms_ops.operational_settings (key,value,updated_at) VALUES ('availability',$1::jsonb,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()",[payload]);
  const rows=await sql("SELECT value, updated_at FROM moms_ops.operational_settings WHERE key='availability' LIMIT 1");
  return c.json({settings:rows[0]?.value ?? parsed.data,updatedAt:rows[0]?.updated_at ?? null});
});


const serviceAreaSettings=z.object({
  enabled:z.boolean(),
  allowedStates:z.array(z.string().trim().min(2).max(2)).min(1).max(10),
  allowedPostalCodes:z.array(z.string().trim().regex(/^\d{5}$/)).max(500),
  enforcementMode:z.enum(["postal_codes","state_only"]),
}).strict();
const serviceAreaDefaults={enabled:true,allowedStates:["PA"],allowedPostalCodes:[],enforcementMode:"state_only" as const};

settingsRoutes.get("/service-area",async(c)=>{
 const sql=getSql();const rows=await sql("SELECT value, updated_at FROM moms_ops.operational_settings WHERE key='service_area' LIMIT 1");const row=rows[0];
 return c.json({settings:row?.value??serviceAreaDefaults,updatedAt:row?.updated_at??null});
});
settingsRoutes.put("/service-area",async(c)=>{
 const parsed=serviceAreaSettings.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)return c.json({error:"invalid_service_area_settings"},400);
 if(parsed.data.enforcementMode==="postal_codes"&&!parsed.data.allowedPostalCodes.length)return c.json({error:"service_area_requires_postal_codes"},400);
 const sql=getSql(),payload=JSON.stringify({...parsed.data,allowedStates:parsed.data.allowedStates.map(x=>x.toUpperCase())});
 await sql("INSERT INTO moms_ops.operational_settings (key,value,updated_at) VALUES ('service_area',$1::jsonb,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()",[payload]);
 const rows=await sql("SELECT value, updated_at FROM moms_ops.operational_settings WHERE key='service_area' LIMIT 1");return c.json({settings:rows[0]?.value??parsed.data,updatedAt:rows[0]?.updated_at??null});
});


const paymentSettings=z.object({
  allowPayNow:z.boolean(),
  allowPayAtAppointment:z.boolean(),
  defaultMethod:z.enum(["pay_now","pay_at_appointment"]),
}).strict();
const paymentDefaults={allowPayNow:true,allowPayAtAppointment:true,defaultMethod:"pay_at_appointment" as const};
settingsRoutes.get("/payments",async(c)=>{const sql=getSql();const rows=await sql("SELECT value, updated_at FROM moms_ops.operational_settings WHERE key='payments' LIMIT 1");const row=rows[0];return c.json({settings:row?.value??paymentDefaults,updatedAt:row?.updated_at??null})});
settingsRoutes.put("/payments",async(c)=>{const parsed=paymentSettings.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)return c.json({error:"invalid_payment_settings"},400);if(!parsed.data.allowPayNow&&!parsed.data.allowPayAtAppointment)return c.json({error:"payment_method_required"},400);if(parsed.data.defaultMethod==="pay_now"&&!parsed.data.allowPayNow)return c.json({error:"invalid_default_payment_method"},400);if(parsed.data.defaultMethod==="pay_at_appointment"&&!parsed.data.allowPayAtAppointment)return c.json({error:"invalid_default_payment_method"},400);const sql=getSql(),payload=JSON.stringify(parsed.data);await sql("INSERT INTO moms_ops.operational_settings (key,value,updated_at) VALUES ('payments',$1::jsonb,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()",[payload]);const rows=await sql("SELECT value, updated_at FROM moms_ops.operational_settings WHERE key='payments' LIMIT 1");return c.json({settings:rows[0]?.value??parsed.data,updatedAt:rows[0]?.updated_at??null})});


const notificationSettings=z.object({
  bookingConfirmationEmail:z.boolean(),
  invoiceEmail:z.boolean(),
  appointmentReminderEmail:z.boolean(),
  postServiceReviewEmail:z.boolean(),
  ownerBccEmail:z.string().trim().email().or(z.literal("")),
}).strict();
const notificationDefaults={bookingConfirmationEmail:true,invoiceEmail:true,appointmentReminderEmail:true,postServiceReviewEmail:true,ownerBccEmail:"support@momsoilchange.com"};

settingsRoutes.get("/notifications",async(c)=>{
  const sql=getSql();
  const rows=await sql`SELECT value,updated_at FROM moms_ops.operational_settings WHERE key='notifications' LIMIT 1`;
  const row=rows[0];
  return c.json({settings:row?.value??notificationDefaults,updatedAt:row?.updated_at??null});
});
settingsRoutes.put("/notifications",async(c)=>{
  const parsed=notificationSettings.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({error:"invalid_notification_settings"},400);
  const sql=getSql(),payload=JSON.stringify(parsed.data);
  await sql`INSERT INTO moms_ops.operational_settings(key,value,updated_at) VALUES('notifications',${payload}::jsonb,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`;
  const rows=await sql`SELECT value,updated_at FROM moms_ops.operational_settings WHERE key='notifications' LIMIT 1`;
  return c.json({settings:rows[0]?.value??parsed.data,updatedAt:rows[0]?.updated_at??null});
});


const consentSettings=z.object({
  termsVersion:z.string().trim().min(1).max(80),
  termsUrl:z.string().trim().startsWith("/").max(300),
  privacyUrl:z.string().trim().startsWith("/").max(300),
  requireTerms:z.boolean(),
  requirePrivacy:z.boolean(),
}).strict();
const consentDefaults={termsVersion:"2026-09-25",termsUrl:"/terms",privacyUrl:"/privacy-policy",requireTerms:true,requirePrivacy:true};

settingsRoutes.get("/consent",async(c)=>{
 const rows=await getSql()`SELECT value,updated_at FROM moms_ops.operational_settings WHERE key='consent' LIMIT 1`;const row=rows[0];
 return c.json({settings:row?.value??consentDefaults,updatedAt:row?.updated_at??null});
});
settingsRoutes.put("/consent",async(c)=>{
 const parsed=consentSettings.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)return c.json({error:"invalid_consent_settings"},400);
 const payload=JSON.stringify(parsed.data),sql=getSql();
 await sql`INSERT INTO moms_ops.operational_settings(key,value,updated_at) VALUES('consent',${payload}::jsonb,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`;
 const rows=await sql`SELECT value,updated_at FROM moms_ops.operational_settings WHERE key='consent' LIMIT 1`;
 return c.json({settings:rows[0]?.value??parsed.data,updatedAt:rows[0]?.updated_at??null});
});
