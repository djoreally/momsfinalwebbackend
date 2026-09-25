import { getStripe } from "../integrations/stripe.js";
import { calculateTax } from "./tax.js";
import { getAppointment } from "../repositories/appointments.js";
import { getBooking } from "../repositories/bookings.js";
import { getCustomer, setStripeCustomerId } from "../repositories/customer-vehicle.js";
import { createPayment, attachPaymentIntent, getPaymentByAppointment, getPaymentByBooking, setPaymentMethodState } from "../repositories/payments.js";
import { getSql } from "../../../../packages/db/src/index.js";

export async function prepareAppointmentPayment(appointmentId: string) {
  const appointment = await getAppointment(appointmentId);
  if (!appointment) return null;

  const customer = await getCustomer(appointment.customerId);
  if (!customer) return null;

  let payment = await getPaymentByAppointment(appointment.id);
  if (!payment) payment = await createPayment({ appointmentId: appointment.id, amountCents: appointment.quotedPriceCents });

  const stripe = getStripe();
  let stripeCustomerId = customer.stripeCustomerId;
  if (!stripeCustomerId) {
    const stripeCustomer = await stripe.customers.create({
      name: [customer.firstName, customer.lastName].filter(Boolean).join(" "),
      email: customer.email ?? undefined,
      phone: customer.phone,
      metadata: { moms_customer_id: customer.id },
    }, { idempotencyKey: `moms-customer-${customer.id}` });
    stripeCustomerId = stripeCustomer.id;
    await setStripeCustomerId(customer.id, stripeCustomerId);
  }

  const tax = await calculateTax({
    amountCents: appointment.quotedPriceCents,
    reference: appointment.id,
    address: {
      line1: appointment.serviceAddressLine1,
      line2: appointment.serviceAddressLine2,
      city: appointment.serviceCity,
      state: appointment.serviceState,
      postalCode: appointment.servicePostalCode,
      country: "US",
    },
  });

  const intent = await stripe.paymentIntents.create({
    amount: tax.totalCents,
    currency: "usd",
    customer: stripeCustomerId,
    automatic_payment_methods: { enabled: true },
    metadata: {
      moms_customer_id: customer.id,
      moms_appointment_id: appointment.id,
      moms_payment_id: payment.id,
      stripe_tax_calculation_id: tax.calculationId,
    },
    hooks: { inputs: { tax: { calculation: tax.calculationId } } },
  }, { idempotencyKey: `moms-payment-${payment.id}` });

  await attachPaymentIntent(payment.id, intent.id, tax.totalCents);

  return {
    paymentId: payment.id,
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret,
    subtotalCents: tax.subtotalCents,
    taxCents: tax.taxCents,
    totalCents: tax.totalCents,
    currency: "usd" as const,
  };
}


export async function chooseBookingPayment(bookingId: string, method: "pay_now" | "pay_at_appointment") {
  const settingRows=await getSql()("SELECT value FROM moms_ops.operational_settings WHERE key='payments' LIMIT 1");
  const settings=(settingRows[0]?.value as {allowPayNow?:boolean;allowPayAtAppointment?:boolean}|undefined)??{allowPayNow:true,allowPayAtAppointment:true};
  if(method==="pay_now"&&settings.allowPayNow===false)throw new Error("payment_method_disabled");
  if(method==="pay_at_appointment"&&settings.allowPayAtAppointment===false)throw new Error("payment_method_disabled");
  const booking = await getBooking(bookingId);
  if (!booking) return null;
  const customer = await getCustomer(booking.customerId);
  if (!customer) return null;

  let payment = await getPaymentByBooking(booking.id);

  if (method === "pay_at_appointment") {
    if (payment?.stripePaymentIntentId) {
      const existingIntent = await getStripe().paymentIntents.retrieve(payment.stripePaymentIntentId);
      if (existingIntent.status === "succeeded") throw new Error("booking_already_paid");
      if (existingIntent.status !== "canceled") await getStripe().paymentIntents.cancel(existingIntent.id);
    }
    if (!payment) {
      payment = await createPayment({ bookingId: booking.id, amountCents: booking.quotedTotalCents, status: "due_at_appointment" });
    } else {
      payment = await setPaymentMethodState(payment.id, "due_at_appointment", null, booking.quotedTotalCents);
    }
    return { method, paymentId: payment.id, totalCents: booking.quotedTotalCents, currency: "usd" as const };
  }

  if (!payment) payment = await createPayment({ bookingId: booking.id, amountCents: booking.quotedTotalCents });

  const stripe = getStripe();
  if (payment.stripePaymentIntentId) {
    const existingIntent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
    if (existingIntent.status !== "canceled") {
      return {
        method, paymentId: payment.id, paymentIntentId: existingIntent.id,
        clientSecret: existingIntent.client_secret, totalCents: existingIntent.amount,
        currency: "usd" as const, reused: true,
      };
    }
  }

  let stripeCustomerId = customer.stripeCustomerId;
  if (!stripeCustomerId) {
    const stripeCustomer = await stripe.customers.create({
      name: [customer.firstName, customer.lastName].filter(Boolean).join(" "),
      email: customer.email ?? undefined, phone: customer.phone,
      metadata: { moms_customer_id: customer.id },
    }, { idempotencyKey: `moms-customer-${customer.id}` });
    stripeCustomerId = stripeCustomer.id;
    await setStripeCustomerId(customer.id, stripeCustomerId);
  }

  const tax = await calculateTax({
    amountCents: booking.quotedTotalCents, reference: booking.id,
    address: { line1: booking.serviceAddressLine1, line2: booking.serviceAddressLine2,
      city: booking.serviceCity, state: booking.serviceState,
      postalCode: booking.servicePostalCode, country: "US" },
  });

  const intent = await stripe.paymentIntents.create({
    amount: tax.totalCents, currency: "usd", customer: stripeCustomerId,
    automatic_payment_methods: { enabled: true },
    metadata: { moms_customer_id: customer.id, moms_booking_id: booking.id,
      moms_payment_id: payment.id, stripe_tax_calculation_id: tax.calculationId },
    hooks: { inputs: { tax: { calculation: tax.calculationId } } },
  }, { idempotencyKey: `moms-booking-payment-${payment.id}-${tax.totalCents}` });

  payment = await attachPaymentIntent(payment.id, intent.id, tax.totalCents);
  return { method, paymentId: payment.id, paymentIntentId: intent.id, clientSecret: intent.client_secret,
    subtotalCents: tax.subtotalCents, taxCents: tax.taxCents, totalCents: tax.totalCents, currency: "usd" as const, reused: false };
}
