import { and, desc, eq, or } from "drizzle-orm";
import { customers, getDb, vehicles } from "@moms/db";

export type CreateCustomerInput = {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  marketingConsent?: boolean;
};

export async function createCustomer(input: CreateCustomerInput) {
  const [customer] = await getDb()
    .insert(customers)
    .values(input)
    .returning();
  return customer;
}

export async function findCustomer(identity: { phone?: string; email?: string }) {
  const predicates = [];
  if (identity.phone) predicates.push(eq(customers.phone, identity.phone));
  if (identity.email) predicates.push(eq(customers.email, identity.email));
  if (!predicates.length) return null;

  const [customer] = await getDb()
    .select()
    .from(customers)
    .where(predicates.length === 1 ? predicates[0] : or(...predicates))
    .orderBy(desc(customers.createdAt))
    .limit(1);

  return customer ?? null;
}

export async function getCustomer(customerId: string) {
  const [customer] = await getDb()
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  return customer ?? null;
}

export async function setStripeCustomerId(customerId: string, stripeCustomerId: string) {
  const [customer] = await getDb()
    .update(customers)
    .set({ stripeCustomerId, updatedAt: new Date() })
    .where(eq(customers.id, customerId))
    .returning();
  return customer ?? null;
}

export type CreateVehicleInput = {
  customerId: string;
  vin?: string | null;
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  engine?: string | null;
  oilType?: string | null;
  oilCapacityQuarts?: string | null;
  notes?: string | null;
};

export async function createVehicle(input: CreateVehicleInput) {
  const [vehicle] = await getDb()
    .insert(vehicles)
    .values(input)
    .returning();
  return vehicle;
}

export async function listCustomerVehicles(customerId: string) {
  return getDb()
    .select()
    .from(vehicles)
    .where(eq(vehicles.customerId, customerId))
    .orderBy(desc(vehicles.createdAt));
}

export async function findVehicleForCustomer(customerId: string, vehicleId: string) {
  const [vehicle] = await getDb()
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.customerId, customerId), eq(vehicles.id, vehicleId)))
    .limit(1);
  return vehicle ?? null;
}
