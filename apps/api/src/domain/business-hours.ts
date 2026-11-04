import { Temporal } from "@js-temporal/polyfill";

export const TIME_ZONE = "America/New_York";

const SLOT_MINUTES = 30;

export interface BusinessDayWindow {
  openHour: number;
  closeHour: number;
}

/**
 * MOMS business hours in America/New_York — winter schedule (Ty's ruling,
 * 2026-11-03). Keyed by ISO weekday (Temporal `dayOfWeek`: 1 = Monday …
 * 7 = Sunday). A `null` window means the business is closed that day and no
 * slots are offered. Season changes are a one-place edit: update this map.
 */
export const BUSINESS_HOURS: Record<number, BusinessDayWindow | null> = {
  1: { openHour: 8, closeHour: 16 }, // Monday
  2: { openHour: 8, closeHour: 16 }, // Tuesday
  3: { openHour: 8, closeHour: 16 }, // Wednesday
  4: { openHour: 8, closeHour: 16 }, // Thursday
  5: { openHour: 8, closeHour: 16 }, // Friday
  6: { openHour: 10, closeHour: 14 }, // Saturday
  7: null, // Sunday — closed
};

/** The booking window for a local date (YYYY-MM-DD), or null when closed. */
export function businessWindowForDate(date: string): BusinessDayWindow | null {
  const dayOfWeek = Temporal.PlainDate.from(date).dayOfWeek;
  return BUSINESS_HOURS[dayOfWeek] ?? null;
}

function atLocalHour(date: string, hour: number) {
  return Temporal.ZonedDateTime.from(
    `${date}T${String(hour).padStart(2, "0")}:00:00[${TIME_ZONE}]`,
  );
}

/**
 * Candidate slots for a date at the given service duration, before
 * appointment-conflict filtering. Empty on days the business is closed.
 */
export function candidateSlotsForDate(
  date: string,
  durationMinutes: number,
): { start: Date; end: Date }[] {
  const window = businessWindowForDate(date);
  if (!window) return [];

  const open = atLocalHour(date, window.openHour);
  const close = atLocalHour(date, window.closeHour);
  const slots: { start: Date; end: Date }[] = [];

  for (
    let cursor = open;
    Temporal.ZonedDateTime.compare(
      cursor.add({ minutes: durationMinutes }),
      close,
    ) <= 0;
    cursor = cursor.add({ minutes: SLOT_MINUTES })
  ) {
    const end = cursor.add({ minutes: durationMinutes });
    slots.push({
      start: new Date(cursor.epochMilliseconds),
      end: new Date(end.epochMilliseconds),
    });
  }

  return slots;
}
