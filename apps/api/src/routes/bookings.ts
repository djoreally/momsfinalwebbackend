import { Hono } from "hono";
import { z } from "zod";
import { BookingConflictError, BookingValidationError, reserveBooking } from "../domain/bookings.js";
import { getBooking } from "../repositories/bookings.js";
import { sendBookingConfirmation } from "../services/booking-email.js";

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
});

export const bookingRoutes = new Hono();

bookingRoutes.post("/", async (c) => {
  const parsed = createInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_booking", issues: parsed.error.issues }, 400);
  try {
    const booking = await reserveBooking({ ...parsed.data, scheduledStart: new Date(parsed.data.scheduledStart) });
    const bookingId = String((booking as { id?: unknown }).id ?? "");
    if (bookingId) {
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
