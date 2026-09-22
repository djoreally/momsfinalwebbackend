import { getService } from "../repositories/services";
import { hasAppointmentConflict } from "../repositories/availability";

const SLOT_MINUTES = 30;
const OPEN_HOUR = 8;
const CLOSE_HOUR = 17;

function atLocalHour(date: string, hour: number) {
  // Scheduling policy is currently fixed to MOMS' operating timezone.
  return new Date(`${date}T${String(hour).padStart(2, "0")}:00:00-04:00`);
}

export async function getAvailability(input: {
  serviceId: string;
  date: string;
}) {
  const service = await getService(input.serviceId);
  if (!service || !service.active) return null;

  const open = atLocalHour(input.date, OPEN_HOUR);
  const close = atLocalHour(input.date, CLOSE_HOUR);
  const durationMs = service.defaultDurationMinutes * 60_000;
  const slots = [];

  for (let cursor = open.getTime(); cursor + durationMs <= close.getTime(); cursor += SLOT_MINUTES * 60_000) {
    const start = new Date(cursor);
    const end = new Date(cursor + durationMs);
    if (!(await hasAppointmentConflict(start, end))) {
      slots.push({ start: start.toISOString(), end: end.toISOString() });
    }
  }

  return {
    serviceId: service.id,
    date: input.date,
    durationMinutes: service.defaultDurationMinutes,
    timezone: "America/New_York",
    slots,
  };
}
