/**
 * Prepaid auto-push trigger: website backend -> Service Writer.
 *
 * Ty's rule (2026-10-29): anybody who PREPAYS on the MOMS website is
 * pushed to Service Writer automatically, with the website quote locked.
 * Unpaid bookings never come through here — they stay in the manual
 * selective-push queue, unchanged.
 *
 * This module is called from exactly one place: the Stripe webhook
 * handler (routes/stripe-webhooks.ts) after `payment_intent.succeeded`
 * has marked the booking's payment paid. That webhook is the only
 * authoritative payment-completion path in this codebase:
 * `chooseBookingPayment` (domain/payments.ts) only CREATES the Stripe
 * PaymentIntent — no handler other than the webhook ever transitions a
 * payment to `paid` — so there is no second completion path to hook.
 *
 * Failure discipline: this trigger never throws and never fails the
 * webhook. Service Writer owns the push pipeline; this module only
 * claims the booking atomically, calls Service Writer's internal
 * auto-push endpoint with the shared secret, and records the outcome.
 * On any failure the booking is left unstamped, the claim is released,
 * the reason is stored on the booking (auto_push_last_error), and the
 * booking remains visible in the manual queue.
 */

export interface AutoPushBookingFacts {
  status: string;
  pushedSwAppointmentId: string | null;
  neverPush: boolean;
  autoPushClaimedAt: string | null;
}

export type AutoPushDecision =
  | { action: "skip"; reason: "already_pushed" | "never_push" | "cancelled" | "claim_live" }
  | { action: "attempt" };

/** A claim younger than this is live; older claims are stale (must match
 * AUTO_PUSH_CLAIM_STALE_MINUTES in the repository's claim UPDATE). */
export const AUTO_PUSH_CLAIM_STALE_MS = 15 * 60 * 1000;

export function isAutoPushClaimLive(claimedAtIso: string | null, nowMs: number): boolean {
  if (!claimedAtIso) return false;
  const claimedMs = Date.parse(claimedAtIso);
  if (Number.isNaN(claimedMs)) return false;
  return nowMs - claimedMs < AUTO_PUSH_CLAIM_STALE_MS;
}

/**
 * Pure gate for the automatic path, evaluated from the booking's current
 * facts. The database claim (claimInternalWebsiteBookingAutoPush)
 * enforces the same conditions atomically; this function exists so the
 * decision is explicit, unit-testable, and safe to re-evaluate on
 * webhook retries.
 */
export function decideAutoPush(facts: AutoPushBookingFacts, nowMs: number): AutoPushDecision {
  if (facts.pushedSwAppointmentId) return { action: "skip", reason: "already_pushed" };
  if (facts.neverPush) return { action: "skip", reason: "never_push" };
  if (facts.status === "cancelled") return { action: "skip", reason: "cancelled" };
  if (isAutoPushClaimLive(facts.autoPushClaimedAt, nowMs)) return { action: "skip", reason: "claim_live" };
  return { action: "attempt" };
}

export interface ServiceWriterAutoPushConfig {
  baseUrl: string;
  secret: string;
}

/**
 * Configuration (server env only, never hardcoded):
 * - SERVICE_WRITER_API_URL: base URL of the Service Writer app
 *   (its Hono API is mounted under /api).
 * - SW_PUSH_SECRET: the SAME shared secret the existing internal
 *   website-bookings endpoints use in the SW -> backend direction.
 */
export function getServiceWriterAutoPushConfig(
  env: Record<string, string | undefined> = process.env,
): ServiceWriterAutoPushConfig | null {
  const baseUrl = (env.SERVICE_WRITER_API_URL || "").trim().replace(/\/+$/, "");
  const secret = (env.SW_PUSH_SECRET || "").trim();
  if (!baseUrl || !secret) return null;
  return { baseUrl, secret };
}

export type AutoPushCallResult =
  | { ok: true; outcome: "pushed" | "linked" | "already_pushed"; appointmentId: string | null }
  | { ok: false; reason: string };

