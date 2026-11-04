import { getService } from "../repositories/services.js";
import { hasAppointmentConflict } from "../repositories/availability.js";
import { TIME_ZONE, candidateSlotsForDate } from "./business-hours.js";

export {
  BUSINESS_HOURS,
  businessWindowForDate,
  candidateSlotsForDate,
} from "./business-hours.js";
export type { BusinessDayWindow } from "./business-hours.js";

export async function getAvailability(input: {
  serviceId: string;
  date: string;
}) {
  const service = await getService(input.serviceId);
  if (!service || !service.active) return null;

  const slots: { start: string; end: string }[] = [];

  for (const candidate of candidateSlotsForDate(
    input.date,
    service.defaultDurationMinutes,
  )) {
    if (!(await hasAppointmentConflict(candidate.start, candidate.end))) {
      slots.push({
        start: candidate.start.toISOString(),
        end: candidate.end.toISOString(),
      });
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
