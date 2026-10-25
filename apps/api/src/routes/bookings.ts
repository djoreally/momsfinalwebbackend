import { Hono } from "hono";
import { z } from "zod";
import { BookingConflictError, BookingValidationError, reserveBooking } from "../domain/bookings.js";
import { getBooking } from "../repositories/bookings.js";
import { sendBookingConfirmation, retryDueBookingEmails } from "../services/booking-email.js";

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
  offerCode: z.enum(["SOCIAL99", "SOCIAL89", "WIPERS119"]).optional().nullable(),
});

export const bookingRoutes = new Hono();

// Static booking-flow configuration consumed by the frontend booking form.
// Registered before /:bookingId so "config" is never captured as a booking id.
bookingRoutes.get("/config", (c) => {
  return c.json({
    payments: { allowPayNow: true, allowPayAtAppointment: true, defaultMethod: "pay_at_appointment" },
    consent: { termsVersion: "2026-09-25", termsUrl: "/terms", privacyUrl: "/privacy-policy", requireTerms: true, requirePrivacy: true },
  });
});

bookingRoutes.post("/", async (c) => {
  const parsed = createInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_booking", issues: parsed.error.issues }, 400);
  try {
    const booking = await reserveBooking({ ...parsed.data, scheduledStart: new Date(parsed.data.scheduledStart) });
    const bookingId = String((booking as { id?: unknown }).id ?? "");
    if (bookingId) {
      try { const notifications = await sendBookingConfirmation(bookingId); console.info("booking_email_notifications", { bookingId, notifications }); }
      catch (emailError) { console.error("Booking saved but notification enqueue failed", { bookingId, emailError }); }
    }
    return c.json({ booking }, 201);
  } catch (error) {
    if (error instanceof BookingConflictError) return c.json({ error: "slot_unavailable" }, 409);
    if (error instanceof BookingValidationError) return c.json({ error: error.message }, 422);
    throw error;
  }
});

// Intended for an authenticated scheduler. Never callable without CRON_SECRET.
bookingRoutes.get("/retry-due-notifications", async (c) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || c.req.header("authorization") !== `Bearer ${secret}`) return c.json({error:"unauthorized"},401);
  try { return c.json({processed:await retryDueBookingEmails()}); }
  catch(error) { console.error("booking_email_retry_failed",error);return c.json({error:"retry_failed"},503); }
});

bookingRoutes.get("/:bookingId", async (c) => {
  const booking = await getBooking(c.req.param("bookingId"));
  return booking ? c.json({ booking }) : c.json({ error: "booking_not_found" }, 404);
});
