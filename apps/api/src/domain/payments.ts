import { getStripe } from "../integrations/stripe.js";
import { getAppointment } from "../repositories/appointments.js";
import { getBooking } from "../repositories/bookings.js";
import { getCustomer, setStripeCustomerId } from "../repositories/customer-vehicle.js";
import { createPayment, attachPaymentIntent, getPaymentByAppointment, getPaymentByBooking, setPaymentMethodState } from "../repositories/payments.js";

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

  // The quoted price already carries its own per-job tax component
  // (domain/pricing.ts), so the charge is the quoted price exactly. Stripe
  // Tax is deliberately NOT layered on top — doing so double-taxed the
  // customer and made the prepaid charge exceed the locked quote.
  const intent = await stripe.paymentIntents.create({
    amount: appointment.quotedPriceCents,
    currency: "usd",
    customer: stripeCustomerId,
    automatic_payment_methods: { enabled: true },
    metadata: {
      moms_customer_id: customer.id,
      moms_appointment_id: appointment.id,
      moms_payment_id: payment.id,
    },
  }, { idempotencyKey: `moms-payment-${payment.id}` });

  await attachPaymentIntent(payment.id, intent.id, appointment.quotedPriceCents);

  return {
    paymentId: payment.id,
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret,
    // The tax component is inside the quoted price (not stored separately
    // for appointments), so no additional tax is broken out here.
    subtotalCents: appointment.quotedPriceCents,
    taxCents: 0,
    totalCents: appointment.quotedPriceCents,
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

  // The quoted total already includes each job's tax component (persisted
  // per job on booking_jobs), so the charge is the quoted total exactly.
  // Stripe Tax is deliberately NOT layered on top — doing so double-taxed
  // the customer and made the prepaid charge exceed the locked quote.
  const taxCents = booking.jobs.reduce((sum, job) => sum + job.taxCents, 0);
  const totalCents = booking.quotedTotalCents;

  const intent = await stripe.paymentIntents.create({
    amount: totalCents, currency: "usd", customer: stripeCustomerId,
    automatic_payment_methods: { enabled: true },
    metadata: { moms_customer_id: customer.id, moms_booking_id: booking.id,
      moms_payment_id: payment.id },
  }, { idempotencyKey: `moms-booking-payment-${payment.id}-${totalCents}` });

  payment = await attachPaymentIntent(payment.id, intent.id, totalCents);
  return { method, paymentId: payment.id, paymentIntentId: intent.id, clientSecret: intent.client_secret,
    subtotalCents: totalCents - taxCents, taxCents, totalCents, currency: "usd" as const, reused: false };
}
