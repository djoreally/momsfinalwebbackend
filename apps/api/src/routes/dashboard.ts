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
  const status = c.req.query("status")?.trim() || undefined;
  const limitRaw = Number(c.req.query("limit") ?? 100);\n  const offsetRaw = Number(c.req.query("offset") ?? 0);\n  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw),1),200) : 100;\n  const offset = Number.isFinite(offsetRaw) ? Math.max(Math.trunc(offsetRaw),0) : 0;\n  return c.json(await listDashboardBookings({ status, limit, offset }));
});
