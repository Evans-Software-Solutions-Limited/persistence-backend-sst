/**
 * Subscription domain models for M10.
 *
 * Spec: specs/11-payments-subscriptions/design.md § Domain models
 * Satisfies: requirements.md AC 1.1, 1.2, 1.3, 5.1, 5.4, 5.5
 *
 * Pure types — no framework imports. The mobile UI layer reads these
 * via `ApiPort.getSubscriptionTiers` / `getMySubscription` and the
 * `subscriptionService` pure functions.
 */

/**
 * Eight named tiers plus `free`. The `free` tier is the default
 * starting state for any signed-in user and is never shown as a
 * buyable card (`requirements.md` AC 1.2). The remaining seven span
 * two role tracks: user (basic, premium) and trainer (three
 * sizes × Standard/Pro).
 */
export type SubscriptionTierName =
  | "free"
  | "basic"
  | "premium"
  | "individual_trainer_standard"
  | "individual_trainer_pro"
  | "small_business_standard"
  | "small_business_pro"
  | "medium_enterprise_standard"
  | "medium_enterprise_pro";

/**
 * Profile role. Drives the auto-default on the Subscription Selection
 * role toggle (`requirements.md` AC 6.1).
 */
export type SubscriptionRole =
  | "user"
  | "personal_trainer"
  | "physiotherapist"
  | "admin";

/**
 * Stripe-aligned payment status. Mirrors the canonical Postgres
 * `payment_status` enum on `user_subscriptions` (`packages/db/src/
 * schema.ts`) and the values the webhook handler writes.
 *
 * - `active` — paid subscription in good standing.
 * - `trialing` — inside the 7/14-day free trial. Backend flips to
 *   `active` after `invoice.payment_succeeded` post trial-end.
 * - `past_due` — most recent invoice failed. Webhook drives this.
 * - `cancelled` — period-end cancel has been applied (sub still
 *   active until `expires_at`) OR immediate cancel committed.
 * - `incomplete` — initial payment needs 3DS / SCA. Webhook resolves
 *   to active/trialing or to incomplete_expired.
 * - `incomplete_expired` — Stripe's ~23h auto-transition for an
 *   unconfirmed initial payment. Webhook rolls back to the prior tier.
 * - `unpaid` — Stripe's terminal state after past_due retries
 *   exhaust.
 */
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "cancelled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid";

/** Billing cadence toggle on the Selection screen. */
export type BillingCycle = "monthly" | "yearly";

/**
 * Discriminator returned by the backend on `POST /subscriptions`,
 * used by the mobile UI to pick the right success-alert wording.
 *
 * - `new` — first-time subscription (no prior `user_subscriptions`
 *   row, or only a `free` synthesized one).
 * - `upgrade` — change-of-tier where the new monthly price is
 *   higher than current. Stripe prorates and bills immediately.
 * - `downgrade` — change-of-tier where the new monthly price is
 *   lower. Backend schedules the change for `current_period_end`.
 * - `reinstate` — user tapped their currently-cancelled-but-active
 *   tier; backend cleared `cancelled_at` and resumed the same
 *   Stripe sub.
 * - `cycle_change` — same tier, different billing cycle. Scheduled
 *   or immediate per upgrade/downgrade direction.
 */
export type ChangeType =
  | "new"
  | "upgrade"
  | "downgrade"
  | "reinstate"
  | "cycle_change";

/**
 * Catalog entry. Mirrors a row of the backend `subscription_tiers`
 * table after the SST adapter parses decimal-string prices to
 * numbers. Fetched via `ApiPort.getSubscriptionTiers`.
 */
export interface SubscriptionTier {
  /** Canonical `tier_name` — primary key column on the backend. */
  tierName: SubscriptionTierName;
  /** Human-readable label ("Premium", "Individual Trainer (Pro)"). */
  displayName: string;
  description: string | null;
  /** Pounds (e.g. 9.99). Wire format is decimal string; adapter parses. */
  priceMonthly: number;
  priceYearly: number | null;
  /** ISO-4217 code, default "GBP". */
  currency: string;
  /** JSONB blob — free-form feature flags + numeric overrides. */
  features: Record<string, unknown>;
  /** Per-month workout cap. `null` = unlimited (Premium / Pro tiers). */
  workoutLimit: number | null;
  aiAccess: boolean;
  aiWorkoutLimit: number;
  gymBuddyAccess: boolean;
  /** Client slots. `null` = unlimited; set only on trainer tiers. */
  trainerClientLimit: number | null;
  isTrainerTier: boolean;
  analyticsAccess: boolean;
  exportAccess: boolean;
  stripePriceIdMonthly: string | null;
  stripePriceIdYearly: string | null;
}

