import { Hono } from "hono";
import { z } from "zod";
import { getSql } from "../../../../packages/db/src/index.js";
import { requireAdminSession } from "../middleware/admin-session.js";

const leadInput=z.object({
  formType:z.enum(["Contact Us","Fleet Maintenance","Quote Request"]),
  name:z.string().trim().min(1).max(200),
  email:z.string().trim().email().max(254),
  phone:z.string().trim().max(40).optional().default(""),
  message:z.string().trim().min(1).max(5000),
  companyName:z.string().trim().max(200).optional().default(""),
  vehicleCount:z.string().trim().max(20).optional().default(""),
  source:z.string().trim().max(100).optional().default("website"),
}).strict();

export const leadRoutes=new Hono();

leadRoutes.post("/",async c=>{
 const parsed=leadInput.safeParse(await c.req.json().catch(()=>null));
 if(!parsed.success)return c.json({error:"invalid_lead",issues:parsed.error.issues},400);
 const d=parsed.data,sql=getSql();
 const rows=await sql`INSERT INTO moms_ops.leads(form_type,name,email,phone,message,company_name,vehicle_count,source,status)
 VALUES(${d.formType},${d.name},${d.email},NULLIF(${d.phone},''),${d.message},NULLIF(${d.companyName},''),NULLIF(${d.vehicleCount},''),${d.source},'new')
 RETURNING id,created_at AS "createdAt",status`;
 return c.json({lead:rows[0]},201);
});

leadRoutes.get("/",requireAdminSession,async c=>{
 const sql=getSql();
 const rows=await sql`SELECT id,form_type AS "formType",name,email,phone,message,company_name AS "companyName",vehicle_count AS "vehicleCount",source,status,created_at AS "createdAt"
 FROM moms_ops.leads ORDER BY created_at DESC LIMIT 200`;
 return c.json({leads:rows});
});
