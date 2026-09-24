import { getSql } from "../../../../packages/db/src/index.js";

export type MediaImage = { id:number; title:string; imageUrl:string; createdAt:string };

export async function listMediaImages(): Promise<MediaImage[]> {
  const sql=getSql();
  const rows=await sql`SELECT id,title,"imageUrl","createdAt" FROM "WorkImage" ORDER BY "createdAt" DESC LIMIT 100`;
  return rows.map((r:any)=>({id:Number(r.id),title:String(r.title),imageUrl:String(r.imageUrl),createdAt:new Date(r.createdAt).toISOString()}));
}
export async function registerMediaImage(title:string,imageUrl:string): Promise<MediaImage> {
  const sql=getSql();
  const rows=await sql`INSERT INTO "WorkImage" (title,"imageUrl","createdAt") VALUES (${title},${imageUrl},now()) RETURNING id,title,"imageUrl","createdAt"`;
  const r:any=rows[0];
  return {id:Number(r.id),title:String(r.title),imageUrl:String(r.imageUrl),createdAt:new Date(r.createdAt).toISOString()};
}
