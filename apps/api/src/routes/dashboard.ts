import { Hono } from "hono";
import { requireAdminSession } from "../middleware/admin-session.js";
import { z } from "zod";
import { getDashboardToday, listDashboardBookings } from "../repositories/dashboard.js";

export const dashboardRoutes = new Hono();
dashboardRoutes.use("*", requireAdminSession);

dashboardRoutes.get("/today", async (c) => {
  const parsed = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(c.req.query("date"));
  if (!parsed.success) return c.json({ error: "invalid_date" }, 400);
  return c.json(await getDashboardToday(parsed.data));
});


dashboardRoutes.get("/bookings", async (c) => {
  const statusRaw = c.req.query("status")?.trim() || undefined;
  const statusParsed = z.enum(["pending","confirmed","en_route","arrived","in_progress","completed","cancelled"]).optional().safeParse(statusRaw);
  if (!statusParsed.success) return c.json({ error: "invalid_status" }, 400);
  const status = statusParsed.data;
  const limitRaw = Number(c.req.query("limit") ?? 100);
  const offsetRaw = Number(c.req.query("offset") ?? 0);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw),1),200) : 100;
  const offset = Number.isFinite(offsetRaw) ? Math.max(Math.trunc(offsetRaw),0) : 0;
  return c.json(await listDashboardBookings({ status, limit, offset }));
});
