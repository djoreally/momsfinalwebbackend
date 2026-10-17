import { Hono } from "hono";
import { requireAdminSession } from "../middleware/admin-session.js";
import { z } from "zod";
import { ensureServiceOrdersForBooking } from "../repositories/service-orders.js";
import { getSql } from "../../../../packages/db/src/index.js";

export const serviceOrderRoutes = new Hono();
serviceOrderRoutes.use("*", requireAdminSession);

serviceOrderRoutes.get("/by-booking/:bookingId", async (c) => {
  const parsed = z.string().uuid().safeParse(c.req.param("bookingId"));
  if (!parsed.success) return c.json({ error: "invalid_booking_id" }, 400);
  const { getServiceOrdersForBooking } = await import("../repositories/service-orders.js");
  return c.json({ serviceOrders: await getServiceOrdersForBooking(parsed.data) });
});

serviceOrderRoutes.post("/from-booking/:bookingId", async (c) => {
  const parsed = z.string().uuid().safeParse(c.req.param("bookingId"));
  if (!parsed.success) return c.json({ error: "invalid_booking_id" }, 400);

  const sql = getSql();
  const source = await sql`
    SELECT EXISTS(SELECT 1 FROM moms_ops.bookings WHERE id=${parsed.data}::uuid) AS "bookingExists",
           (SELECT count(*)::int FROM moms_ops.booking_jobs WHERE booking_id=${parsed.data}::uuid) AS "jobCount"
  `;
  if (!source[0]?.bookingExists) return c.json({ error: "booking_not_found" }, 404);
  if (Number(source[0]?.jobCount ?? 0) === 0) return c.json({ error: "booking_has_no_jobs" }, 409);

  const orders = await ensureServiceOrdersForBooking(parsed.data);
  if (!orders.length) return c.json({ error: "service_order_generation_failed" }, 409);
  return c.json({ serviceOrders: orders });
});
