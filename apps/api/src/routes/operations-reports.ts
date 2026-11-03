import { Hono } from "hono";
import { z } from "zod";
import { requireAdminSession } from "../middleware/admin-session.js";
import { resolveReportPeriodRange } from "../domain/report-period.js";
import {
  getOperationsCaseStudy,
  getOperationsReportSummary,
} from "../repositories/operations-reports.js";

export const operationsReportRoutes = new Hono();

// The case study contains aggregate totals only and no customer-level data.
// It is intentionally registered before the admin-session middleware so the
// public case-study page can read it without an operations session.
operationsReportRoutes.get("/case-study", async (c) => {
  return c.json(await getOperationsCaseStudy());
});

operationsReportRoutes.use("*", requireAdminSession);

const summaryQuery = z.object({
  period: z.enum(["daily", "weekly", "monthly"]),
  anchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

operationsReportRoutes.get("/summary", async (c) => {
  const query = summaryQuery.safeParse(c.req.query());
  if (!query.success) return c.json({ error: "invalid_query" }, 400);

  const range = resolveReportPeriodRange(query.data.period, query.data.anchor);
  if (!range) return c.json({ error: "invalid_anchor" }, 400);

  return c.json(await getOperationsReportSummary(range));
});
