import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const sql = neon(connectionString);

export const db = drizzle({ client: sql });

export async function databaseHealth(): Promise<void> {
  await sql`select 1 as ok`;
}
