import { Hono } from "hono";
import { z } from "zod";
import {
  AppointmentConflictError,
  AppointmentValidationError,
  reserveAppointment,
} from "../domain/appointments.js";
import { getAppointment } from "../repositories/appointments.js";

const createInput = z.object({
  customerId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  serviceId: z.string().uuid(),
  scheduledStart: z.string().datetime({ offset: true }),
  serviceAddressLine1: z.string().trim().min(1).max(200),
  serviceAddressLine2: z.string().trim().max(200).optional().nullable(),
  serviceCity: z.string().trim().min(1).max(100),
  serviceState: z.string().trim().min(2).max(50),
  servicePostalCode: z.string().trim().min(3).max(20),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const appointmentRoutes = new Hono();

appointmentRoutes.post("/", async (c) => {
  const parsed = createInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_appointment", issues: parsed.error.issues }, 400);
  }

  try {
    const appointment = await reserveAppointment({
      ...parsed.data,
      scheduledStart: new Date(parsed.data.scheduledStart),
    });
    return c.json({ appointment }, 201);
  } catch (error) {
    if (error instanceof AppointmentConflictError) {
      return c.json({ error: "slot_unavailable" }, 409);
    }
    if (error instanceof AppointmentValidationError) {
      return c.json({ error: error.message }, 422);
    }
    throw error;
  }
});

appointmentRoutes.get("/:appointmentId", async (c) => {
  const appointment = await getAppointment(c.req.param("appointmentId"));
  return appointment
    ? c.json({ appointment })
    : c.json({ error: "appointment_not_found" }, 404);
});
