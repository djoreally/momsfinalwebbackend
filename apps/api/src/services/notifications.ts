import { sendWebPush } from "./web-push.js";
import { getBooking, updateBookingSchedule } from "../repositories/bookings.js";
import {
  claimNotificationRow,
  completeNotificationRow,
  ensureNotificationRow,
  expireNotificationRow,
  getBookingByManageToken,
  listActiveSubscriptionsForCustomer,
  listReminderCandidates,
  unsubscribePushSubscription,
  upsertPushSubscription,
  type NotificationChannel,
  type NotificationMoment,
  type PushSubscriptionRecord,
} from "../repositories/notifications.js";
import {
  isQuietHours,
  performReschedule,
  reminderMomentState,
  REMINDER_MOMENTS,
  type BookingLike,
  type RescheduleOutcome,
} from "../domain/notifications.js";

/**
 * Booking notifications engine (spec decisions D1–D4): T-24h and T-1h
 * reminders plus "Changed" confirmations, over email (Resend, the
 * booking-email.ts pattern) and Web Push (bonus layer). Every send is
 * recorded in moms_ops.booking_notifications; the UNIQUE
 * (booking_id, moment, channel) row is claimed pending -> sending
 * before anything is sent, so a moment can never fire twice.
 */

const FROM = "MOMS Mobile Oil Change <support@momsoilchange.com>";
const SITE = "https://momsoilchange.com";
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"} as Record<string,string>)[c]);

type FullBooking = NonNullable<Awaited<ReturnType<typeof getBooking>>>;

/* ---------------- subscriptions ---------------- */

export async function subscribePushSubscription(input: {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  bookingId?: string | null;
  manageToken?: string | null;
  userAgent?: string | null;
}): Promise<PushSubscriptionRecord> {
  let bookingId = input.bookingId ?? null;
  let customerId: string | null = null;
  if (input.manageToken) {
    const booking = await getBookingByManageToken(input.manageToken);
    if (booking) {
      bookingId = String(booking.id);
      customerId = String(booking.customerId);
    }
  } else if (bookingId) {
    const booking = await getBooking(bookingId);
    if (booking) customerId = String(booking.customerId);
  }
  return upsertPushSubscription({
    endpoint: input.subscription.endpoint,
    p256dh: input.subscription.keys.p256dh,
    auth: input.subscription.keys.auth,
    customerId,
    bookingId,
    userAgent: input.userAgent ?? null,
  });
}

export async function removePushSubscription(endpoint: string): Promise<boolean> {
  return unsubscribePushSubscription(endpoint);
}

/* ---------------- senders ---------------- */

async function sendResendEmail(input: {
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
}): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify({ from: FROM, to: [input.to], subject: input.subject, html: input.html }),
  });
  const data = await response.json().catch(() => ({})) as { id?: string; message?: string };
  if (!response.ok || !data.id) throw new Error(`resend_http_${response.status}:${data.message ?? "missing_provider_id"}`);
  return data.id;
}

function ensureVapid(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

async function sendPush(subscription: PushSubscriptionRecord, payload: object): Promise<void> {
  await sendWebPush(
    { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
    JSON.stringify(payload),
    {
      subject: "mailto:support@momsoilchange.com",
      publicKey: process.env.VAPID_PUBLIC_KEY ?? "",
      privateKey: process.env.VAPID_PRIVATE_KEY ?? "",
    },
  );
}

/* ---------------- copy ---------------- */

function notificationCopy(booking: FullBooking, moment: NotificationMoment) {
  const start = new Date(booking.scheduledStart);
  const when = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short", timeZone: "America/New_York" }).format(start);
  const time = new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: "America/New_York" }).format(start);
  const firstName = booking.customer?.firstName ?? "there";
  const jobs = booking.jobs.map(j => `<li>${esc(j.service.name)} — ${esc(j.vehicle.year)} ${esc(j.vehicle.make)} ${esc(j.vehicle.model)}</li>`).join("");
  const address = [booking.serviceAddressLine1, booking.serviceAddressLine2, booking.serviceCity, booking.serviceState, booking.servicePostalCode].filter(Boolean).map(esc).join(", ");
  const manage = booking.manageToken
    ? `<p><a href="${SITE}/appointment/${esc(booking.manageToken)}">Manage your appointment</a> — view your booking or move it to another time.</p>`
    : "";
  const headline = moment === "changed" ? "Your MOMS appointment has moved" : "Your MOMS appointment reminder";
  const intro =
    moment === "reminder_24h" ? `Hi ${esc(firstName)}, a reminder that your appointment is tomorrow.`
    : moment === "reminder_1h" ? `Hi ${esc(firstName)}, a reminder about your appointment today.`
    : `Hi ${esc(firstName)}, your appointment has been moved. Here are the new details.`;
  const subject =
    moment === "reminder_24h" ? `Reminder: your MOMS appointment is tomorrow — ${when}`
    : moment === "reminder_1h" ? `Today: your MOMS appointment at ${time}`
    : `Your MOMS appointment has moved — ${when}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#111"><h1>${headline}</h1><p>${intro}</p><p><strong>Date:</strong> ${esc(when)}</p><ul>${jobs}</ul><p><strong>Address:</strong> ${address}</p>${manage}<p>MOMS Mobile Oil Change · Established 2013</p></div>`;
  const pushBody =
    moment === "reminder_24h" ? `Reminder: your oil change is tomorrow at ${time}.`
    : moment === "reminder_1h" ? `Your oil change is today at ${time} — see you soon.`
    : `Your appointment moved to ${when}. Tap for details.`;
  return { subject, html, pushTitle: "MOMS Mobile Oil Change", pushBody };
}