type FetchFn = (url: string, init: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/** One server-to-server call to Service Writer's internal auto-push
 * endpoint. Interprets (never invents) the pipeline's result. */
export async function callServiceWriterAutoPush(
  config: ServiceWriterAutoPushConfig,
  bookingId: string,
  fetchFn: FetchFn = fetch as unknown as FetchFn,
): Promise<AutoPushCallResult> {
  let response: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    response = await fetchFn(`${config.baseUrl.replace(/\/+$/, "")}/api/internal/website-bookings/auto-push`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sw-push-secret": config.secret,
      },
      body: JSON.stringify({ booking_id: bookingId }),
    });
  } catch (error) {
    return {
      ok: false,
      reason: `Service Writer auto-push call failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const payload = (await response.json().catch(() => null)) as
    | { data?: { status?: string; appointment_id?: string | null; message?: string }; error?: unknown }
    | null;
  const data = payload?.data;

  if (response.ok && data) {
    if (data.status === "created" || data.status === "pushed") {
      return { ok: true, outcome: "pushed", appointmentId: data.appointment_id ?? null };
    }
    if (data.status === "linked") {
      return { ok: true, outcome: "linked", appointmentId: data.appointment_id ?? null };
    }
    if (data.status === "already_pushed") {
      return { ok: true, outcome: "already_pushed", appointmentId: data.appointment_id ?? null };
    }
    // A 200 with a failed pipeline result is a failed auto-push: surface
    // the pipeline's real reason, do not pretend success.
    return { ok: false, reason: data.message ?? `Service Writer reported status "${data.status ?? "unknown"}".` };
  }

  const errorMessage =
    typeof (payload?.error as { message?: unknown })?.message === "string"
      ? ((payload?.error as { message: string }).message as string)
      : typeof payload?.error === "string"
        ? payload.error
        : `Service Writer returned HTTP ${response.status}`;
  return { ok: false, reason: errorMessage };
}

export interface AutoPushDeps {
  getBooking: (bookingId: string) => Promise<AutoPushBookingFacts | null>;
  claim: (bookingId: string) => Promise<boolean>;
  recordFailure: (bookingId: string, reason: string) => Promise<unknown>;
  recordSuccess: (bookingId: string) => Promise<unknown>;
  callServiceWriter: (bookingId: string) => Promise<AutoPushCallResult>;
  now?: () => number;
}

export type AutoPushTriggerResult =
  | { outcome: "not_configured" }
  | { outcome: "booking_not_found" }
  | { outcome: "skipped"; reason: string }
  | { outcome: "pushed" | "linked" | "already_pushed"; appointmentId: string | null }
  | { outcome: "failed"; reason: string };

/**
 * Run one prepaid auto-push attempt for a booking. Idempotent: a second
 * invocation for an already-pushed (or in-flight) booking creates
 * nothing and reports the existing state.
 */
export async function triggerPrepaidAutoPush(
  bookingId: string,
  deps: AutoPushDeps,
): Promise<AutoPushTriggerResult> {
  const booking = await deps.getBooking(bookingId);
  if (!booking) return { outcome: "booking_not_found" };

  const decision = decideAutoPush(booking, (deps.now ?? Date.now)());
  if (decision.action === "skip") {
    return decision.reason === "already_pushed"
      ? { outcome: "already_pushed", appointmentId: booking.pushedSwAppointmentId }
      : { outcome: "skipped", reason: decision.reason };
  }

  // Atomic claim: if a concurrent webhook retry already claimed the
  // booking, this call creates nothing.
  const claimed = await deps.claim(bookingId);
  if (!claimed) {
    // Lost the race, or the booking changed under us (pushed / cancelled
    // / never-push between the read and the claim). Re-read once and
    // report the honest state instead of pushing.
    const current = await deps.getBooking(bookingId);
    if (current?.pushedSwAppointmentId) {
      return { outcome: "already_pushed", appointmentId: current.pushedSwAppointmentId };
    }
    return { outcome: "skipped", reason: "claim_not_won" };
  }

  const result = await deps.callServiceWriter(bookingId);
  if (result.ok) {
    await deps.recordSuccess(bookingId).catch(() => undefined);
    return { outcome: result.outcome, appointmentId: result.appointmentId };
  }

  // Fail-safe: record the reason and release the claim (recordFailure
  // does both). The booking stays unstamped and in the manual queue.
  await deps.recordFailure(bookingId, result.reason).catch(() => undefined);
  return { outcome: "failed", reason: result.reason };
}
