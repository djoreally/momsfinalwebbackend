import { Hono } from "hono";
import { z } from "zod";
import { requireAdminSession } from "../middleware/admin-session.js";
import { getExitIntentSettings,saveExitIntentSettings } from "../repositories/campaign-settings.js";
export const campaignSettingsRoutes=new Hono();
const schema=z.object({enabled:z.boolean(),delaySeconds:z.number().int().min(0).max(600),exitIntent:z.boolean(),frequency:z.enum(["session","day","always"]),eyebrow:z.string().max(80),headline:z.string().min(1).max(160),body:z.string().min(1).max(500),primaryLabel:z.string().min(1).max(80),primaryUrl:z.string().min(1).max(500),secondaryLabel:z.string().max(80),secondaryUrl:z.string().max(500),imageUrl:z.string().url().max(2048).nullable()});
campaignSettingsRoutes.get("/exit-intent-v1",async c=>c.json({settings:await getExitIntentSettings()}));
campaignSettingsRoutes.put("/exit-intent-v1",requireAdminSession,async c=>{const p=schema.safeParse(await c.req.json().catch(()=>null));if(!p.success)return c.json({error:"invalid_campaign_settings",issues:p.error.flatten()},400);return c.json({settings:await saveExitIntentSettings(p.data)});});
