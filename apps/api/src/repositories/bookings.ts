import { asc, eq } from "drizzle-orm";
import { bookingJobs, bookings, getDb } from "../../../../packages/db/src/index.js";

export type CreateBookingInput = {
  customerId: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  serviceAddressLine1: string;
  serviceAddressLine2?: string | null;
  serviceCity: string;
  serviceState: string;
  servicePostalCode: string;
  quotedTotalCents: number;
  notes?: string | null;
  jobs: Array<{
    vehicleId: string;
    serviceId: string;
    quotedPriceCents: number;
    durationMinutes: number;
    position: number;
  }>;
};

export async function createBooking(input: CreateBookingInput) {
  return getDb().transaction(async (tx) => {
    const [booking] = await tx.insert(bookings).values({
      customerId: input.customerId,
      status: "pending",
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd,
      serviceAddressLine1: input.serviceAddressLine1,
      serviceAddressLine2: input.serviceAddressLine2,
      serviceCity: input.serviceCity,
      serviceState: input.serviceState,
      servicePostalCode: input.servicePostalCode,
      quotedTotalCents: input.quotedTotalCents,
      notes: input.notes,
    }).returning();

    const jobs = await tx.insert(bookingJobs).values(input.jobs.map((job) => ({
      ...job,
      bookingId: booking.id,
      status: "pending",
    }))).returning();

    return { ...booking, jobs };
  });
}

export async function getBooking(bookingId: string) {
  const [booking] = await getDb().select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking) return null;
  const jobs = await getDb().select().from(bookingJobs).where(eq(bookingJobs.bookingId, bookingId)).orderBy(asc(bookingJobs.position));
  return { ...booking, jobs };
}
