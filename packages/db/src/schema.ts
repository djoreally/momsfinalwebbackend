import {
  boolean,
  index,
  integer,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * MOMS operational data lives in its own PostgreSQL schema.
 * Existing public website/newsletter/telemetry tables are intentionally
 * outside this package's ownership.
 */
export const momsOps = pgSchema("moms_ops");

export const customers = momsOps.table(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone").notNull(),
    addressLine1: text("address_line_1"),
    addressLine2: text("address_line_2"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    marketingConsent: boolean("marketing_consent").default(false).notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("customers_phone_idx").on(table.phone),
    index("customers_email_idx").on(table.email),
    uniqueIndex("customers_stripe_customer_unique").on(table.stripeCustomerId),
  ],
);

export const vehicles = momsOps.table(
  "vehicles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    vin: text("vin"),
    year: integer("year").notNull(),
    make: text("make").notNull(),
    model: text("model").notNull(),
    trim: text("trim"),
    engine: text("engine"),
    oilType: text("oil_type"),
    oilCapacityQuarts: numeric("oil_capacity_quarts", { precision: 5, scale: 2 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("vehicles_customer_idx").on(table.customerId),
    uniqueIndex("vehicles_vin_unique").on(table.vin),
  ],
);

export const services = momsOps.table(
  "services",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    basePriceCents: integer("base_price_cents").notNull(),
    defaultDurationMinutes: integer("default_duration_minutes").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("services_slug_unique").on(table.slug)],
);

export const appointments = momsOps.table(
  "appointments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    status: text("status").default("pending").notNull(),
    scheduledStart: timestamp("scheduled_start", { withTimezone: true }).notNull(),
    scheduledEnd: timestamp("scheduled_end", { withTimezone: true }).notNull(),
    serviceAddressLine1: text("service_address_line_1").notNull(),
    serviceAddressLine2: text("service_address_line_2"),
    serviceCity: text("service_city").notNull(),
    serviceState: text("service_state").notNull(),
    servicePostalCode: text("service_postal_code").notNull(),
    quotedPriceCents: integer("quoted_price_cents").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("appointments_customer_idx").on(table.customerId),
    index("appointments_vehicle_idx").on(table.vehicleId),
    index("appointments_schedule_idx").on(table.scheduledStart),
    index("appointments_status_idx").on(table.status),
  ],
);

export const payments = momsOps.table(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "restrict" }),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    status: text("status").default("pending").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").default("usd").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("payments_appointment_idx").on(table.appointmentId),
    uniqueIndex("payments_stripe_payment_intent_unique").on(table.stripePaymentIntentId),
  ],
);
