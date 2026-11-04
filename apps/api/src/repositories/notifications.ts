import { getSql } from "../../../../packages/db/src/index.js";
import { getBooking } from "./bookings.js";

/**
 * Data access for the booking notifications feature (migration
 * 007_booking_notifications.sql): Web Push subscriptions and the
 * fire-once booking_notifications log. Raw SQL via getSql(), in the
 * style of services/booking-email.ts — these tables intentionally
 * have no Drizzle model, like booking_email_deliveries before them.
 */

export type PushSubscriptionRecord = {
  id: string;
  customerId: string | null;
  bookingId: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
};

export async function upsertPushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  customerId?: string | null;
  bookingId?: string | null;
  userAgent?: string | null;
}): Promise<PushSubscriptionRecord> {
  const sql = getSql();
  const rows = (await sql`
    INSERT INTO moms_ops.push_subscriptions (customer_id, booking_id, endpoint, p256dh, auth, user_agent)
    VALUES (${input.customerId ?? null}::uuid, ${input.bookingId ?? null}::uuid,
            ${input.endpoint}, ${input.p256dh}, ${input.auth}, ${input.userAgent ?? null})
    ON CONFLICT (endpoint) DO UPDATE SET
      customer_id = COALESCE(EXCLUDED.customer_id, moms_ops.push_subscriptions.customer_id),
      booking_id = COALESCE(EXCLUDED.booking_id, moms_ops.push_subscriptions.booking_id),
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      user_agent = COALESCE(EXCLUDED.user_agent, moms_ops.push_subscriptions.user_agent),
      unsubscribed_at = NULL,
      updated_at = now()
    RETURNING id, customer_id AS "customerId", booking_id AS "bookingId",
              endpoint, p256dh, auth, user_agent AS "userAgent"
  `) as unknown as PushSubscriptionRecord[];
  return rows[0];
}

export async function unsubscribePushSubscription(endpoint: string): Promise<boolean> {
  const sql = getSql();
  const rows = (await sql`
    UPDATE moms_ops.push_subscriptions
    SET unsubscribed_at = now(), updated_at = now()
    WHERE endpoint = ${endpoint} AND unsubscribed_at IS NULL
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  return rows.length > 0;
}

export async function listActiveSubscriptionsForCustomer(customerId: string): Promise<PushSubscriptionRecord[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, customer_id AS "customerId", booking_id AS "bookingId",
           endpoint, p256dh, auth, user_agent AS "userAgent"
    FROM moms_ops.push_subscriptions
    WHERE customer_id = ${customerId}::uuid AND unsubscribed_at IS NULL
  `;
  return rows as unknown as PushSubscriptionRecord[];
}

/** Resolve a manage token to the full booking (incl. server-side SW token), or null. */
export async function getBookingByManageToken(token: string) {
  const sql = getSql();
  const rows = (await sql`
    SELECT id FROM moms_ops.bookings WHERE manage_token = ${token} LIMIT 1
  `) as unknown as Array<{ id?: string }>;
  const row = rows[0];
  if (!row?.id) return null;
  return getBooking(String(row.id));
}

export type NotificationMoment = "reminder_24h" | "reminder_1h" | "changed";
export type NotificationChannel = "email" | "push";
export type NotificationStatus = "pending" | "sending" | "sent" | "failed" | "expired";

/** Insert the fire-once log row if absent; returns the row either way. */
export async function ensureNotificationRow(
  bookingId: string,
  moment: NotificationMoment,
  channel: NotificationChannel,
): Promise<{ id: string; status: NotificationStatus }> {
  const sql = getSql();
  const rows = (await sql`
    INSERT INTO moms_ops.booking_notifications (booking_id, moment, channel)
    VALUES (${bookingId}::uuid, ${moment}, ${channel})
    ON CONFLICT (booking_id, moment, channel) DO NOTHING
    RETURNING id, status
  `) as unknown as Array<{ id: string; status: NotificationStatus }>;
  const inserted = rows[0];
  if (inserted) return inserted;
  const existing = (await sql`
    SELECT id, status FROM moms_ops.booking_notifications
    WHERE booking_id = ${bookingId}::uuid AND moment = ${moment} AND channel = ${channel}
    LIMIT 1
  `) as unknown as Array<{ id: string; status: NotificationStatus }>;
  return existing[0];
}

/** Claim a pending row for sending; exactly one caller can win this. */
export async function claimNotificationRow(id: string): Promise<boolean> {
  const sql = getSql();
  const rows = (await sql`
    UPDATE moms_ops.booking_notifications
    SET status = 'sending'
    WHERE id = ${id}::uuid AND status = 'pending'
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  return rows.length > 0;
}

export async function completeNotificationRow(
  id: string,
  outcome: { status: "sent" | "failed"; providerMessageId?: string | null; error?: string | null },
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE moms_ops.booking_notifications
    SET status = ${outcome.status},
        provider_message_id = ${outcome.providerMessageId ?? null},
        error = ${outcome.error ?? null},
        sent_at = CASE WHEN ${outcome.status} = 'sent' THEN now() ELSE sent_at END
    WHERE id = ${id}::uuid
  `;
}

/** Record a moment as expired (appointment time passed); never sends late. */
export async function expireNotificationRow(
  bookingId: string,
  moment: NotificationMoment,
  channel: NotificationChannel,
): Promise<void> {
  const row = await ensureNotificationRow(bookingId, moment, channel);
  if (row.status !== "pending") return;
  const sql = getSql();
  await sql`
    UPDATE moms_ops.booking_notifications
    SET status = 'expired'
    WHERE id = ${row.id}::uuid AND status = 'pending'
  `;
}

export type ReminderCandidate = {
  bookingId: string;
  customerId: string;
  status: string;
  scheduledStart: Date;
  scheduledEnd: Date;
};

/**
 * Bookings the sweep must consider: not cancelled/completed, starting
 * within the next 24h (so the 24h moment can be due), or started up to
 * 2h ago (so un-sent moments can still be marked expired, never sent).
 */
export async function listReminderCandidates(now: Date, limit: number): Promise<ReminderCandidate[]> {
  const sql = getSql();
  const horizon = new Date(now.getTime() + 24 * 60 * 60_000).toISOString();
  const floor = new Date(now.getTime() - 2 * 60 * 60_000).toISOString();
  const rows = await sql`
    SELECT id AS "bookingId", customer_id AS "customerId", status,
           scheduled_start AS "scheduledStart", scheduled_end AS "scheduledEnd"
    FROM moms_ops.bookings
    WHERE status NOT IN ('cancelled', 'completed')
      AND scheduled_start <= ${horizon}::timestamptz
      AND scheduled_start >= ${floor}::timestamptz
    ORDER BY scheduled_start ASC
    LIMIT ${limit}
  `;
  return (rows as unknown as Array<Omit<ReminderCandidate, "scheduledStart" | "scheduledEnd"> & {
    scheduledStart: string | Date;
    scheduledEnd: string | Date;
  }>).map((row) => ({
    ...row,
    scheduledStart: new Date(row.scheduledStart),
    scheduledEnd: new Date(row.scheduledEnd),
  }));
}
