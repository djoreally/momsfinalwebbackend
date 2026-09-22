import { Hono } from "hono";
import { z } from "zod";
import { getAvailability } from "../domain/availability.js";

const requestSchema = z.object({
  serviceId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const availabilityRoutes = new Hono();

availabilityRoutes.get("/", async (c) => {
  const parsed = requestSchema.safeParse({
    serviceId: c.req.query("serviceId"),
    date: c.req.query("date"),
  });
  if (!parsed.success) return c.json({ error: "invalid_availability_request", issues: parsed.error.issues }, 400);

  const availability = await getAvailability(parsed.data);
  if (!availability) return c.json({ error: "service_not_found" }, 404);
  return c.json({ availability });
});
