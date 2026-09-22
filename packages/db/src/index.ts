import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.js";

let client: ReturnType<typeof neon> | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;
let vehicleSpecsClient: ReturnType<typeof neon> | undefined;

function connectionString(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required");
  return value;
}

function vehicleSpecsConnectionString(): string {
  const value = process.env.VEHICLE_SPECS_DATABASE_URL;
  if (!value) throw new Error("VEHICLE_SPECS_DATABASE_URL is required");
  return value;
}

export function getSql() {
  client ??= neon(connectionString());
  return client;
}

export function getVehicleSpecsSql() {
  vehicleSpecsClient ??= neon(vehicleSpecsConnectionString());
  return vehicleSpecsClient;
}

export function getDb() {
  database ??= drizzle(getSql(), { schema });
  return database;
}

export async function databaseHealth(): Promise<void> {
  await getSql()`select 1 as ok`;
}

export async function vehicleSpecsDatabaseHealth(): Promise<void> {
  await getVehicleSpecsSql()`select 1 as ok`;
}

export * from "./schema.js";
