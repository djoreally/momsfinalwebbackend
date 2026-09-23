import {
  boolean,
  index,
  integer,
  jsonb,
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
    includedQuarts: numeric("included_quarts", { precision: 5, scale: 2 }),
    extraQuartPriceCents: integer("extra_quart_price_cents"),
    extraQuartWaivable: boolean("extra_quart_waivable").default(false).notNull(),
    processingFeePercent: numeric("processing_fee_percent", { precision: 5, scale: 2 }).default("0").notNull(),
    processingFeeWaivable: boolean("processing_fee_waivable").default(false).notNull(),
    defaultDurationMinutes: integer("default_duration_minutes").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("services_slug_unique").on(table.slug)],
);

export const bookings = momsOps.table(
  "bookings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "restrict" }),
    status: text("status").default("pending").notNull(),
    scheduledStart: timestamp("scheduled_start", { withTimezone: true }).notNull(),
    scheduledEnd: timestamp("scheduled_end", { withTimezone: true }).notNull(),
    serviceAddressLine1: text("service_address_line_1").notNull(),
    serviceAddressLine2: text("service_address_line_2"),
    serviceCity: text("service_city").notNull(),
    serviceState: text("service_state").notNull(),
    servicePostalCode: text("service_postal_code").notNull(),
    quotedTotalCents: integer("quoted_total_cents").default(0).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("bookings_customer_idx").on(table.customerId),
    index("bookings_schedule_idx").on(table.scheduledStart),
    index("bookings_status_idx").on(table.status),
  ],
);

export const bookingJobs = momsOps.table(
  "booking_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "restrict" }),
    vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "restrict" }),
    serviceId: uuid("service_id").notNull().references(() => services.id, { onDelete: "restrict" }),
    quotedPriceCents: integer("quoted_price_cents").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    position: integer("position").default(0).notNull(),
    status: text("status").default("pending").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("booking_jobs_booking_idx").on(table.bookingId),
    index("booking_jobs_vehicle_idx").on(table.vehicleId),
    index("booking_jobs_service_idx").on(table.serviceId),
    uniqueIndex("booking_jobs_booking_vehicle_service_unique").on(table.bookingId, table.vehicleId, table.serviceId),
  ],
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

export const serviceOrders = momsOps.table("service_orders",{id:uuid("id").defaultRandom().primaryKey(),appointmentId:uuid("appointment_id").notNull().references(()=>bookings.id,{onDelete:"restrict"}),customerId:uuid("customer_id").notNull().references(()=>customers.id,{onDelete:"restrict"}),vehicleId:uuid("vehicle_id").notNull().references(()=>vehicles.id,{onDelete:"restrict"}),status:text("status").default("confirmed").notNull(),notes:text("notes"),startedAt:timestamp("started_at",{withTimezone:true}),completedAt:timestamp("completed_at",{withTimezone:true}),createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),updatedAt:timestamp("updated_at",{withTimezone:true}).defaultNow().notNull()},t=>[index("service_orders_appointment_idx").on(t.appointmentId),index("service_orders_customer_idx").on(t.customerId),index("service_orders_vehicle_idx").on(t.vehicleId),index("service_orders_status_idx").on(t.status)]);

export const serviceOrderItems = momsOps.table("service_order_items",{id:uuid("id").defaultRandom().primaryKey(),serviceOrderId:uuid("service_order_id").notNull().references(()=>serviceOrders.id,{onDelete:"restrict"}),bookingJobId:uuid("booking_job_id").references(()=>bookingJobs.id,{onDelete:"restrict"}),serviceId:uuid("service_id").notNull().references(()=>services.id,{onDelete:"restrict"}),description:text("description").notNull(),quantity:numeric("quantity",{precision:10,scale:2}).default("1").notNull(),unitPriceCents:integer("unit_price_cents").notNull(),totalCents:integer("total_cents").notNull(),status:text("status").default("authorized").notNull(),notes:text("notes"),position:integer("position").default(0).notNull(),createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),updatedAt:timestamp("updated_at",{withTimezone:true}).defaultNow().notNull()},t=>[index("service_order_items_order_idx").on(t.serviceOrderId),index("service_order_items_service_idx").on(t.serviceId)]);

