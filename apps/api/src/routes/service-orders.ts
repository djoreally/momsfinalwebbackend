import { Hono } from "hono";
import { z } from "zod";
import { ensureServiceOrdersForBooking } from "../repositories/service-orders.js";

export const serviceOrderRoutes = new Hono();

serviceOrderRoutes.get("/by-booking/:bookingId", async (c) => {
  const parsed = z.string().uuid().safeParse(c.req.param("bookingId"));
  if (!parsed.success) return c.json({ error: "invalid_booking_id" }, 400);
  const { getServiceOrdersForBooking } = await import("../repositories/service-orders.js");
  return c.json({ serviceOrders: await getServiceOrdersForBooking(parsed.data) });
});

serviceOrderRoutes.post("/from-booking/:bookingId", async (c) => {
  const parsed = z.string().uuid().safeParse(c.req.param("bookingId"));
  if (!parsed.success) return c.json({ error: "invalid_booking_id" }, 400);
  const orders = await ensureServiceOrdersForBooking(parsed.data);
  if (!orders.length) return c.json({ error: "booking_not_found" }, 404);
  return c.json({ serviceOrders: orders });
});
