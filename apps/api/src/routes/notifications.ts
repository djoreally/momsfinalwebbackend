import { Hono } from "hono";
import { z } from "zod";
import { getBookingByManageToken } from "../repositories/notifications.js";
import {
  removePushSubscription,
  rescheduleAppointmentByToken,
  subscribePushSubscription,
} from "../services/notifications.js";
import {
  RESCHEDULE_NOT_AVAILABLE_CODE,
  RESCHEDULE_NOT_AVAILABLE_MESSAGE,
  shapeAppointmentView,
} from "../domain/notifications.js";

/**
 * Customer-facing notification surfaces. The manage token in the URL
 * is the only credential: it keys the appointment view and the
 * reschedule write. Responses are whitelisted shapes — the Service
 * Writer management token and customer contact details never leave
 * the server.
 */
export const notificationRoutes = new Hono();

const subscribeInput = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(2048),
    keys: z.object({
      p256dh: z.string().min(1).max(256),
      auth: z.string().min(1).max(256),
    }),
  }),
  bookingId: z.string().uuid().optional().nullable(),
  manageToken: z.string().min(1).max(256).optional().nullable(),
  userAgent: z.string().max(512).optional().nullable(),
});

notificationRoutes.post("/push-subscriptions", async (c) => {
  const parsed = subscribeInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_subscription", issues: parsed.error.issues }, 400);
  const record = await subscribePushSubscription({
    subscription: parsed.data.subscription,
    bookingId: parsed.data.bookingId ?? null,
    manageToken: parsed.data.manageToken ?? null,
    userAgent: parsed.data.userAgent ?? c.req.header("user-agent") ?? null,
  });
  return c.json({ subscription: { id: record.id, endpoint: record.endpoint } }, 201);
});

const unsubscribeInput = z.object({
  endpoint: z.string().url().max(2048),
});

notificationRoutes.delete("/push-subscriptions", async (c) => {
  const parsed = unsubscribeInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_subscription", issues: parsed.error.issues }, 400);
  const removed = await removePushSubscription(parsed.data.endpoint);
  return c.json({ unsubscribed: removed });
});

notificationRoutes.get("/appointments/by-token/:token", async (c) => {
  const booking = await getBookingByManageToken(c.req.param("token"));
  if (!booking) return c.json({ error: "appointment_not_found" }, 404);
  return c.json({ appointment: shapeAppointmentView(booking) });
});

const rescheduleInput = z.object({
  newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  newTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

notificationRoutes.post("/appointments/by-token/:token/reschedule", async (c) => {
  const parsed = rescheduleInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_reschedule", issues: parsed.error.issues }, 400);
  let outcome;
  try {
    outcome = await rescheduleAppointmentByToken(c.req.param("token"), parsed.data);
  } catch (error) {
    // Transport failure talking to Service Writer: nothing was
    // changed on either side; say so plainly.
    console.error("reschedule_sw_call_failed", error);
    return c.json(
      { success: false, message: "We could not reach the scheduling service just now — please try again, or call (215) 767-2125 and we will move it for you." },
      502,
    );
  }
  switch (outcome.kind) {
    case "not_found":
      return c.json({ error: "appointment_not_found" }, 404);
    case "not_available":
      return c.json({ success: false, code: RESCHEDULE_NOT_AVAILABLE_CODE, message: RESCHEDULE_NOT_AVAILABLE_MESSAGE });
    case "sw_failed":
      return c.json({ success: false, message: outcome.message });
    case "success":
      return c.json({ success: true, scheduledStart: outcome.scheduledStart, scheduledEnd: outcome.scheduledEnd });
  }
});
