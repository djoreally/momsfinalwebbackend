import crypto from "node:crypto";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  getInternalWebsiteBooking,
  listInternalWebsiteBookings,
  recordInternalWebsiteBookingAutoPushFailure,
  setInternalWebsiteBookingNeverPush,
  stampInternalWebsiteBookingPush,
  type InternalWebsiteBookingFilter,
} from "../repositories/internal-website-bookings.js";

/**
 * Server-to-server endpoints for the Service Writer "Website Bookings"
 * queue (selective push). Every route requires the shared service secret
 * in the `x-sw-push-secret` header, compared in constant time against
 * SW_PUSH_SECRET. The secret is only ever read from the environment.
 * Nothing on this surface is customer-facing and nothing here creates,
 * moves, or notifies anything: it reads the queue and records the stamp
 * after Service Writer has created an appointment itself. The one
 * addition for the prepaid auto-push is `auto-push-failure`, which
 * records why an automatic attempt was blocked — it stamps nothing and
 * leaves the booking in the manual queue.
 */
const requireSwPushSecret: MiddlewareHandler = async (c, next) => {
  const expected = process.env.SW_PUSH_SECRET;
  if (!expected) return c.json({ error: "internal_endpoint_not_configured" }, 503);
  const provided = c.req.header("x-sw-push-secret") ?? "";
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};

export const internalWebsiteBookingRoutes = new Hono();
internalWebsiteBookingRoutes.use("*", requireSwPushSecret);

const statusFilter = z.enum(["unpushed", "never_push", "pushed"]);
const uuid = z.string().uuid();

internalWebsiteBookingRoutes.get("/", async (c) => {
  const parsed = statusFilter.optional().safeParse(c.req.query("status"));
  if (!parsed.success) return c.json({ error: "invalid_status" }, 400);
  const filter: InternalWebsiteBookingFilter = parsed.data ?? "unpushed";
  const bookings = await listInternalWebsiteBookings(filter);
  return c.json({
    data: bookings.map((booking) => ({
      id: booking.id,
      customer: booking.customer,
      email: booking.email,
      phone: booking.phone,
      address: booking.address,
      payment: booking.payment,
      quoted_total_usd: booking.quotedTotalUsd,
      scheduled_start: booking.scheduledStart,
      scheduled_end: booking.scheduledEnd,
      service: booking.service,
      source_channel: booking.sourceChannel,
      status: booking.status,
      vehicle: booking.vehicle,
      pushed_sw_appointment_id: booking.pushedSwAppointmentId,
      pushed_at: booking.pushedAt,
      auto_push_last_error: booking.autoPushLastError,
      auto_push_last_attempt_at: booking.autoPushLastAttemptAt,
    })),
  });
});

const pushStampInput = z.object({
  sw_appointment_id: z.string().uuid(),
});

internalWebsiteBookingRoutes.post("/:id/push-stamp", async (c) => {
  const bookingId = c.req.param("id");
  // A non-UUID id can never match a booking; answer 404 instead of
  // letting the uuid cast fail in the database.
  if (!uuid.safeParse(bookingId).success) return c.json({ error: "booking_not_found" }, 404);
  const parsed = pushStampInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_push_stamp", issues: parsed.error.issues }, 400);

  const booking = await getInternalWebsiteBooking(bookingId);
  if (!booking) return c.json({ error: "booking_not_found" }, 404);

  if (booking.pushedSwAppointmentId) {
    if (booking.pushedSwAppointmentId === parsed.data.sw_appointment_id) {
      return c.json({
        data: {
          id: booking.id,
          pushed_sw_appointment_id: booking.pushedSwAppointmentId,
          pushed_at: booking.pushedAt,
        },
      });
    }
    return c.json(
      { error: "already_pushed", pushed_sw_appointment_id: booking.pushedSwAppointmentId },
      409,
    );
  }

  const stamped = await stampInternalWebsiteBookingPush(bookingId, parsed.data.sw_appointment_id);
  if (!stamped) {
    // Lost a race with a concurrent stamp: report the winning stamp.
    const current = await getInternalWebsiteBooking(bookingId);
    if (current?.pushedSwAppointmentId === parsed.data.sw_appointment_id) {
      return c.json({
        data: {
          id: current.id,
          pushed_sw_appointment_id: current.pushedSwAppointmentId,
          pushed_at: current.pushedAt,
        },
      });
    }
    if (current?.pushedSwAppointmentId) {
      return c.json(
        { error: "already_pushed", pushed_sw_appointment_id: current.pushedSwAppointmentId },
        409,
      );
    }
    return c.json({ error: "booking_not_found" }, 404);
  }

  return c.json({
    data: {
      id: stamped.id,
      pushed_sw_appointment_id: stamped.pushedSwAppointmentId,
      pushed_at: stamped.pushedAt,
    },
  });
});

const autoPushFailureInput = z.object({
  reason: z.string().trim().min(1).max(2000),
});

/**
 * Service Writer reports a failed AUTO-push attempt here (e.g. the
 * booking's service does not resolve to the Service Writer catalog, so
 * the pipeline blocked the push). Recording the failure stamps nothing:
 * the booking stays in the unpushed manual queue, now carrying the
 * reason staff need. A manual push does not use this route.
 */
internalWebsiteBookingRoutes.post("/:id/auto-push-failure", async (c) => {
  const bookingId = c.req.param("id");
  if (!uuid.safeParse(bookingId).success) return c.json({ error: "booking_not_found" }, 404);
  const parsed = autoPushFailureInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_auto_push_failure", issues: parsed.error.issues }, 400);

  const booking = await getInternalWebsiteBooking(bookingId);
  if (!booking) return c.json({ error: "booking_not_found" }, 404);
  // Already pushed (e.g. a manual push landed first): a stale failure
  // report must not resurrect an error on a completed push.
  if (booking.pushedSwAppointmentId) {
    return c.json({
      data: { id: booking.id, auto_push_last_error: null, auto_push_last_attempt_at: booking.autoPushLastAttemptAt },
    });
  }

  const recorded = await recordInternalWebsiteBookingAutoPushFailure(bookingId, parsed.data.reason);
  if (!recorded) return c.json({ error: "booking_not_found" }, 404);
  return c.json({
    data: {
      id: recorded.id,
      auto_push_last_error: recorded.autoPushLastError,
      auto_push_last_attempt_at: recorded.autoPushLastAttemptAt,
    },
  });
});

const neverPushInput = z.object({
  never_push: z.boolean(),
});

internalWebsiteBookingRoutes.post("/:id/never-push", async (c) => {
  const bookingId = c.req.param("id");
  if (!uuid.safeParse(bookingId).success) return c.json({ error: "booking_not_found" }, 404);
  const parsed = neverPushInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_never_push", issues: parsed.error.issues }, 400);

  const updated = await setInternalWebsiteBookingNeverPush(bookingId, parsed.data.never_push);
  if (!updated) return c.json({ error: "booking_not_found" }, 404);
  return c.json({ data: { id: updated.id, never_push: updated.neverPush } });
});
