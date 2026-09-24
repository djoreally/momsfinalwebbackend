import { Hono } from "hono";
import { z } from "zod";
import { requireAdminSession } from "../middleware/admin-session.js";
import { listMediaImages,registerMediaImage } from "../repositories/media.js";
export const mediaRoutes=new Hono();
mediaRoutes.use("*",requireAdminSession);
mediaRoutes.get("/",async c=>c.json({images:await listMediaImages()}));
mediaRoutes.post("/",async c=>{const p=z.object({title:z.string().trim().min(1).max(240),imageUrl:z.string().url().max(2048)}).safeParse(await c.req.json().catch(()=>null));if(!p.success)return c.json({error:"invalid_media"},400);return c.json({image:await registerMediaImage(p.data.title,p.data.imageUrl)},201)});
