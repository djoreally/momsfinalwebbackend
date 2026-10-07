import { Hono } from "hono";
import { listMediaImages } from "../repositories/media.js";

export const galleryRoutes = new Hono();

galleryRoutes.get("/", async (c) => {
  const images = await listMediaImages();
  return c.json({ images });
});
