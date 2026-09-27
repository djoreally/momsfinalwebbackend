import { and, gt, inArray, lt } from "drizzle-orm";
import { appointments, bookings, getDb } from "../../../../packages/db/src/index.js";

const blockingStatuses = ["pending", "confirmed", "en_route", "arrived", "in_progress"];

export async function hasAppointmentConflict(start: Date, end: Date) {
  const db = getDb();
  const [legacyConflict, bookingConflict] = await Promise.all([
    db
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          lt(appointments.scheduledStart, end),
          gt(appointments.scheduledEnd, start),
          inArray(appointments.status, blockingStatuses),
        ),
      )
      .limit(1),
    db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          lt(bookings.scheduledStart, end),
          gt(bookings.scheduledEnd, start),
          inArray(bookings.status, blockingStatuses),
        ),
      )
      .limit(1),
  ]);

  return Boolean(legacyConflict[0] || bookingConflict[0]);
}

export { blockingStatuses };
