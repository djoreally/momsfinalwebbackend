import { Hono } from "hono";

export const app = new Hono();

app.get("/", (c) =>
  c.json({
    service: "MOMS Platform API",
    status: "ok",
    architecture: "hono-drizzle-neon",
  }),
);

app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "moms-api",
    timestamp: new Date().toISOString(),
  }),
);
