import { eq } from "drizzle-orm";
import { getDb, payments } from "../../../../packages/db/src/index.js";

export async function createPayment(input: { appointmentId?: string | null; bookingId?: string | null; amountCents: number; status?: string }) {
  const [payment] = await getDb().insert(payments).values({
    appointmentId: input.appointmentId ?? null,
    bookingId: input.bookingId ?? null,
    amountCents: input.amountCents,
    currency: "usd",
    status: input.status ?? "pending",
  }).returning();
  return payment;
}

export async function attachPaymentIntent(paymentId: string, stripePaymentIntentId: string, amountCents: number) {
  const [payment] = await getDb().update(payments).set({
    stripePaymentIntentId,
    amountCents,
    updatedAt: new Date(),
  }).where(eq(payments.id, paymentId)).returning();
  return payment;
}

export async function getPaymentByBooking(bookingId: string) {
  const [payment] = await getDb().select().from(payments).where(eq(payments.bookingId, bookingId)).limit(1);
  return payment ?? null;
}

export async function getPaymentByAppointment(appointmentId: string) {
  const [payment] = await getDb().select().from(payments).where(eq(payments.appointmentId, appointmentId)).limit(1);
  return payment ?? null;
}

export async function updatePaymentStatusByIntent(stripePaymentIntentId: string, status: string, paidAt?: Date | null) {
  const [payment] = await getDb().update(payments).set({
    status,
    paidAt: paidAt ?? null,
    updatedAt: new Date(),
  }).where(eq(payments.stripePaymentIntentId, stripePaymentIntentId)).returning();
  return payment ?? null;
}

export async function setPaymentMethodState(paymentId: string, status: string, stripePaymentIntentId: string | null, amountCents: number) {
  const [payment] = await getDb().update(payments).set({
    status,
    stripePaymentIntentId,
    amountCents,
    paidAt: null,
    updatedAt: new Date(),
  }).where(eq(payments.id, paymentId)).returning();
  return payment;
}
