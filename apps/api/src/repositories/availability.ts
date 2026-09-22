import { and, lt, gt, inArray } from "drizzle-orm";
import { appointments, getDb } from "../../../../packages/db/src/index.js";

const blockingStatuses = ["pending", "confirmed", "in_progress"];

export async function hasAppointmentConflict(start: Date, end: Date) {
  const [conflict] = await getDb()
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        lt(appointments.scheduledStart, end),
        gt(appointments.scheduledEnd, start),
        inArray(appointments.status, blockingStatuses),
      ),
    )
    .limit(1);

  return Boolean(conflict);
}

export { blockingStatuses };
