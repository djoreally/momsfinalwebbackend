import { Hono } from "hono";
import { getService, listActiveServices } from "../repositories/services.js";

export const serviceRoutes = new Hono();

serviceRoutes.get("/", async (c) => {
  return c.json({ services: await listActiveServices() });
});

serviceRoutes.get("/:serviceId", async (c) => {
  const service = await getService(c.req.param("serviceId"));
  return service ? c.json({ service }) : c.json({ error: "service_not_found" }, 404);
});
