import { Hono } from "hono";
import { z } from "zod";
import { BookingConflictError, BookingValidationError, reserveBooking } from "../domain/bookings.js";
import { getBooking } from "../repositories/bookings.js";
import { sendBookingConfirmation } from "../services/booking-email.js";
import { getSql } from "../../../../packages/db/src/index.js";

const consentDefaults={termsVersion:"2026-09-25",termsUrl:"/terms",privacyUrl:"/privacy-policy",requireTerms:true,requirePrivacy:true};

const createInput = z.object({
  customerId: z.string().uuid(),
  jobs: z.array(z.object({ vehicleId: z.string().uuid(), serviceId: z.string().uuid() })).min(1).max(10),
  scheduledStart: z.string().datetime({ offset: true }),
  serviceAddressLine1: z.string().trim().min(1).max(200),
  serviceAddressLine2: z.string().trim().max(200).optional().nullable(),
  serviceCity: z.string().trim().min(1).max(100),
  serviceState: z.string().trim().min(2).max(50),
  servicePostalCode: z.string().trim().min(3).max(20),
  notes: z.string().trim().max(2000).optional().nullable(),
  offerCode: z.literal("SOCIAL99").optional().nullable(),
  consent:z.object({
    termsAccepted:z.boolean(),
    privacyAccepted:z.boolean(),
    emailMarketingAccepted:z.boolean(),
    smsMarketingAccepted:z.boolean(),
    termsVersion:z.string().trim().min(1).max(80),
  }).strict(),
});

export const bookingRoutes = new Hono();

bookingRoutes.get("/config", async (c) => {
  const sql=getSql();
  const rows=await sql`SELECT value FROM moms_ops.operational_settings WHERE key='payments' LIMIT 1`;
  const p=(rows[0]?.value as {allowPayNow?:boolean;allowPayAtAppointment?:boolean;defaultMethod?:"pay_now"|"pay_at_appointment"}|undefined)??{allowPayNow:true,allowPayAtAppointment:true,defaultMethod:"pay_at_appointment"};
  const consentRows=await sql`SELECT value FROM moms_ops.operational_settings WHERE key='consent' LIMIT 1`;
  const consent=(consentRows[0]?.value as typeof consentDefaults|undefined)??consentDefaults;
  return c.json({payments:{allowPayNow:p.allowPayNow!==false,allowPayAtAppointment:p.allowPayAtAppointment!==false,defaultMethod:p.defaultMethod??"pay_at_appointment"},consent});
});

bookingRoutes.post("/", async (c) => {
  const parsed = createInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_booking", issues: parsed.error.issues }, 400);
  try {
    const sql=getSql();
    const consentRows=await sql`SELECT value FROM moms_ops.operational_settings WHERE key='consent' LIMIT 1`;
    const policy=(consentRows[0]?.value as typeof consentDefaults|undefined)??consentDefaults;
    const accepted=parsed.data.consent;
    if(accepted.termsVersion!==policy.termsVersion)return c.json({error:"terms_version_changed"},409);
    if(policy.requireTerms&&!accepted.termsAccepted)return c.json({error:"terms_consent_required"},422);
    if(policy.requirePrivacy&&!accepted.privacyAccepted)return c.json({error:"privacy_consent_required"},422);

    const {consent,...bookingInput}=parsed.data;
    const booking = await reserveBooking({ ...bookingInput, scheduledStart: new Date(bookingInput.scheduledStart) });
    const bookingId = String((booking as { id?: unknown }).id ?? "");
    if (bookingId) {
      await sql`INSERT INTO moms_ops.booking_consents(booking_id,terms_version,terms_accepted_at,privacy_accepted_at,email_marketing_accepted,sms_marketing_accepted)
        VALUES(${bookingId}::uuid,${consent.termsVersion},now(),now(),${consent.emailMarketingAccepted},${consent.smsMarketingAccepted})
        ON CONFLICT(booking_id) DO NOTHING`;
      try { await sendBookingConfirmation(bookingId); }
      catch (emailError) { console.error("Booking saved but confirmation email failed", { bookingId, emailError }); }
    }
    return c.json({ booking }, 201);
  } catch (error) {
    if (error instanceof BookingConflictError) return c.json({ error: "slot_unavailable" }, 409);
    if (error instanceof BookingValidationError) return c.json({ error: error.message }, 422);
    throw error;
  }
});

bookingRoutes.get("/:bookingId", async (c) => {
  const booking = await getBooking(c.req.param("bookingId"));
  return booking ? c.json({ booking }) : c.json({ error: "booking_not_found" }, 404);
});