export const invoices = momsOps.table("invoices",{id:uuid("id").defaultRandom().primaryKey(),appointmentId:uuid("appointment_id").notNull().references(()=>bookings.id,{onDelete:"restrict"}),customerId:uuid("customer_id").notNull().references(()=>customers.id,{onDelete:"restrict"}),status:text("status").default("draft").notNull(),subtotalCents:integer("subtotal_cents").default(0).notNull(),taxCents:integer("tax_cents").default(0).notNull(),processingFeeCents:integer("processing_fee_cents").default(0).notNull(),totalCents:integer("total_cents").default(0).notNull(),amountPaidCents:integer("amount_paid_cents").default(0).notNull(),amountDueCents:integer("amount_due_cents").default(0).notNull(),currency:text("currency").default("usd").notNull(),issuedAt:timestamp("issued_at",{withTimezone:true}),dueAt:timestamp("due_at",{withTimezone:true}),paidAt:timestamp("paid_at",{withTimezone:true}),notes:text("notes"),createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),updatedAt:timestamp("updated_at",{withTimezone:true}).defaultNow().notNull()},t=>[index("invoices_appointment_idx").on(t.appointmentId),index("invoices_customer_idx").on(t.customerId),index("invoices_status_idx").on(t.status)]);

export const invoiceItems = momsOps.table("invoice_items",{id:uuid("id").defaultRandom().primaryKey(),invoiceId:uuid("invoice_id").notNull().references(()=>invoices.id,{onDelete:"restrict"}),serviceOrderItemId:uuid("service_order_item_id").references(()=>serviceOrderItems.id,{onDelete:"restrict"}),description:text("description").notNull(),quantity:numeric("quantity",{precision:10,scale:2}).default("1").notNull(),unitPriceCents:integer("unit_price_cents").notNull(),totalCents:integer("total_cents").notNull(),position:integer("position").default(0).notNull(),createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull()},t=>[index("invoice_items_invoice_idx").on(t.invoiceId)]);

export const payments = momsOps.table(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "restrict" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "restrict" }),
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "restrict" }),
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
    index("payments_booking_idx").on(table.bookingId),
    uniqueIndex("payments_booking_unique").on(table.bookingId),
    uniqueIndex("payments_stripe_payment_intent_unique").on(table.stripePaymentIntentId),
  ],
);


export const stripeMonetaryEvents = momsOps.table(
  "stripe_monetary_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    evidenceKey: text("evidence_key").notNull(),
    evidenceSource: text("evidence_source").default("webhook").notNull(),
    stripeEventId: text("stripe_event_id"),
    stripeEventType: text("stripe_event_type").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeChargeId: text("stripe_charge_id"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeBalanceTransactionId: text("stripe_balance_transaction_id"),
    momsBookingId: uuid("moms_booking_id").references(() => bookings.id, { onDelete: "restrict" }),
    momsCustomerId: uuid("moms_customer_id").references(() => customers.id, { onDelete: "restrict" }),
    momsPaymentId: uuid("moms_payment_id").references(() => payments.id, { onDelete: "restrict" }),
    correlationConfidence: text("correlation_confidence").default("unlinked").notNull(),
    attemptedCents: integer("attempted_cents").default(0).notNull(),
    grossCents: integer("gross_cents").default(0).notNull(),
    feeCents: integer("fee_cents").default(0).notNull(),
    netCents: integer("net_cents").default(0).notNull(),
    refundedCents: integer("refunded_cents").default(0).notNull(),
    currency: text("currency").default("usd").notNull(),
    intentStatus: text("intent_status"),
    paymentMethodType: text("payment_method_type"),
    walletType: text("wallet_type"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    cancellationReason: text("cancellation_reason"),
    radarRiskLevel: text("radar_risk_level"),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("stripe_monetary_events_evidence_key_unique").on(table.evidenceKey),
    uniqueIndex("stripe_monetary_events_stripe_event_unique").on(table.stripeEventId),
    index("stripe_monetary_events_booking_idx").on(table.momsBookingId),
    index("stripe_monetary_events_intent_idx").on(table.stripePaymentIntentId),
    index("stripe_monetary_events_status_idx").on(table.intentStatus),
    index("stripe_monetary_events_occurred_idx").on(table.occurredAt),
  ],
);
