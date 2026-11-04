import { Temporal } from "@js-temporal/polyfill";

export const REPORT_TIME_ZONE = "America/New_York";

export type ReportPeriod = "daily" | "weekly" | "monthly";

export interface ReportPeriodRange {
  period: ReportPeriod;
  /** Inclusive period boundary as an ISO timestamp. */
  start: string;
  /** Exclusive period boundary as an ISO timestamp. */
  end: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function startOfDay(date: Temporal.PlainDate): Temporal.ZonedDateTime {
  return Temporal.ZonedDateTime.from(
    `${date.toString()}T00:00:00[${REPORT_TIME_ZONE}]`,
  );
}

function toIsoBoundary(date: Temporal.PlainDate): string {
  return new Date(startOfDay(date).epochMilliseconds).toISOString();
}

/**
 * Resolve a daily, Monday-Sunday weekly, or calendar-month period containing
 * the supplied America/New_York calendar date. The returned end is exclusive,
 * which keeps daylight-saving transition days at their true 23/25-hour length.
 */
export function resolveReportPeriodRange(
  period: ReportPeriod,
  anchor: string,
): ReportPeriodRange | null {
  if (!DATE_PATTERN.test(anchor)) return null;

  let anchorDate: Temporal.PlainDate;
  try {
    anchorDate = Temporal.PlainDate.from(anchor, { overflow: "reject" });
  } catch {
    return null;
  }

  let startDate: Temporal.PlainDate;
  let endDate: Temporal.PlainDate;

  switch (period) {
    case "daily":
      startDate = anchorDate;
      endDate = anchorDate.add({ days: 1 });
      break;
    case "weekly":
      // Temporal dayOfWeek is Monday=1 through Sunday=7.
      startDate = anchorDate.subtract({ days: anchorDate.dayOfWeek - 1 });
      endDate = startDate.add({ days: 7 });
      break;
    case "monthly":
      startDate = anchorDate.with({ day: 1 });
      endDate = startDate.add({ months: 1 });
      break;
  }

  return {
    period,
    start: toIsoBoundary(startDate),
    end: toIsoBoundary(endDate),
  };
}
