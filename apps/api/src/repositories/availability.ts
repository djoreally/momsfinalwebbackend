import { and, lt, gt, notInArray } from "drizzle-orm";
import { appointments, getDb } from "@moms/db";

const blockingStatuses = ["pending", "confirmed", "in_progress"];

export async function hasAppointmentConflict(start: Date, end: Date) {
  const [conflict] = await getDb()
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        lt(appointments.scheduledStart, end),
        gt(appointments.scheduledEnd, start),
        notInArray(appointments.status, ["cancelled", "cannot_complete"]),
      ),
    )
    .limit(1);

  return Boolean(conflict);
}

export { blockingStatuses };