/* ---------------- logged delivery ---------------- */

/**
 * Send one (booking, moment, channel) exactly once: ensure the log
 * row, claim it (pending -> sending), send, write the outcome back.
 * A row in any other state is left alone — that is the fire-once
 * guarantee the sweep and the reschedule path both rely on.
 */
async function deliverLogged(
  booking: FullBooking,
  moment: NotificationMoment,
  channel: NotificationChannel,
  subscriptions?: PushSubscriptionRecord[],
): Promise<{ status: string }> {
  const bookingId = String(booking.id);
  const row = await ensureNotificationRow(bookingId, moment, channel);
  if (row.status !== "pending") return { status: row.status };
  if (!(await claimNotificationRow(row.id))) return { status: "claimed_elsewhere" };
  try {
    if (channel === "email") {
      const email = booking.customer?.email;
      if (!email) throw new Error("customer_email_missing");
      const copy = notificationCopy(booking, moment);
      const providerId = await sendResendEmail({
        to: email,
        subject: copy.subject,
        html: copy.html,
        idempotencyKey: `moms-notification-${bookingId}-${moment}`,
      });
      await completeNotificationRow(row.id, { status: "sent", providerMessageId: providerId });
      return { status: "sent" };
    }
    // push
    const subs = subscriptions ?? (await listActiveSubscriptionsForCustomer(String(booking.customerId)));
    if (!subs.length) throw new Error("no_active_subscriptions");
    if (!ensureVapid()) throw new Error("vapid_not_configured");
    const copy = notificationCopy(booking, moment);
    const payload = {
      title: copy.pushTitle,
      body: copy.pushBody,
      url: booking.manageToken ? `${SITE}/appointment/${booking.manageToken}` : `${SITE}/book/confirmed?booking=${bookingId}`,
    };
    let delivered = 0;
    let lastError = "push_send_failed";
    for (const sub of subs) {
      try {
        await sendPush(sub, payload);
        delivered += 1;
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        // The browser is gone for good: stop sending to this endpoint.
        if (statusCode === 404 || statusCode === 410) {
          await unsubscribePushSubscription(sub.endpoint);
        }
        lastError = error instanceof Error ? error.message : "push_send_failed";
      }
    }
    if (!delivered) throw new Error(lastError);
    await completeNotificationRow(row.id, { status: "sent" });
    return { status: "sent" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await completeNotificationRow(row.id, { status: "failed", error: message.slice(0, 500) });
    return { status: "failed" };
  }
}

/* ---------------- sweep ---------------- */

export type SweepResult = {
  skipped: "quiet_hours" | null;
  processed: number;
  results: Array<{ bookingId: string; moment: NotificationMoment; channel: NotificationChannel; status: string }>;
};

/**
 * The reminder sweep, driven by an outside trigger every 15 minutes
 * (Ty's decision: no Vercel cron lock-in). Inside
 * quiet hours (D4) it sends nothing: due rows stay pending and the
 * first post-08:00 run delivers them. Moments whose appointment time
 * has passed are marked expired, never sent late.
 */
export async function runNotificationSweep(limit = 100, now = new Date()): Promise<SweepResult> {
  if (isQuietHours(now)) return { skipped: "quiet_hours", processed: 0, results: [] };
  const candidates = await listReminderCandidates(now, limit);
  const results: SweepResult["results"] = [];
  for (const candidate of candidates) {
    const booking = await getBooking(candidate.bookingId);
    if (!booking) continue;
    if (["cancelled", "completed"].includes(String(booking.status))) continue;
    const start = new Date(booking.scheduledStart);
    const subscriptions = await listActiveSubscriptionsForCustomer(String(booking.customerId));
    for (const moment of REMINDER_MOMENTS) {
      const state = reminderMomentState(start, moment, now);
      if (state === "not_due") continue;
      if (state === "expired") {
        await expireNotificationRow(String(booking.id), moment, "email");
        if (subscriptions.length) await expireNotificationRow(String(booking.id), moment, "push");
        continue;
      }
      if (booking.customer?.email) {
        const outcome = await deliverLogged(booking, moment, "email");
        results.push({ bookingId: String(booking.id), moment, channel: "email", status: outcome.status });
      }
      if (subscriptions.length) {
        const outcome = await deliverLogged(booking, moment, "push", subscriptions);
        results.push({ bookingId: String(booking.id), moment, channel: "push", status: outcome.status });
      }
    }
  }
  return { skipped: null, processed: results.length, results };
}

/* ---------------- changed confirmation ---------------- */

/**
 * The "Changed" confirmation (D2): fires immediately when a booking
 * moves, from our engine, because Service Writer's token path sends
 * nothing. Immediate by design — it answers the customer's own
 * action, like the booking confirmation email — so quiet hours do
 * not hold it.
 */
export async function notifyBookingChanged(booking: FullBooking): Promise<Array<{ channel: NotificationChannel; status: string }>> {
  const results: Array<{ channel: NotificationChannel; status: string }> = [];
  if (booking.customer?.email) {
    const outcome = await deliverLogged(booking, "changed", "email");
    results.push({ channel: "email", status: outcome.status });
  }
  const subscriptions = await listActiveSubscriptionsForCustomer(String(booking.customerId));
  if (subscriptions.length) {
    const outcome = await deliverLogged(booking, "changed", "push", subscriptions);
    results.push({ channel: "push", status: outcome.status });
  }
  return results;
}

/* ---------------- reschedule ---------------- */

const SW_API_BASE_DEFAULT = "https://www.servicewriter.xyz/api";

/**
 * Service Writer's public reschedule-by-token call. HTTP 200 both
 * ways; the payload may be wrapped ({data:{...}}) or bare — accept
 * either. A non-200 or a transport error throws; a 200 with
 * success:false is a business answer and its message is returned
 * verbatim for the customer.
 */
export async function callSwReschedule(input: {
  managementToken: string;
  newDate: string;
  newTime: string;
}): Promise<{ success: boolean; message?: string }> {
  const base = process.env.SW_API_BASE ?? SW_API_BASE_DEFAULT;
  const response = await fetch(`${base}/v1/crm/customer-portal/appointments/reschedule-by-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      management_token: input.managementToken,
      new_date: input.newDate,
      new_time: `${input.newTime}:00`,
    }),
  });
  if (!response.ok) throw new Error(`sw_reschedule_http_${response.status}`);
  const data = (await response.json().catch(() => null)) as
    | { data?: { success?: boolean; message?: string }; success?: boolean; message?: string }
    | null;
  const payload = data?.data ?? data;
  return { success: Boolean(payload?.success), message: payload?.message };
}

export async function rescheduleAppointmentByToken(
  token: string,
  input: { newDate: string; newTime: string },
): Promise<RescheduleOutcome> {
  return performReschedule(
    {
      loadBookingByToken: async (t) => (await getBookingByManageToken(t)) as BookingLike | null,
      callSwReschedule,
      updateBookingSchedule: async (bookingId, scheduledStart, scheduledEnd) => {
        await updateBookingSchedule(bookingId, scheduledStart, scheduledEnd);
      },
      notifyChanged: async (booking) => {
        const fresh = await getBooking(String(booking.id));
        if (fresh) await notifyBookingChanged(fresh);
      },
    },
    token,
    input,
  );
}