/**
 * Scheduled-change marker. Populated when the backend has stamped
 * `metadata.scheduled_change` on a `user_subscriptions` row (e.g.
 * after a downgrade that takes effect at period-end). The Selection
 * screen displays this via its scheduled-change indicator
 * (`requirements.md` AC 3.7).
 */
export interface ScheduledChange {
  nextTierName: SubscriptionTierName;
  nextDisplayName: string;
  effectiveAt: string;
}

/**
 * User's current subscription state joined with tier metadata and
 * profile / trial-eligibility flags. Returned by `ApiPort
 * .getMySubscription`.
 *
 * The backend synthesises a `free`-tier shape when the user has no
 * `user_subscriptions` row — the UI never has to special-case a
 * null subscription (`requirements.md` AC 5.4).
 */
export interface MySubscription {
  /** Local `user_subscriptions.id`. `null` only for the synthesised free shape. */
  subscriptionId: string | null;
  tierName: SubscriptionTierName;
  paymentStatus: SubscriptionStatus;
  billingCycle: BillingCycle | null;
  /** ISO timestamp — start of the current sub period. */
  startsAt: string;
  /**
   * End of the current paid period. `null` only for the synthetic
   * free shape. For cancelled-but-active subs, this is also the
   * access-ends date.
   */
  expiresAt: string | null;
  /** ISO timestamp; non-null while sub is cancelled-but-still-active. */
  cancelledAt: string | null;
  /** ISO timestamp; non-null while sub is in `trialing` state. */
  trialEndsAt: string | null;
  /** Stripe `sub_…` id; `null` only for the synthetic free shape. */
  externalSubscriptionId: string | null;

  // Joined from `subscription_tiers`
  tierDisplayName: string;
  tierDescription: string | null;
  workoutLimit: number | null;
  aiAccess: boolean;
  aiWorkoutLimit: number;
  gymBuddyAccess: boolean;
  trainerClientLimit: number | null;
  isTrainerTier: boolean;

  // Joined from `profiles`
  role: SubscriptionRole;

  // Trial eligibility from `profiles.has_used_*_trial`
  hasUsedUserTrial: boolean;
  hasUsedTrainerTrial: boolean;
  /** `= !hasUsedUserTrial`; pre-computed server-side for the UI. */
  isEligibleForUserTrial: boolean;
  /** `= !hasUsedTrainerTrial`; pre-computed server-side for the UI. */
  isEligibleForTrainerTrial: boolean;

  /** Populated only when a scheduled downgrade is pending. */
  scheduledChange: ScheduledChange | null;
}

/**
 * Response shape from `ApiPort.createSubscription`. Carries the
 * M10-extended discriminator fields (`changeType` / `scheduled` /
 * `effectiveAt` / `isTrial`) so the UI can pick the right
 * success-alert wording without inspecting domain-level state.
 *
 * Note: `clientSecret` is present iff `requiresAction === true`
 * (3DS challenge needed); `reinstated` is set on the reinstate
 * dispatch branch only.
 */
export interface CreateSubscriptionResult {
  success: true;
  requiresAction: boolean;
  subscriptionId: string;
  stripeSubscriptionId: string;
  trialEndsAt: string | null;
  nextBillingDate: string | null;
  paymentStatus: SubscriptionStatus;
  clientSecret?: string;
  reinstated?: boolean;
  changeType: ChangeType;
  /** `true` iff downgrade scheduled to period-end. */
  scheduled: boolean;
  /** ISO timestamp when scheduled change takes effect; `null` otherwise. */
  effectiveAt: string | null;
  /** `= paymentStatus === "trialing"`. */
  isTrial: boolean;
}

/** Response shape from `ApiPort.cancelSubscription`. Unchanged from PR #70. */
export interface CancelSubscriptionResult {
  success: true;
  cancelledAt: string;
  subscriptionEndsAt: string;
  message: string;
}
