import { Hono } from "hono";
import { z } from "zod";
import { subscribeNewsletter, unsubscribeNewsletter } from "../services/newsletter.js";
export const newsletterRoutes = new Hono();
newsletterRoutes.post("/subscribe", async (c) => {
  const parsed=z.object({email:z.string().email(),source:z.string().max(80).optional()}).safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({error:"invalid_request"},400);
  return c.json(await subscribeNewsletter(parsed.data.email,parsed.data.source));
});
newsletterRoutes.get("/unsubscribe", async (c) => {
  const parsed=z.string().uuid().safeParse(c.req.query("token"));
  if(!parsed.success)return c.json({error:"invalid_token"},400);
  return c.json({ok:await unsubscribeNewsletter(parsed.data)});
});
