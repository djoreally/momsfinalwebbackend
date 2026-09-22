import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let client: ReturnType<typeof neon> | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;

function connectionString(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required");
  return value;
}

export function getSql() {
  client ??= neon(connectionString());
  return client;
}

export function getDb() {
  database ??= drizzle(getSql(), { schema });
  return database;
}

export async function databaseHealth(): Promise<void> {
  await getSql()`select 1 as ok`;
}

export * from "./schema";
