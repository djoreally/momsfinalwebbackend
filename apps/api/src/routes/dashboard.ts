import { Hono } from "hono";
import { z } from "zod";
import { getDashboardToday } from "../repositories/dashboard.js";

export const dashboardRoutes = new Hono();

dashboardRoutes.get("/today", async (c) => {
  const parsed = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(c.req.query("date"));
  if (!parsed.success) return c.json({ error: "invalid_date" }, 400);
  return c.json(await getDashboardToday(parsed.data));
});
