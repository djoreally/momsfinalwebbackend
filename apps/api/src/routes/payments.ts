import { Hono } from "hono";
import { z } from "zod";
import { prepareAppointmentPayment } from "../domain/payments";

export const paymentRoutes = new Hono();

paymentRoutes.post("/prepare", async (c) => {
  const parsed = z.object({ appointmentId: z.string().uuid() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_payment_request" }, 400);

  const result = await prepareAppointmentPayment(parsed.data.appointmentId);
  return result ? c.json(result, 201) : c.json({ error: "appointment_not_found" }, 404);
});
