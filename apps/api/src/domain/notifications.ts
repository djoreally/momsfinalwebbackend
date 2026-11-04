import { randomBytes } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";

/**
 * Pure/notification-domain helpers for the booking notifications
 * feature (spec: booking-notifications-spec-2026-11-04, decisions
 * D1–D4). Everything in this module is deterministic and DB-free so it
 * can be unit-tested directly; side effects live in
 * services/notifications.ts behind injected dependencies.
 */

export const TIME_ZONE = "America/New_York";

/**
 * The customer's credential for the /appointment/<token> page: 32
 * random bytes, base64url (43 chars). Minted once at booking creation;
 * the booking UUID stays a mere reference and is never the write
 * credential.
 */
export function generateManageToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * D4: nothing customer-facing is sent between 21:00 and 08:00
 * America/New_York. A reminder whose moment lands inside quiet hours
 * is held (its log row stays pending) and goes out on the first sweep
 * at or after 08:00.
 */
export function isQuietHours(at: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(at),
  );
  return hour >= 21 || hour < 8;
}

export type ReminderMoment = "reminder_24h" | "reminder_1h";

/** D1: both reminders, in firing order. */
export const REMINDER_MOMENTS: readonly ReminderMoment[] = ["reminder_24h", "reminder_1h"];

const MOMENT_OFFSET_MS: Record<ReminderMoment, number> = {
  reminder_24h: 24 * 60 * 60_000,
  reminder_1h: 60 * 60_000,
};

export type MomentState = "not_due" | "due" | "expired";

/**
 * Where a reminder moment stands for a booking at `now`:
 * - not_due: the moment's threshold (start − 24h / start − 1h) is ahead.
 * - due: threshold reached and the appointment is still in the future.
 * - expired: the appointment time has passed — the moment is never
 *   sent late; the sweep records it as expired instead.
 */
export function reminderMomentState(scheduledStart: Date, moment: ReminderMoment, now: Date): MomentState {
  if (now.getTime() >= scheduledStart.getTime()) return "expired";
  if (now.getTime() >= scheduledStart.getTime() - MOMENT_OFFSET_MS[moment]) return "due";
  return "not_due";
}

/** Interpret a wall-clock date + time in America/New_York as a Date. */
export function zonedDateTimeToDate(date: string, time: string, timeZone: string = TIME_ZONE): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const zdt = Temporal.ZonedDateTime.from({
    timeZone,
    year,
    month,
    day,
    hour,
    minute,
    second: 0,
  });
  return new Date(zdt.epochMilliseconds);
}

/** Structural minimum of a getBooking() result this module works with. */
export type BookingLike = {
  id: unknown;
  status: unknown;
  scheduledStart: Date | string;
  scheduledEnd: Date | string;
  serviceAddressLine1: string;
  serviceAddressLine2?: string | null;
  serviceCity: string;
  serviceState: string;
  servicePostalCode: string;
  quotedTotalCents: number;
  manageToken?: string | null;
  swManagementToken?: string | null;
  customer?: { firstName?: string | null } | null;
  jobs?: Array<{
    quotedPriceCents: number;
    vehicle: { year: number; make: string; model: string };
    service: { name: string };
  }>;
};

export type AppointmentView = {
  bookingId: string;
  status: string;
  scheduledStart: string;
  scheduledEnd: string;
  serviceAddressLine1: string;
  serviceAddressLine2: string | null;
  serviceCity: string;
  serviceState: string;
  servicePostalCode: string;
  quotedTotalCents: number;
  jobs: Array<{ serviceName: string; vehicleLabel: string; priceCents: number }>;
  customerFirstName: string;
  canReschedule: boolean;
};

/**
 * The customer-safe shape behind GET /v1/appointments/by-token/:token.
 * Built by whitelisting: sw_management_token, the manage token itself,
 * and customer email/phone can never leak through this view.
 */
export function shapeAppointmentView(booking: BookingLike): AppointmentView {
  const closed = ["cancelled", "completed"].includes(String(booking.status));
  return {
    bookingId: String(booking.id),
    status: String(booking.status),
    scheduledStart: new Date(booking.scheduledStart).toISOString(),
    scheduledEnd: new Date(booking.scheduledEnd).toISOString(),
    serviceAddressLine1: booking.serviceAddressLine1,
    serviceAddressLine2: booking.serviceAddressLine2 ?? null,
    serviceCity: booking.serviceCity,
    serviceState: booking.serviceState,
    servicePostalCode: booking.servicePostalCode,
    quotedTotalCents: booking.quotedTotalCents,
    jobs: (booking.jobs ?? []).map((job) => ({
      serviceName: job.service.name,
      vehicleLabel: [job.vehicle.year, job.vehicle.make, job.vehicle.model].filter(Boolean).join(" "),
      priceCents: job.quotedPriceCents,
    })),
    customerFirstName: booking.customer?.firstName ?? "",
    canReschedule: Boolean(booking.swManagementToken) && !closed,
  };
}

export const RESCHEDULE_NOT_AVAILABLE_CODE = "RESCHEDULE_NOT_AVAILABLE";
export const RESCHEDULE_NOT_AVAILABLE_MESSAGE =
  "Online rescheduling is not available for this booking yet — call (215) 767-2125 and we will move it for you.";

export type RescheduleDeps = {
  loadBookingByToken: (token: string) => Promise<BookingLike | null>;
  callSwReschedule: (input: {
    managementToken: string;
    newDate: string;
    newTime: string;
  }) => Promise<{ success: boolean; message?: string }>;
  updateBookingSchedule: (bookingId: string, scheduledStart: Date, scheduledEnd: Date) => Promise<void>;
  notifyChanged: (booking: BookingLike) => Promise<void>;
};

export type RescheduleOutcome =
  | { kind: "not_found" }
  | { kind: "not_available" }
  | { kind: "sw_failed"; message: string }
  | { kind: "success"; scheduledStart: string; scheduledEnd: string };

/**
 * The reschedule write path (D2): Service Writer moves first (it owns
 * slot validation); only on its success does the website booking row
 * move to the same time — both records move, or neither does. The
 * "Changed" confirmation is ours to send because Service Writer's
 * token path is notification-silent. The original appointment duration
 * is preserved.
 */
export async function performReschedule(
  deps: RescheduleDeps,
  token: string,
  input: { newDate: string; newTime: string },
): Promise<RescheduleOutcome> {
  const booking = await deps.loadBookingByToken(token);
  if (!booking) return { kind: "not_found" };
  const managementToken = booking.swManagementToken;
  if (!managementToken) return { kind: "not_available" };

  const sw = await deps.callSwReschedule({
    managementToken,
    newDate: input.newDate,
    newTime: input.newTime,
  });
  if (!sw.success) {
    return { kind: "sw_failed", message: sw.message ?? "Service Writer could not move this appointment." };
  }

  const durationMs = new Date(booking.scheduledEnd).getTime() - new Date(booking.scheduledStart).getTime();
  const scheduledStart = zonedDateTimeToDate(input.newDate, input.newTime);
  const scheduledEnd = new Date(scheduledStart.getTime() + durationMs);
  await deps.updateBookingSchedule(String(booking.id), scheduledStart, scheduledEnd);
  await deps.notifyChanged({ ...booking, scheduledStart, scheduledEnd });
  return { kind: "success", scheduledStart: scheduledStart.toISOString(), scheduledEnd: scheduledEnd.toISOString() };
}
