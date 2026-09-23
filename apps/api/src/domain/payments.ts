import { getStripe } from "../integrations/stripe.js";
import { calculateTax } from "./tax.js";
import { getAppointment } from "../repositories/appointments.js";
import { getBooking } from "../repositories/bookings.js";
import { getCustomer, setStripeCustomerId } from "../repositories/customer-vehicle.js";
import { createPayment, attachPaymentIntent, getPaymentByAppointment, getPaymentByBooking } from "../repositories/payments.js";

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
  const booking = await getBooking(bookingId);
  if (!booking) return null;
  const customer = await getCustomer(booking.customerId);
  if (!customer) return null;

  let payment = await getPaymentByBooking(booking.id);
  if (method === "pay_at_appointment") {
    if (!payment) payment = await createPayment({ bookingId: booking.id, amountCents: booking.quotedTotalCents, status: "due_at_appointment" });
    return { method, paymentId: payment.id, totalCents: booking.quotedTotalCents, currency: "usd" as const };
  }

  if (!payment) payment = await createPayment({ bookingId: booking.id, amountCents: booking.quotedTotalCents });

  let stripeCustomerId = customer.stripeCustomerId;
  const stripe = getStripe();
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
    amountCents: booking.quotedTotalCents,
    reference: booking.id,
    address: {
      line1: booking.serviceAddressLine1, line2: booking.serviceAddressLine2,
      city: booking.serviceCity, state: booking.serviceState,
      postalCode: booking.servicePostalCode, country: "US",
    },
  });

  const intent = await stripe.paymentIntents.create({
    amount: tax.totalCents, currency: "usd", customer: stripeCustomerId,
    automatic_payment_methods: { enabled: true },
    metadata: {
      moms_customer_id: customer.id, moms_booking_id: booking.id,
      moms_payment_id: payment.id, stripe_tax_calculation_id: tax.calculationId,
    },
    hooks: { inputs: { tax: { calculation: tax.calculationId } } },
  }, { idempotencyKey: `moms-booking-payment-${payment.id}` });

  await attachPaymentIntent(payment.id, intent.id, tax.totalCents);
  return { method, paymentId: payment.id, paymentIntentId: intent.id, clientSecret: intent.client_secret,
    subtotalCents: tax.subtotalCents, taxCents: tax.taxCents, totalCents: tax.totalCents, currency: "usd" as const };
}
