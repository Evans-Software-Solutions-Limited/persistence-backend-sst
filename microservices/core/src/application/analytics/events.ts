/**
 * Growth instrumentation (spec-30 / M20-P1) — the canonical analytics event
 * contract.
 *
 * This is deliberately the shape a FUTURE client-side emitter (build-2) will
 * target: the mobile addition later is a thin adapter that POSTs this payload to
 * `/analytics/events` → `emitEvent(...)`, not a rework (spec-30 R1.2). Server
 * paths call `emitEvent` directly; there is no client emitter this cycle
 * (binary frozen, HC-1).
 *
 * ⚠ NO PII in `properties` (HC-4). Carry value/currency/audience/tier/store/
 * billing_cycle — never email or name. Email is hashed in-flight by the Meta
 * CAPI client only, never persisted.
 */

/** The closed set of first-party events emitted this cycle (spec-30 R1.4). */
export type AnalyticsEventName =
  | "registration_completed"
  | "trial_started"
  | "subscription_purchased"
  | "renewal"
  | "cancellation"
  | "expiration"
  | "session_completed"
  | "lead_captured"
  // Web-origin: an outbound App Store CTA click (spec-30 R3.8) — the optimisable
  // ads signal in the absence of an install SDK.
  | "store_click"
  // Web-origin, founding checkout (FOUNDING-OFFER 2026-09-05 amendment).
  // `checkout_started` is INTENT — the buyer was sent to Stripe; `purchase` is
  // the conversion, emitted by the webhook once Stripe confirms payment.
  // Distinct from `subscription_purchased`, which is a recurring native-store
  // purchase: this one is a single fixed-term payment that never renews.
  | "checkout_started"
  | "purchase"
  | "onboarding_page_viewed"
  | "onboarding_page_completed"
  | "onboarding_page_skipped"
  | "onboarding_dismissed"
  | "onboarding_completed"
  | "onboarding_intent_changed"
  | "onboarding_recommendation_viewed"
  | "onboarding_plan_selected"
  | "weight_history_opened"
  | "body_fat_history_opened"
  | "measurement_logged_from_history"
  | "estimated_1rm_banner_viewed"
  | "coaching_overview_opened";

export const CLIENT_ANALYTICS_EVENT_NAMES = [
  "onboarding_page_viewed",
  "onboarding_page_completed",
  "onboarding_page_skipped",
  "onboarding_dismissed",
  "onboarding_completed",
  "onboarding_intent_changed",
  "onboarding_recommendation_viewed",
  "onboarding_plan_selected",
  "weight_history_opened",
  "body_fat_history_opened",
  "measurement_logged_from_history",
  "estimated_1rm_banner_viewed",
  "coaching_overview_opened",
] as const satisfies readonly AnalyticsEventName[];

/** Where the event originated. `app` is reserved for the build-2 client emitter. */
export type AnalyticsEventSource = "server" | "web" | "app";

export interface AnalyticsEventInput {
  name: AnalyticsEventName;
  /** Supabase user id (== RevenueCat app_user_id). Null/absent for anonymous leads. */
  userId?: string | null;
  /** Defaults to now() at the DB. Pass when the true event time differs (e.g. completedAt). */
  occurredAt?: Date;
  /**
   * Dedup key shared with the browser pixel so the Meta CAPI copy dedups against
   * the client-fired event. Stable per logical event:
   *  - RC events → the RevenueCat `event.id`
   *  - session   → `sess_<serverSessionId>`
   *  - lead      → the UUID the web generated + sent with the pixel event
   *  - registration → `reg_<userId>` (set by the DB trigger)
   */
  eventId?: string;
  source?: AnalyticsEventSource;
  properties?: Record<string, unknown>;
}
