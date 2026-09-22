import { Temporal } from "@js-temporal/polyfill";
import { getService } from "../repositories/services.js";
import { hasAppointmentConflict } from "../repositories/availability.js";

const SLOT_MINUTES = 30;
const OPEN_HOUR = 8;
const CLOSE_HOUR = 17;
const TIME_ZONE = "America/New_York";

function atLocalHour(date: string, hour: number) {
  return Temporal.ZonedDateTime.from(
    `${date}T${String(hour).padStart(2, "0")}:00:00[${TIME_ZONE}]`,
  );
}

export async function getAvailability(input: {
  serviceId: string;
  date: string;
}) {
  const service = await getService(input.serviceId);
  if (!service || !service.active) return null;

  const open = atLocalHour(input.date, OPEN_HOUR);
  const close = atLocalHour(input.date, CLOSE_HOUR);
  const slots = [];

  for (
    let cursor = open;
    Temporal.ZonedDateTime.compare(
      cursor.add({ minutes: service.defaultDurationMinutes }),
      close,
    ) <= 0;
    cursor = cursor.add({ minutes: SLOT_MINUTES })
  ) {
    const end = cursor.add({ minutes: service.defaultDurationMinutes });
    const startDate = new Date(cursor.epochMilliseconds);
    const endDate = new Date(end.epochMilliseconds);
    if (!(await hasAppointmentConflict(startDate, endDate))) {
      slots.push({ start: startDate.toISOString(), end: endDate.toISOString() });
    }
  }

  return {
    serviceId: service.id,
    date: input.date,
    durationMinutes: service.defaultDurationMinutes,
    timezone: TIME_ZONE,
    slots,
  };
}
