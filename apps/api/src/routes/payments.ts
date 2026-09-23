import { Hono } from "hono";
import { z } from "zod";
import { chooseBookingPayment, prepareAppointmentPayment } from "../domain/payments.js";

export const paymentRoutes = new Hono();

paymentRoutes.post("/prepare", async (c) => {
  const parsed = z.object({ appointmentId: z.string().uuid() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_payment_request" }, 400);

  const result = await prepareAppointmentPayment(parsed.data.appointmentId);
  return result ? c.json(result, 201) : c.json({ error: "appointment_not_found" }, 404);
});

paymentRoutes.post("/booking", async (c) => {
  const parsed = z.object({
    bookingId: z.string().uuid(),
    method: z.enum(["pay_now", "pay_at_appointment"]),
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_booking_payment_request" }, 400);
  const result = await chooseBookingPayment(parsed.data.bookingId, parsed.data.method);
  return result ? c.json(result, 201) : c.json({ error: "booking_not_found" }, 404);
});
