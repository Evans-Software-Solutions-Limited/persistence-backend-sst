import Elysia, { t } from "elysia";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { subscriptionTiers } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";

import {
  SubscriptionRepository,
  type UserSubscription,
} from "../../repositories/subscriptionRepository";
import { ProfileRepository } from "../../repositories/profileRepository";
import { getStripe } from "../../stripe/stripeClient";
import {
  deriveSubscriptionBaseKey,
  opKey,
} from "../../stripe/stripeIdempotency";
import { isUniqueViolation } from "../../stripe/pgErrors";

/**
 * POST /subscriptions — single endpoint that folds four outbound flows:
 *
 *   1. **New subscription**   — fresh user, no prior `user_subscriptions` row,
 *                                or a row that doesn't qualify for reinstate.
 *   2. **Reinstatement**       — same tier + billing cycle as the latest row,
 *                                and that row's `payment_status` is in
 *                                {cancelled, canceled, past_due, trialing}.
 *                                We resume the SAME Stripe subscription via
 *                                `cancel_at_period_end: false`.
 *   3. **Subscription change** — different tier or billing cycle from the
 *                                latest row. We create a NEW Stripe sub and
 *                                stamp the previous Stripe sub id into
 *                                `metadata.old_stripe_subscription_id` on
 *                                BOTH the new Stripe sub AND the local row.
 *                                The webhook handler
 *                                (`subscriptionUpdated.ts`) drives the
 *                                eventual cancel-of-old when the new sub
 *                                transitions to active/trialing, or rolls
 *                                back to the original on incomplete_expired.
 *                                The synchronous endpoint never cancels
 *                                inline — that was legacy's "billed twice"
 *                                failure mode.
 *   4. **3D Secure**            — when the resulting Stripe subscription's
 *                                latest_invoice.payment_intent is
 *                                `requires_action`, return
 *                                `requires_action: true` with the
 *                                `client_secret` so mobile can complete the
 *                                challenge. The DB row is written first
 *                                (status=`pending`) so an abandoned 3DS flow
 *                                can't refarm trial flags.
 *
 * Contract (consolidated — DIFFERS FROM LEGACY, see Brad sign-off above):
 *   - `subscription_id` always means our local `user_subscriptions.id` UUID,
 *     `stripe_subscription_id` always means the Stripe `sub_…` id. Legacy
 *     conflated these in the 3DS branch.
 *   - `use_trial` is required explicit on the request body — no silent
 *     default. Caller must opt in to trial usage.
 *   - `payment_method_id` is required — no fallback to stored default.
 *   - The handler writes only to `user_subscriptions` AND to two
 *     `profiles` columns (`has_used_user_trial` / `has_used_trainer_trial`)
 *     when a trial is granted. The DB trigger
 *     `update_subscription_limits_trigger` maintains
 *     `profiles.subscription_id`, `profiles.role`, and
 *     `subscription_limits.*` automatically — DO NOT touch those here.
 *
 * Legacy reference: `persistence-backend/supabase/functions/
 * stripe-create-subscription/index.ts` (1040 lines, folded the same 4
 * flows). PR #69 webhook handlers must remain unchanged — they already
 * understand the `old_stripe_subscription_id` and `scheduled_downgrade`
 * markers we write here.
 */

const TRAINER_TIER_TRIAL_DAYS = 14;
const USER_TIER_TRIAL_DAYS = 7;

// Local payment_statuses that mean "the Stripe subscription is still
// alive and resumable via stripe.subscriptions.update(cancel_at_period_end:
// false)". Permanently-cancelled subs (Stripe status: "canceled") are
// deliberately NOT in this set — Stripe rejects reactivation of those
// with "You can't reactivate canceled subscriptions", and every path
// that writes the local "cancelled"/"canceled" payment_status (immediate
// cancel via cancel_immediately:true, subscriptionDeleted webhook,
// subscriptionUpdated after current_period_end) corresponds to a
// permanently-dead Stripe sub. Rows in that state fall through to the
// change-of-tier branch instead, which creates a fresh Stripe sub
// (Inspector Brad PR #70 sweep #2 medium-severity find).
const REINSTATEMENT_STATUSES = new Set(["past_due", "trialing"]);

type CreateSubscriptionBody = {
  tier_name: string;
  billing_cycle: "monthly" | "yearly";
  /**
   * Optional in M10 (was required in PR #70). When absent, the handler
   * dispatches to the no-payment-method change-of-tier path that reuses
   * the customer's default payment method on file with Stripe — used
   * by the Subscription Management upgrade/downgrade flow (AC 3.3, 3.4).
   */
  payment_method_id?: string;
  use_trial: boolean;
  platform?: "ios" | "android";
  /**
   * Optional client-generated idempotency key (spec 17 / Phase A). Stable
   * per user action so a client-level retry of the SAME subscribe attempt
   * reuses it and Stripe dedupes the outbound calls. When omitted, the
   * backend derives a deterministic key from the request intent — see
   * `deriveSubscriptionBaseKey`. Backward-compatible: older clients omit it.
   */
  idempotency_key?: string;
};

/**
 * Discriminator for the response shape — lets the mobile presenter
 * branch on the kind of change without re-deriving it from the request.
 *   - "new":          fresh user, no prior active sub
 *   - "upgrade":      change-of-tier where new monthly price > current
 *   - "downgrade":    change-of-tier where new monthly price < current;
 *                     scheduled to end-of-period
 *   - "reinstate":    same tier as a cancelled/past_due row, resumed
 *   - "cycle_change": same tier, different billing cycle (monthly ↔ yearly);
 *                     scheduled/effective_at follow upgrade/downgrade rules
 *                     by total annual price comparison
 */
type ChangeType =
  | "new"
  | "upgrade"
  | "downgrade"
  | "reinstate"
  | "cycle_change";

type SuccessResponse = {
  success: true;
  requires_action: boolean;
  subscription_id: string; // local UUID
  stripe_subscription_id: string;
  trial_ends_at: string | null;
  next_billing_date: string | null;
  payment_status: string;
  reinstated?: boolean;
  client_secret?: string;
  // M10 discriminator additions:
  change_type: ChangeType;
  scheduled: boolean;
  effective_at: string | null; // ISO when scheduled; null otherwise
  is_trial: boolean; // = payment_status === "trialing"
};

type ErrorResponse = { error: string };

function toIso(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString();
}

/**
 * Read the expanded `payment_intent` off a Stripe invoice across API
 * versions. The SDK's `Stripe.Invoice` type no longer declares
 * `payment_intent` as an indexable field (v22 moved it under
 * `confirmation_secret` in some shapes), but the runtime payload from
 * `expand: ["latest_invoice.payment_intent"]` still carries it directly.
 * Same `as unknown as { ... }` pattern used by
 * `eventHandlers/_helpers.ts:readInvoiceSubscriptionId`.
 */
function readExpandedPaymentIntent(
  invoice: Stripe.Invoice | null | undefined,
): Stripe.PaymentIntent | null {
  if (!invoice) return null;
  const pi = (
    invoice as unknown as {
      payment_intent?: Stripe.PaymentIntent | string | null;
    }
  ).payment_intent;
  if (pi === null || pi === undefined || typeof pi === "string") return null;
  return pi;
}

/**
 * Map a Stripe `Subscription.status` (plus, for incomplete subs, the
 * payment intent status) to our local `payment_status`. Mirrors legacy
 * lines 794-813 + 469-489.
 */
function derivePaymentStatus(subscription: Stripe.Subscription): string {
  switch (subscription.status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "incomplete":
    case "incomplete_expired": {
      const invoice = subscription.latest_invoice as Stripe.Invoice | null;
      const pi = readExpandedPaymentIntent(invoice);
      if (pi?.status === "succeeded") return "active";
      return "pending";
    }
    default:
      return "pending";
  }
}

/**
 * Read `current_period_end` across API versions (newer Stripe API moved
 * the field onto items). Mirrors `eventHandlers/_helpers.ts:readCurrentPeriodEnd`
 * — duplicated here rather than imported because the inbound helper is
 * scoped to the webhook side and re-exporting from `_helpers` would
 * widen its surface unnecessarily. Behaviour must stay in lockstep with
 * that helper — if you change one, change both (covered by tests on each
 * side).
 */
function readCurrentPeriodEnd(
  subscription: Stripe.Subscription,
): number | null {
  const legacy = (
    subscription as unknown as { current_period_end?: number | null }
  ).current_period_end;
  if (typeof legacy === "number" && legacy > 0) return legacy;
  const itemEnd = subscription.items?.data?.[0]?.current_period_end;
  return typeof itemEnd === "number" && itemEnd > 0 ? itemEnd : null;
}

function periodEndDate(subscription: Stripe.Subscription): Date | null {
  const seconds = readCurrentPeriodEnd(subscription);
  if (seconds === null) return null;
  return new Date(seconds * 1000);
}

function trialEndDate(subscription: Stripe.Subscription): Date | null {
  if (!subscription.trial_end) return null;
  return new Date(subscription.trial_end * 1000);
}

/**
 * Read the requires-action payment intent off a Stripe subscription's
 * latest invoice, if any. Returns null when the sub doesn't need any
 * 3DS challenge — caller proceeds with a normal happy-path response.
 */
function readRequiresActionIntent(
  subscription: Stripe.Subscription,
): Stripe.PaymentIntent | null {
  const invoice = subscription.latest_invoice as Stripe.Invoice | null;
  const pi = readExpandedPaymentIntent(invoice);
  if (pi?.status === "requires_action") return pi;
  return null;
}

/**
 * Look up a Stripe price id from `subscription_tiers` for the requested
 * tier + cycle. Returns null when the tier doesn't exist OR when the
 * cycle's price id is unset (mis-configured tier — handler 500s).
 *
 * Inlined rather than added to a repository because (a) it's a single
 * read used by exactly one caller, (b) the legacy webhook handler does
 * the inverse lookup (price → tier) inline in subscriptionUpdated.ts:
 * `resolveTierForPrice` for the same reason.
 */
async function resolvePrice(
  tierName: string,
  billingCycle: "monthly" | "yearly",
): Promise<{
  priceId: string;
  currency: string;
  isTrainerTier: boolean;
  /**
   * The tier's `price_monthly` value as a JS number. Used by the
   * change-of-tier dispatch to compute upgrade vs downgrade direction
   * (BACKEND_BRIEF §3 — "Change-of-tier where new `price_monthly` >
   * current → upgrade; new < current → downgrade"). Drizzle decimals
   * arrive as strings — parsed defensively here so the comparison is
   * numeric.
   */
  priceMonthlyAmount: number;
  /** Yearly amount, or null if the tier has no yearly price. */
  priceYearlyAmount: number | null;
} | null> {
  const db = getDb();
  const rows = await db
    .select({
      priceMonthly: subscriptionTiers.stripePriceIdMonthly,
      priceYearly: subscriptionTiers.stripePriceIdYearly,
      currency: subscriptionTiers.currency,
      isTrainerTier: subscriptionTiers.isTrainerTier,
      priceMonthlyAmount: subscriptionTiers.priceMonthly,
      priceYearlyAmount: subscriptionTiers.priceYearly,
    })
    .from(subscriptionTiers)
    .where(eq(subscriptionTiers.tierName, tierName))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const priceId =
    billingCycle === "monthly" ? row.priceMonthly : row.priceYearly;
  if (typeof priceId !== "string" || priceId.length === 0) return null;
  return {
    priceId,
    currency: row.currency ?? "GBP",
    isTrainerTier: row.isTrainerTier ?? false,
    priceMonthlyAmount: parseDecimal(row.priceMonthlyAmount) ?? 0,
    priceYearlyAmount: parseDecimal(row.priceYearlyAmount),
  };
}

/**
 * Parse a Drizzle `decimal` field (returned as string) to a JS number.
 * Returns null for null/unparseable input.
 */
function parseDecimal(value: string | number | null): number | null {
  if (value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Read just the tier-level metadata needed to classify a change-of-tier
 * as upgrade / downgrade / cycle_change. Used by the no-payment-method
 * change path to look up the EXISTING tier's prices for comparison
 * against the NEW tier requested. Returns null if the tier doesn't
 * exist in the catalog (out-of-band data — caller falls back to
 * "upgrade" classification, which is the safest default).
 */
async function resolveTierPrices(tierName: string): Promise<{
  priceMonthly: number;
  priceYearly: number | null;
} | null> {
  const db = getDb();
  const rows = await db
    .select({
      priceMonthly: subscriptionTiers.priceMonthly,
      priceYearly: subscriptionTiers.priceYearly,
    })
    .from(subscriptionTiers)
    .where(eq(subscriptionTiers.tierName, tierName))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    priceMonthly: parseDecimal(row.priceMonthly) ?? 0,
    priceYearly: parseDecimal(row.priceYearly),
  };
}

/**
 * Classify a change-of-tier event into the response discriminator.
 *
 * Rules (BACKEND_BRIEF §3 + design.md § Backend endpoints):
 *   - new tier_name === old tier_name:
 *       - same cycle: caller. (Handled upstream as "no change to apply".)
 *       - different cycle: "cycle_change"; scheduled/effective by total
 *         annual price comparison (monthly*12 vs yearly).
 *   - new tier_name !== old tier_name:
 *       - new `price_monthly` > old → "upgrade"
 *       - new `price_monthly` < old → "downgrade", scheduled to end-of-period
 *       - new `price_monthly` === old (rare — sibling-tier swap) →
 *         tie-broken as "upgrade" (default to not-scheduled, billed now).
 *
 * Returned `scheduled` reflects what the BACKEND will instruct Stripe to
 * do on this call (proration_behavior: "none" + billing_cycle_anchor:
 * "unchanged" vs "always_invoice" + immediate). `effectiveAt` is provided
 * by the caller from the resulting Stripe subscription's
 * `current_period_end`.
 *
 * Pure function — exported for unit tests.
 */
export function deriveChangeType(input: {
  oldTierName: string;
  newTierName: string;
  oldCycle: "monthly" | "yearly";
  newCycle: "monthly" | "yearly";
  oldPriceMonthly: number;
  newPriceMonthly: number;
  oldPriceYearly: number | null;
  newPriceYearly: number | null;
}): { changeType: ChangeType; isDowngrade: boolean } {
  const {
    oldTierName,
    newTierName,
    oldCycle,
    newCycle,
    oldPriceMonthly,
    newPriceMonthly,
    oldPriceYearly,
    newPriceYearly,
  } = input;

  if (oldTierName === newTierName) {
    // Cycle change — compute effective annual cost on each side.
    const annual = (
      cycle: "monthly" | "yearly",
      monthly: number,
      yearly: number | null,
    ): number => {
      if (cycle === "yearly" && yearly !== null) return yearly;
      return monthly * 12;
    };
    const oldAnnual = annual(oldCycle, oldPriceMonthly, oldPriceYearly);
    const newAnnual = annual(newCycle, newPriceMonthly, newPriceYearly);
    // Same cycle is caught upstream; this is purely the cycle-flip case.
    return {
      changeType: "cycle_change",
      isDowngrade: newAnnual < oldAnnual,
    };
  }

  // Different tier — pure monthly comparison (BACKEND_BRIEF §3).
  if (newPriceMonthly < oldPriceMonthly) {
    return { changeType: "downgrade", isDowngrade: true };
  }
  return { changeType: "upgrade", isDowngrade: false };
}

/**
 * Trial-eligibility resolver. Returns the number of trial days to grant
 * (0 = no trial), and which trial flag to set on the profile after the
 * subscription writes succeed.
 *
 * Post tier-simplification (20260526120000_simplify_tier_model.sql):
 *   - `premium` (only paid user tier) — 7 days, gated on
 *     `has_used_user_trial`.
 *   - Any trainer tier (`is_trainer_tier = true`) — 14 days, gated on
 *     `has_used_trainer_trial`. Was `_pro`-suffix-checked when Standard
 *     trainer tiers existed; all surviving trainer tiers carry the
 *     former Pro entitlements (AI buddy etc.) so the suffix check is
 *     gone.
 *   - Anything else — no trial.
 */
function resolveTrial(
  tierName: string,
  isTrainerTier: boolean,
  useTrial: boolean,
  hasUsedUserTrial: boolean,
  hasUsedTrainerTrial: boolean,
): { days: number; flag: "user" | "trainer" | null } {
  if (!useTrial) return { days: 0, flag: null };

  const isUserTier = tierName === "premium";
  if (isUserTier) {
    if (hasUsedUserTrial) return { days: 0, flag: null };
    return { days: USER_TIER_TRIAL_DAYS, flag: "user" };
  }

  if (isTrainerTier) {
    if (hasUsedTrainerTrial) return { days: 0, flag: null };
    return { days: TRAINER_TIER_TRIAL_DAYS, flag: "trainer" };
  }

  return { days: 0, flag: null };
}

/**
 * Classify the existing row as reinstatement-eligible or
 * subscription-change. Mirrors legacy line 297-305.
 */
function isReinstateable(
  existing: UserSubscription,
  tierName: string,
  billingCycle: string,
): boolean {
  if (existing.tierName !== tierName) return false;
  if ((existing.billingCycle ?? "monthly") !== billingCycle) return false;
  const status = existing.paymentStatus ?? "";
  return REINSTATEMENT_STATUSES.has(status);
}

function readMetadata(row: UserSubscription): Record<string, unknown> {
  return (row.metadata as Record<string, unknown> | null) ?? {};
}

function readStringMeta(
  meta: Record<string, unknown>,
  key: string,
): string | null {
  const value = meta[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Get or create the Stripe customer for this user. Reuses
 * `metadata.stripe_customer_id` from any prior row when it's still
 * resolvable by Stripe; falls back to creating a new customer.
 */
async function resolveCustomerId(
  stripe: Stripe,
  userId: string,
  existing: UserSubscription | null,
  profile: { email: string | null; fullName: string | null },
  baseKey: string,
): Promise<string> {
  const existingCustomerId = existing
    ? readStringMeta(readMetadata(existing), "stripe_customer_id")
    : null;

  if (existingCustomerId !== null) {
    try {
      await stripe.customers.retrieve(existingCustomerId);
      return existingCustomerId;
    } catch {
      // Customer was deleted on Stripe's side (rare — manual ops or a
      // test-mode reset). Fall through to create a fresh one.
    }
  }

  // Idempotency key (spec 17 / Phase A): a retry of this flow must not
  // create a second Stripe customer for the user.
  const customer = await stripe.customers.create(
    {
      email: profile.email ?? undefined,
      name: profile.fullName ?? undefined,
      metadata: { supabase_user_id: userId },
    },
    { idempotencyKey: opKey(baseKey, "customer") },
  );
  return customer.id;
}

/**
 * Attach the payment method to the customer and set as default. Tolerates
 * the `resource_already_exists` error (PM is already attached to this
 * customer — fine, proceed). Any other attach failure surfaces as a 400
 * up to the caller.
 */
async function attachPaymentMethod(
  stripe: Stripe,
  customerId: string,
  paymentMethodId: string,
  baseKey: string,
): Promise<void> {
  try {
    await stripe.paymentMethods.attach(
      paymentMethodId,
      { customer: customerId },
      { idempotencyKey: opKey(baseKey, "pm-attach") },
    );
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code !== "resource_already_exists") {
      throw err;
    }
  }
  await stripe.customers.update(
    customerId,
    { invoice_settings: { default_payment_method: paymentMethodId } },
    { idempotencyKey: opKey(baseKey, "cust-update") },
  );
}

/**
 * Reinstate the existing Stripe subscription. The PM has already been
 * attached + set as default; here we flip `cancel_at_period_end: false`
 * + set the new default PM on the sub itself + re-read state from
 * Stripe + update the local row.
 *
 * Trial flags are NOT touched — reinstatement doesn't consume a trial
 * (Brad Q6 sign-off + legacy 429-430). The Stripe sub's trial_end is
 * also unaffected by the resume — if the user was mid-trial when they
 * cancelled, they keep whatever was left of the trial.
 *
 * 3DS handling: if the resumed sub's latest_invoice.payment_intent is
 * `requires_action`, we return the client_secret + write the local row
 * as `payment_status=pending` with `requires_3d_secure: true`. Mirrors
 * the new-sub 3DS path so mobile renders the same Apple Pay challenge
 * sheet either way.
 */
type StatusSettable = { set: { status?: number | string } };

async function handleReinstate(args: {
  stripe: Stripe;
  subRepo: SubscriptionRepository;
  ctx: StatusSettable;
  existing: UserSubscription;
  existingStripeSubId: string;
  paymentMethodId: string;
  baseKey: string;
}): Promise<SuccessResponse | ErrorResponse> {
  const {
    stripe,
    subRepo,
    ctx,
    existing,
    existingStripeSubId,
    paymentMethodId,
    baseKey,
  } = args;

  let resumed: Stripe.Subscription;
  try {
    // Cast the SDK response down to the bare Subscription shape —
    // `Stripe.Response<T>` adds non-indexable metadata that breaks
    // downstream property reads. Same pattern as
    // eventHandlers/subscriptionUpdated.ts line 320-322.
    // Idempotency key (spec 17 / Phase A): a retried reinstate must not
    // re-mutate the sub twice.
    resumed = (await stripe.subscriptions.update(
      existingStripeSubId,
      {
        cancel_at_period_end: false,
        default_payment_method: paymentMethodId,
        expand: ["latest_invoice.payment_intent"],
      },
      { idempotencyKey: opKey(baseKey, "sub-update") },
    )) as unknown as Stripe.Subscription;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[subscriptions:create:reinstate] stripe.subscriptions.update failed for ${existingStripeSubId}: ${message}`,
    );
    ctx.set.status = 500;
    return {
      error: `Failed to reinstate subscription. Please try again or contact support.`,
    };
  }

  const requiresActionIntent = readRequiresActionIntent(resumed);
  const paymentStatus = requiresActionIntent
    ? "pending"
    : derivePaymentStatus(resumed);
  const expiresAt = periodEndDate(resumed);
  const trialEndsAt = trialEndDate(resumed);

  // Preserve prior metadata (esp. stripe_customer_id, platform) and
  // append the reinstatement audit stamp. The DB trigger picks up the
  // updated row and recomputes profiles.role / subscription_limits.
  const existingMeta = readMetadata(existing);
  const newMeta: Record<string, unknown> = {
    ...existingMeta,
    stripe_subscription_id: resumed.id,
    stripe_payment_method_id: paymentMethodId,
    reinstated_at: new Date().toISOString(),
  };
  if (requiresActionIntent) {
    newMeta.requires_3d_secure = true;
  } else {
    // Clear the flag if a prior 3DS-requiring reinstate has now cleared.
    delete newMeta.requires_3d_secure;
  }

  const updated = await subRepo.updateById(existing.id, {
    paymentStatus,
    trialEndsAt,
    expiresAt,
    nextBillingDate: expiresAt,
    externalSubscriptionId: resumed.id,
    cancelledAt: null, // reinstatement clears the prior cancellation stamp
    metadata: newMeta,
  });

  if (updated === null) {
    // Should be impossible — caller located `existing` by primary key
    // immediately above. Surface as 500 so it shows up loudly.
    console.error(
      `[subscriptions:create:reinstate] updateById returned null for user_subscriptions.id=${existing.id}; Stripe sub ${resumed.id} was resumed but local row could not be updated — manual intervention required`,
    );
    ctx.set.status = 500;
    return {
      error: `Reinstatement partially successful but database update failed. Please contact support with subscription ID: ${resumed.id}`,
    };
  }

  if (requiresActionIntent) {
    return {
      success: true,
      requires_action: true,
      subscription_id: updated.id,
      stripe_subscription_id: resumed.id,
      trial_ends_at: toIso(trialEndsAt),
      next_billing_date: toIso(expiresAt),
      payment_status: "pending",
      client_secret: requiresActionIntent.client_secret ?? undefined,
      reinstated: true,
      // Reinstate is always immediate — no scheduled effective date.
      change_type: "reinstate",
      scheduled: false,
      effective_at: null,
      is_trial: false, // pending != trialing
    };
  }

  return {
    success: true,
    requires_action: false,
    subscription_id: updated.id,
    stripe_subscription_id: resumed.id,
    trial_ends_at: toIso(trialEndsAt),
    next_billing_date: toIso(expiresAt),
    payment_status: paymentStatus,
    reinstated: true,
    change_type: "reinstate",
    scheduled: false,
    effective_at: null,
    is_trial: paymentStatus === "trialing",
  };
}

/**
 * Subscription-change branch. Caller has already attached the payment
 * method and resolved the Stripe customer id.
 *
 * Webhook-driven cleanup contract (Brad Q10 sign-off):
 *   The new Stripe sub is created with
 *   `metadata.old_stripe_subscription_id` set. The local row is updated
 *   (NOT inserted — we're reusing the existing primary key so the partial-
 *   unique-index on (user_id) WHERE payment_status IN ('active','pending')
 *   never collides) with the same marker plus a clean payment_status from
 *   the new sub. When Stripe later fires
 *   `customer.subscription.updated` on the new sub:
 *     - status=active|trialing → eventHandlers/subscriptionUpdated.ts
 *       cancels the OLD Stripe sub (with retry + already-cancelled
 *       tolerance from Phase 1) and clears the marker.
 *     - status=incomplete_expired → same handler retrieves the OLD sub
 *       from Stripe and rolls the local row back to its state.
 *
 * The synchronous endpoint never tries to cancel inline — that was the
 * legacy "billed twice on cancel-fail" failure mode. If the new sub
 * never makes it out of `incomplete`, Stripe automatically transitions
 * it to `incomplete_expired` after 23 hours, which triggers the
 * rollback path on its own.
 *
 * Trial flags + scheduled_downgrade marker:
 *   - Trial eligibility is computed the same way as new-sub
 *     (`resolveTrial`) — the user gets a trial only if they haven't
 *     used one for that tier family yet. Flags are flipped immediately
 *     on trial-using paths (including 3DS), same anti-farming behaviour
 *     as new-sub.
 *   - If the existing row carries a `scheduled_downgrade` metadata
 *     marker (user previously requested a downgrade-at-period-end),
 *     this fresh change supersedes that intent — clear the marker
 *     (Brad Q7 sign-off).
 */
async function handleSubscriptionChange(args: {
  stripe: Stripe;
  subRepo: SubscriptionRepository;
  profileRepo: ProfileRepository;
  ctx: StatusSettable;
  userId: string;
  existing: UserSubscription;
  existingStripeSubId: string;
  customerId: string;
  priceInfo: {
    priceId: string;
    currency: string;
    isTrainerTier: boolean;
    priceMonthlyAmount: number;
    priceYearlyAmount: number | null;
  };
  tierName: string;
  billingCycle: "monthly" | "yearly";
  paymentMethodId: string;
  platform: "ios" | "android" | null;
  trial: { days: number; flag: "user" | "trainer" | null };
  /**
   * Pre-computed discriminator (upgrade / downgrade / cycle_change) for
   * the response shape. Caller derives this from tier prices BEFORE
   * dispatching here so the with-PM and no-PM change paths use the
   * same comparison logic.
   */
  changeType: ChangeType;
  /** True for downgrades / unfavourable cycle changes → schedule to period-end. */
  isDowngrade: boolean;
  baseKey: string;
}): Promise<SuccessResponse | ErrorResponse> {
  const {
    stripe,
    subRepo,
    profileRepo,
    ctx,
    userId,
    existing,
    existingStripeSubId,
    customerId,
    priceInfo,
    tierName,
    billingCycle,
    paymentMethodId,
    platform,
    trial,
    changeType,
    isDowngrade,
    baseKey,
  } = args;

  // In-flight chained-change guard now lives at the top of the POST
  // handler (above the reinstate/change dispatch) so it covers BOTH
  // branches uniformly — see the comment block at that call site. Was
  // duplicated here pre-sweep-#8; removed to keep a single source of
  // truth.

  const createParams: Stripe.SubscriptionCreateParams = {
    customer: customerId,
    items: [{ price: priceInfo.priceId }],
    payment_behavior: "default_incomplete",
    payment_settings: {
      payment_method_types: ["card"],
      save_default_payment_method: "on_subscription",
    },
    expand: ["latest_invoice.payment_intent"],
    metadata: {
      supabase_user_id: userId,
      tier_name: tierName,
      billing_cycle: billingCycle,
      // Stripe-side marker so the webhook's subscriptionUpdated handler
      // can cancel the old one when the new sub becomes active/trialing.
      // The Phase 1 handler reads this from the LOCAL row's metadata
      // (we set it there below as well), so the Stripe-side metadata is
      // primarily for ops debugging — but harmless and a useful audit.
      old_stripe_subscription_id: existingStripeSubId,
    },
  };
  if (trial.days > 0) {
    createParams.trial_period_days = trial.days;
  }

  let subscription: Stripe.Subscription;
  try {
    // Idempotency key (spec 17 / Phase A): two concurrent / retried
    // change requests with the same intent collapse to one Stripe sub
    // rather than orphaning a duplicate that keeps billing.
    subscription = await stripe.subscriptions.create(createParams, {
      idempotencyKey: opKey(baseKey, "sub-create"),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[subscriptions:create:change] stripe.subscriptions.create failed for user=${userId}: ${message}`,
    );
    ctx.set.status = 500;
    return { error: `Failed to create Stripe subscription: ${message}` };
  }

  const requiresActionIntent = readRequiresActionIntent(subscription);
  const paymentStatus = requiresActionIntent
    ? "pending"
    : derivePaymentStatus(subscription);
  const expiresAt = periodEndDate(subscription);
  const trialEndsAt = trialEndDate(subscription);

  // Preserve relevant prior metadata, layer in the new sub's identifiers,
  // stamp the old-sub marker for the webhook, and DROP any pending
  // scheduling markers (per Brad Q7 — this change supersedes the prior
  // intent).
  //
  // BOTH markers must be dropped here: legacy `scheduled_downgrade` AND
  // M10 `scheduled_change` (stamped by `handleChangeOfTierNoPayment`).
  // Without dropping `scheduled_change`, a user who schedules a downgrade
  // via Management (no-PM path) and then changes tier via Selection with
  // a new payment method ends up with a phantom scheduled-change
  // indicator referencing the superseded downgrade target (Inspector
  // Brad PR #71 high-severity find — sweep #1).
  const existingMeta = readMetadata(existing);
  const {
    scheduled_downgrade: _droppedDowngrade,
    scheduled_change: _droppedScheduledChange,
    ...metaWithoutSchedulingMarkers
  } = existingMeta as Record<string, unknown> & {
    scheduled_downgrade?: unknown;
    scheduled_change?: unknown;
  };
  void _droppedDowngrade;
  void _droppedScheduledChange;

  const newMeta: Record<string, unknown> = {
    ...metaWithoutSchedulingMarkers,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_payment_method_id: paymentMethodId,
    // Only overwrite `platform` when the caller explicitly sent one. The
    // spread above carries the prior row's platform (set at original buy
    // time), so a returning iOS user who changes tier from a caller that
    // omits `platform` keeps their iOS attribution rather than getting
    // it nulled out (Inspector Brad PR #70 medium-severity find).
    ...(platform !== null ? { platform } : {}),
    payment_type: "apple_pay_or_google_pay",
    old_stripe_subscription_id: existingStripeSubId,
  };
  // Mirror the reinstate path's explicit set-or-delete for the 3DS flag.
  // The bare ternary spread above would only SET the flag on a 3DS-
  // requiring response; without an explicit delete on the else branch,
  // a prior `requires_3d_secure: true` carried in via metaWithoutDowngrade
  // would survive even when the new sub doesn't need 3DS — leaving the UI
  // showing a 3DS-pending state on an active row (Inspector Brad PR #70
  // medium-severity find).
  if (requiresActionIntent) {
    newMeta.requires_3d_secure = true;
  } else {
    delete newMeta.requires_3d_secure;
  }

  let updated: UserSubscription | null;
  try {
    updated = await subRepo.updateById(existing.id, {
      tierName,
      billingCycle,
      currency: priceInfo.currency,
      paymentStatus,
      startsAt: new Date(),
      expiresAt,
      trialEndsAt,
      nextBillingDate: expiresAt,
      externalSubscriptionId: subscription.id,
      cancelledAt: null, // change clears any prior cancellation stamp
      metadata: newMeta,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[subscriptions:create:change] DB update failed for stripe_sub=${subscription.id}: ${message} — rolling back Stripe subscription`,
    );
    await stripe.subscriptions.cancel(subscription.id).catch((cancelErr) => {
      const cm =
        cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
      console.error(
        `[subscriptions:create:change] Stripe rollback ALSO failed for ${subscription.id}: ${cm} — manual intervention required`,
      );
    });
    ctx.set.status = 500;
    return { error: `Failed to update subscription record: ${message}` };
  }

  if (updated === null) {
    // Existing row went missing between findMostRecentForUser and now.
    // Almost certainly impossible — the user is JWT-bound and the row
    // was looked up by the same userId — but log + roll back the new
    // Stripe sub so we don't strand a paid sub against no DB row.
    console.error(
      `[subscriptions:create:change] updateById returned null for user_subscriptions.id=${existing.id}; rolling back new Stripe sub ${subscription.id}`,
    );
    await stripe.subscriptions.cancel(subscription.id).catch((cancelErr) => {
      const cm =
        cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
      console.error(
        `[subscriptions:create:change] Stripe rollback after null update ALSO failed for ${subscription.id}: ${cm}`,
      );
    });
    ctx.set.status = 500;
    return {
      error: `Subscription change failed — existing record could not be located. Please contact support with subscription ID: ${subscription.id}`,
    };
  }

  // Trial flag flip (same anti-farming behaviour as new-sub).
  if (trial.flag !== null) {
    const updateData =
      trial.flag === "user"
        ? { hasUsedUserTrial: true }
        : { hasUsedTrainerTrial: true };
    try {
      await profileRepo.update(userId, updateData);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[subscriptions:create:change] trial flag update failed for user=${userId}: ${message} — partial-unique-index will still block duplicate active sub`,
      );
    }
  }

  // Discriminator-driven scheduling. The with-PM path uses
  // subscriptions.create() (not subscriptions.update()), so Stripe bills
  // the new sub at creation time regardless of `isDowngrade`. The
  // `scheduled` / `effective_at` fields in the response advertise the
  // INTENT of the change (downgrade scheduled for period-end) to the
  // mobile presenter; the actual deferral of the old sub's cancellation
  // is webhook-driven (see eventHandlers/subscriptionUpdated.ts).
  const scheduled = isDowngrade;
  const effectiveAt = scheduled ? toIso(expiresAt) : null;

  if (requiresActionIntent) {
    return {
      success: true,
      requires_action: true,
      subscription_id: updated.id,
      stripe_subscription_id: subscription.id,
      trial_ends_at: toIso(trialEndsAt),
      next_billing_date: toIso(expiresAt),
      payment_status: "pending",
      client_secret: requiresActionIntent.client_secret ?? undefined,
      change_type: changeType,
      scheduled,
      effective_at: effectiveAt,
      is_trial: false, // pending != trialing
    };
  }

  return {
    success: true,
    requires_action: false,
    subscription_id: updated.id,
    stripe_subscription_id: subscription.id,
    trial_ends_at: toIso(trialEndsAt),
    next_billing_date: toIso(expiresAt),
    payment_status: paymentStatus,
    change_type: changeType,
    scheduled,
    effective_at: effectiveAt,
    is_trial: paymentStatus === "trialing",
  };
}

/**
 * No-payment-method change-of-tier branch (M10 / AC 3.3, 3.4).
 *
 * The caller has an active Stripe subscription on a different tier (or
 * the same tier but a different billing cycle) and wants to switch
 * without supplying a new payment method — Stripe falls back to the
 * customer's existing default PM on file. This is the Subscription
 * Management screen's upgrade/downgrade flow.
 *
 * **Differs from `handleSubscriptionChange`** in two key ways:
 *
 *   1. Calls `stripe.subscriptions.update()` on the EXISTING Stripe sub
 *      (not `subscriptions.create()`). The local row keeps its
 *      `external_subscription_id`; no `old_stripe_subscription_id`
 *      marker is needed because there's no "old vs new" sub to clean up.
 *
 *   2. Honours the upgrade/downgrade discriminator semantically:
 *        - Upgrade (newPrice > oldPrice): `proration_behavior: "always_invoice"`
 *          → Stripe bills the prorated difference immediately, item swap
 *          takes effect now.
 *        - Downgrade (newPrice < oldPrice) or unfavourable cycle change:
 *          `proration_behavior: "none"` + `billing_cycle_anchor:
 *          "unchanged"` → Stripe holds the change until the current
 *          period ends. We ALSO stamp `metadata.scheduled_change` on the
 *          local row so `GET /subscriptions/me` can surface the
 *          "Scheduled: <next_tier> (effective <date>)" indicator
 *          (AC 3.7).
 *
 * Trial flags are NOT touched — switching tiers with an existing PM is
 * never a trial-using path (the trialing window is implicit in the
 * original Stripe sub, which we're keeping).
 *
 * Trigger contract: writes only to `user_subscriptions`. Never touches
 * `profiles.subscription_id` / `profiles.role` / `subscription_limits.*`.
 */
async function handleChangeOfTierNoPayment(args: {
  stripe: Stripe;
  subRepo: SubscriptionRepository;
  ctx: StatusSettable;
  userId: string;
  existing: UserSubscription;
  existingStripeSubId: string;
  newTierName: string;
  newBillingCycle: "monthly" | "yearly";
  newPriceInfo: {
    priceId: string;
    currency: string;
    isTrainerTier: boolean;
    priceMonthlyAmount: number;
    priceYearlyAmount: number | null;
  };
  changeType: ChangeType;
  isDowngrade: boolean;
  baseKey: string;
}): Promise<SuccessResponse | ErrorResponse> {
  const {
    stripe,
    subRepo,
    ctx,
    userId,
    existing,
    existingStripeSubId,
    newTierName,
    newBillingCycle,
    newPriceInfo,
    changeType,
    isDowngrade,
    baseKey,
  } = args;

  // Retrieve the existing Stripe sub so we can read the current sub-item
  // id (needed to swap the price via items[].id + price). Stripe rejects
  // updates that pass only `price` without the item id.
  let existingStripeSub: Stripe.Subscription;
  try {
    existingStripeSub = (await stripe.subscriptions.retrieve(
      existingStripeSubId,
      { expand: ["items"] },
    )) as unknown as Stripe.Subscription;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[subscriptions:create:change-no-pm] stripe.subscriptions.retrieve failed for ${existingStripeSubId}: ${message}`,
    );
    ctx.set.status = 500;
    return { error: `Failed to load existing subscription: ${message}` };
  }

  const subscriptionItemId = existingStripeSub.items?.data?.[0]?.id;
  if (
    typeof subscriptionItemId !== "string" ||
    subscriptionItemId.length === 0
  ) {
    console.error(
      `[subscriptions:create:change-no-pm] existing Stripe sub ${existingStripeSubId} has no subscription items — cannot swap price`,
    );
    ctx.set.status = 500;
    return {
      error: "Existing subscription has no items on Stripe; cannot change tier",
    };
  }

  const updateParams: Stripe.SubscriptionUpdateParams = {
    items: [
      {
        id: subscriptionItemId,
        price: newPriceInfo.priceId,
      },
    ],
    expand: ["latest_invoice.payment_intent"],
    metadata: {
      ...(existingStripeSub.metadata ?? {}),
      supabase_user_id: userId,
      tier_name: newTierName,
      billing_cycle: newBillingCycle,
    },
  };

  if (isDowngrade) {
    // Hold the price change until the current period ends. Stripe
    // continues billing the old price; the item swaps at the next
    // invoice. NOT a trial reset — `billing_cycle_anchor: "unchanged"`
    // keeps the existing renewal date.
    updateParams.proration_behavior = "none";
    updateParams.billing_cycle_anchor = "unchanged";
  } else {
    // Upgrade — Stripe bills the prorated difference immediately on
    // an invoice generated for the change. The new tier takes effect
    // from this moment.
    updateParams.proration_behavior = "always_invoice";
  }

  let updatedSub: Stripe.Subscription;
  try {
    // Idempotency key (spec 17 / Phase A): a retried tier change must not
    // re-apply the proration / item swap twice.
    updatedSub = (await stripe.subscriptions.update(
      existingStripeSubId,
      updateParams,
      { idempotencyKey: opKey(baseKey, "sub-update") },
    )) as unknown as Stripe.Subscription;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[subscriptions:create:change-no-pm] stripe.subscriptions.update failed for ${existingStripeSubId}: ${message}`,
    );
    ctx.set.status = 500;
    return { error: `Failed to change subscription tier: ${message}` };
  }

  const requiresActionIntent = readRequiresActionIntent(updatedSub);
  const paymentStatus = requiresActionIntent
    ? "pending"
    : derivePaymentStatus(updatedSub);
  const expiresAt = periodEndDate(updatedSub);
  const trialEndsAt = trialEndDate(updatedSub);

  // Build the metadata patch for the local row.
  //   - Downgrade: stamp `scheduled_change` so `GET /subscriptions/me`
  //     can render the indicator (AC 3.7). The actual tier_name on the
  //     local row stays UNCHANGED until the webhook applies the new
  //     tier when the period rolls over (`subscriptionUpdated.ts`
  //     observes the price change at next-invoice time).
  //   - Upgrade/cycle-change-as-upgrade: clear any stale
  //     `scheduled_change` marker (the user superseded their prior
  //     downgrade intent by upgrading instead).
  const existingMeta = readMetadata(existing);
  const newMeta: Record<string, unknown> = { ...existingMeta };

  // Always clear any prior `scheduled_change` marker before deciding
  // whether to stamp a new one. Without the unconditional delete, a
  // downgrade attempt whose `expiresAt` comes back unreadable from
  // Stripe (effectiveAtIso === null) would silently preserve the prior
  // downgrade target on the row (Inspector Brad PR #71 medium-severity
  // find — sweep #1).
  delete newMeta.scheduled_change;

  if (isDowngrade) {
    const effectiveAtIso = toIso(expiresAt);
    if (effectiveAtIso !== null) {
      newMeta.scheduled_change = {
        next_tier_name: newTierName,
        next_billing_cycle: newBillingCycle,
        effective_at: effectiveAtIso,
      };
    }
  }

  // The 3DS marker bookkeeping mirrors the with-PM change path.
  if (requiresActionIntent) {
    newMeta.requires_3d_secure = true;
  } else {
    delete newMeta.requires_3d_secure;
  }

  // For downgrade: keep tier_name + billing_cycle UNCHANGED on the local
  // row. The webhook (`subscriptionUpdated.ts`) flips it when the period
  // rolls over. This way `GET /subscriptions/me` returns the current
  // tier as the active tier and `scheduled_change` as the pending one.
  //
  // For upgrade/cycle-change-as-upgrade: the price change took effect
  // now, so flip tier_name + billing_cycle immediately.
  const patch: Partial<UserSubscription> = {
    paymentStatus,
    expiresAt,
    trialEndsAt,
    nextBillingDate: expiresAt,
    metadata: newMeta,
  };

  if (!isDowngrade) {
    patch.tierName = newTierName;
    patch.billingCycle = newBillingCycle;
    patch.currency = newPriceInfo.currency;
  }

  let updated: UserSubscription | null;
  try {
    updated = await subRepo.updateById(existing.id, patch);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // No Stripe rollback — Stripe's mutation already landed and reverting
    // would require swapping the price back, which can itself fail and
    // strand things in a worse state. Log loudly so ops can backfill.
    console.error(
      `[subscriptions:create:change-no-pm] DB update failed for stripe_sub=${existingStripeSubId}: ${message} — Stripe-side change applied but local row not updated; manual backfill required`,
    );
    ctx.set.status = 500;
    return { error: `Failed to update subscription record: ${message}` };
  }

  if (updated === null) {
    console.error(
      `[subscriptions:create:change-no-pm] updateById returned null for user_subscriptions.id=${existing.id} — Stripe sub ${existingStripeSubId} updated but local row could not be found`,
    );
    ctx.set.status = 500;
    return {
      error: `Subscription change applied on Stripe but local record could not be updated. Please contact support with subscription ID: ${existingStripeSubId}`,
    };
  }

  const scheduled = isDowngrade;
  const effectiveAt = scheduled ? toIso(expiresAt) : null;

  if (requiresActionIntent) {
    return {
      success: true,
      requires_action: true,
      subscription_id: updated.id,
      stripe_subscription_id: existingStripeSubId,
      trial_ends_at: toIso(trialEndsAt),
      next_billing_date: toIso(expiresAt),
      payment_status: "pending",
      client_secret: requiresActionIntent.client_secret ?? undefined,
      change_type: changeType,
      scheduled,
      effective_at: effectiveAt,
      is_trial: false,
    };
  }

  return {
    success: true,
    requires_action: false,
    subscription_id: updated.id,
    stripe_subscription_id: existingStripeSubId,
    trial_ends_at: toIso(trialEndsAt),
    next_billing_date: toIso(expiresAt),
    payment_status: paymentStatus,
    change_type: changeType,
    scheduled,
    effective_at: effectiveAt,
    is_trial: paymentStatus === "trialing",
  };
}

export const subscriptionsCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post(
    "/subscriptions",
    async (ctx): Promise<SuccessResponse | ErrorResponse> => {
      const { sub: userId } = getUser(ctx);
      const body = ctx.body as CreateSubscriptionBody;

      if (body.tier_name === "free") {
        ctx.set.status = 400;
        return {
          error:
            "Cannot create subscription for free tier. Free tier is the default state.",
        };
      }

      const priceInfo = await resolvePrice(body.tier_name, body.billing_cycle);
      if (priceInfo === null) {
        ctx.set.status = 400;
        return {
          error: `Stripe price id not configured for ${body.tier_name} ${body.billing_cycle}`,
        };
      }

      const profileRepo = new ProfileRepository();
      const profile = await profileRepo.getById(userId);
      if (profile === null) {
        ctx.set.status = 404;
        return { error: "User profile not found" };
      }

      const subRepo = new SubscriptionRepository();
      const existing = await subRepo.findMostRecentForUser(userId);
      const existingStripeSubId =
        existing !== null
          ? readStringMeta(readMetadata(existing), "stripe_subscription_id")
          : null;

      // Idempotency base key (spec 17 / Phase A, closes HIGH-1). Computed
      // once and namespaced per outbound Stripe call via `opKey`. Uses the
      // client-supplied key when present (stable per user action); otherwise
      // derives deterministically from the request intent so a retry of the
      // SAME action dedupes while a genuinely different action stays
      // distinct. `existingStripeSubId` is part of the derivation so a
      // resubscribe-after-cancel (different/absent sub id) never falsely
      // dedupes against a prior attempt.
      const idempotencyBaseKey = deriveSubscriptionBaseKey({
        clientKey: body.idempotency_key,
        userId,
        tierName: body.tier_name,
        billingCycle: body.billing_cycle,
        paymentMethodId: body.payment_method_id ?? null,
        existingExternalSubscriptionId: existingStripeSubId,
      });

      // ─── In-flight chained-change guard ──────────────────────────────
      // Refuse ANY follow-up flow (reinstate, change-of-tier) when the
      // existing row carries an `old_stripe_subscription_id` marker
      // from a previous change that hasn't been webhook-resolved yet.
      //
      // Trigger (Brad sweep #8): user has trialing premium → changes
      // tier → sub_B created in trialing, row.metadata.old_stripe_
      // subscription_id = sub_A. cancelOldSubscriptionWithRetry
      // exhausts (3 attempts) or webhook delivery is out, so the
      // marker is preserved. User then re-submits POST /subscriptions
      // for the SAME tier (e.g. to update payment method on the now-
      // trialing sub_B). Dispatch routes them through reinstate;
      // handleReinstate spreads `...existingMeta` into the new
      // metadata blob, preserving the marker; sub_A keeps billing
      // forever because subscriptionUpdated.ts's cancel-of-old branch
      // only fires on a STATUS TRANSITION into active/trialing — sub_B
      // was already trialing, no new event triggers it.
      //
      // The check was originally inside handleSubscriptionChange
      // (Brad sweep #2). Lifted here so reinstate + any future branch
      // gets the same guard from one source of truth.
      if (existing !== null) {
        const existingMetaPrecheck = readMetadata(existing);
        const inFlightOldMarker = readStringMeta(
          existingMetaPrecheck,
          "old_stripe_subscription_id",
        );
        if (inFlightOldMarker !== null) {
          console.warn(
            `[subscriptions:create] refusing follow-up flow for user=${userId}: in-flight old_stripe_subscription_id=${inFlightOldMarker} (previous change not yet webhook-resolved)`,
          );
          ctx.set.status = 409;
          return {
            error:
              "A previous subscription change is still being processed. Please wait a few minutes and try again.",
          };
        }
      }

      // Existing-active subscription handle: a sub is considered "active"
      // from the dispatch's perspective if the user has a row with a Stripe
      // subscription id (regardless of payment_status). Used by the no-PM
      // path which only operates on a live Stripe sub.
      const hasActiveSub = existing !== null && existingStripeSubId !== null;
      const hasPaymentMethod = typeof body.payment_method_id === "string";

      // ─── No-payment-method precedence (M10 / BACKEND_BRIEF §3) ────────
      //
      //   2. No PM + no active sub → 422
      //   3. No PM + active sub + same tier + same cycle → 400 (no-op)
      //   4. No PM + active sub + different tier or cycle → change-of-tier
      //      via stripe.subscriptions.update() using customer's default PM
      //
      // These precede the with-PM dispatch (cases 5–7) which preserves
      // the PR #70 paths verbatim.
      if (!hasPaymentMethod) {
        if (!hasActiveSub) {
          ctx.set.status = 422;
          return {
            error: "payment_method_id required for new subscription",
          };
        }

        // existing + existingStripeSubId both non-null (hasActiveSub = true).
        const existingTierName = existing!.tierName;
        const existingBillingCycle = (existing!.billingCycle ?? "monthly") as
          | "monthly"
          | "yearly";

        if (
          existingTierName === body.tier_name &&
          existingBillingCycle === body.billing_cycle
        ) {
          ctx.set.status = 400;
          return { error: "no change to apply" };
        }

        // Look up the EXISTING tier's prices for the change-type
        // classification. Out-of-band data (row references a deleted
        // tier) defaults to a zero comparison → tagged as "upgrade".
        const oldPrices = await resolveTierPrices(existingTierName);
        const safeOldPrices = oldPrices ?? {
          priceMonthly: 0,
          priceYearly: null,
        };
        const { changeType, isDowngrade } = deriveChangeType({
          oldTierName: existingTierName,
          newTierName: body.tier_name,
          oldCycle: existingBillingCycle,
          newCycle: body.billing_cycle,
          oldPriceMonthly: safeOldPrices.priceMonthly,
          newPriceMonthly: priceInfo.priceMonthlyAmount,
          oldPriceYearly: safeOldPrices.priceYearly,
          newPriceYearly: priceInfo.priceYearlyAmount,
        });

        const stripe = getStripe();
        return handleChangeOfTierNoPayment({
          stripe,
          subRepo,
          ctx,
          userId,
          existing: existing!,
          existingStripeSubId: existingStripeSubId!,
          newTierName: body.tier_name,
          newBillingCycle: body.billing_cycle,
          newPriceInfo: priceInfo,
          changeType,
          isDowngrade,
          baseKey: idempotencyBaseKey,
        });
      }

      // Branch dispatch (with-PM paths — preserved verbatim from PR #70):
      //   - existing reinstate-eligible (same tier + cycle, status in
      //     {cancelled, canceled, past_due, trialing}) AND we have the
      //     prior Stripe sub id → reinstate path
      //   - existing with stripe sub id (anything else) → subscription-
      //     change path (Phase 2A.3)
      //   - otherwise → new-subscription path
      const paymentMethodId = body.payment_method_id as string;
      if (
        hasActiveSub &&
        isReinstateable(existing!, body.tier_name, body.billing_cycle)
      ) {
        const stripe = getStripe();
        const customerId = await resolveCustomerId(
          stripe,
          userId,
          existing,
          {
            email: profile.email ?? null,
            fullName: profile.fullName ?? null,
          },
          idempotencyBaseKey,
        );
        try {
          await attachPaymentMethod(
            stripe,
            customerId,
            paymentMethodId,
            idempotencyBaseKey,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(
            `[subscriptions:create] attach payment method failed for user=${userId} on reinstate: ${message}`,
          );
          ctx.set.status = 400;
          return { error: `Failed to attach payment method: ${message}` };
        }
        return handleReinstate({
          stripe,
          subRepo,
          ctx,
          existing: existing!,
          existingStripeSubId: existingStripeSubId!,
          paymentMethodId,
          baseKey: idempotencyBaseKey,
        });
      }
      // --- Subscription-change path (Phase 2A.3) --------------------------
      // Different tier OR billing cycle, OR same tier+cycle but status not
      // in the reinstateable set. Create a NEW Stripe subscription and
      // stamp the previous Stripe sub id into BOTH the new Stripe sub's
      // metadata AND the local row's metadata. The webhook handler
      // (subscriptionUpdated.ts) drives the eventual:
      //   - cancel-of-old when the new sub transitions to active/trialing
      //   - rollback-to-original when the new sub fails as incomplete_expired
      // This pattern removes the legacy's "billed twice" failure mode
      // (Brad Q10 sign-off).
      if (hasActiveSub) {
        const stripe = getStripe();
        const customerId = await resolveCustomerId(
          stripe,
          userId,
          existing,
          {
            email: profile.email ?? null,
            fullName: profile.fullName ?? null,
          },
          idempotencyBaseKey,
        );
        try {
          await attachPaymentMethod(
            stripe,
            customerId,
            paymentMethodId,
            idempotencyBaseKey,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(
            `[subscriptions:create] attach payment method failed for user=${userId} on subscription change: ${message}`,
          );
          ctx.set.status = 400;
          return { error: `Failed to attach payment method: ${message}` };
        }

        const trialForChange = resolveTrial(
          body.tier_name,
          priceInfo.isTrainerTier,
          body.use_trial,
          profile.hasUsedUserTrial ?? false,
          profile.hasUsedTrainerTrial ?? false,
        );

        // Derive the change_type discriminator for the response, same
        // semantics as the no-PM path. Looks up the existing tier's
        // prices for the comparison.
        const existingTierName = existing!.tierName;
        const existingBillingCycle = (existing!.billingCycle ?? "monthly") as
          | "monthly"
          | "yearly";
        const oldPrices = await resolveTierPrices(existingTierName);
        const safeOldPrices = oldPrices ?? {
          priceMonthly: 0,
          priceYearly: null,
        };
        const { changeType, isDowngrade } = deriveChangeType({
          oldTierName: existingTierName,
          newTierName: body.tier_name,
          oldCycle: existingBillingCycle,
          newCycle: body.billing_cycle,
          oldPriceMonthly: safeOldPrices.priceMonthly,
          newPriceMonthly: priceInfo.priceMonthlyAmount,
          oldPriceYearly: safeOldPrices.priceYearly,
          newPriceYearly: priceInfo.priceYearlyAmount,
        });

        return handleSubscriptionChange({
          stripe,
          subRepo,
          profileRepo,
          ctx,
          userId,
          existing: existing!,
          existingStripeSubId: existingStripeSubId!,
          customerId,
          priceInfo,
          tierName: body.tier_name,
          billingCycle: body.billing_cycle,
          paymentMethodId,
          platform: body.platform ?? null,
          trial: trialForChange,
          changeType,
          isDowngrade,
          baseKey: idempotencyBaseKey,
        });
      }

      // --- New subscription path -----------------------------------------
      const trial = resolveTrial(
        body.tier_name,
        priceInfo.isTrainerTier,
        body.use_trial,
        profile.hasUsedUserTrial ?? false,
        profile.hasUsedTrainerTrial ?? false,
      );

      const stripe = getStripe();
      const customerId = await resolveCustomerId(
        stripe,
        userId,
        existing,
        {
          email: profile.email ?? null,
          fullName: profile.fullName ?? null,
        },
        idempotencyBaseKey,
      );

      try {
        await attachPaymentMethod(
          stripe,
          customerId,
          paymentMethodId,
          idempotencyBaseKey,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[subscriptions:create] attach payment method failed for user=${userId}: ${message}`,
        );
        ctx.set.status = 400;
        return { error: `Failed to attach payment method: ${message}` };
      }

      const createParams: Stripe.SubscriptionCreateParams = {
        customer: customerId,
        items: [{ price: priceInfo.priceId }],
        payment_behavior: "default_incomplete",
        payment_settings: {
          payment_method_types: ["card"],
          save_default_payment_method: "on_subscription",
        },
        expand: ["latest_invoice.payment_intent"],
        metadata: {
          supabase_user_id: userId,
          tier_name: body.tier_name,
          billing_cycle: body.billing_cycle,
        },
      };
      if (trial.days > 0) {
        createParams.trial_period_days = trial.days;
      }

      let subscription: Stripe.Subscription;
      try {
        // Idempotency key (spec 17 / Phase A): a client retry / double-tap
        // of a brand-new subscribe must not create a second Stripe sub.
        subscription = await stripe.subscriptions.create(createParams, {
          idempotencyKey: opKey(idempotencyBaseKey, "sub-create"),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[subscriptions:create] stripe.subscriptions.create failed for user=${userId}: ${message}`,
        );
        ctx.set.status = 500;
        return { error: `Failed to create Stripe subscription: ${message}` };
      }

      const paymentStatus = derivePaymentStatus(subscription);
      const expiresAt = periodEndDate(subscription);
      const trialEndsAt = trialEndDate(subscription);

      const requiresActionIntent = readRequiresActionIntent(subscription);

      // Persist locally BEFORE flipping trial flags. If the DB insert
      // fails, we cancel the Stripe sub (rollback) so we never leave
      // Stripe + DB in inconsistent states (legacy line 880-890).
      let inserted: UserSubscription;
      try {
        inserted = await subRepo.insert({
          userId,
          tierName: body.tier_name,
          billingCycle: body.billing_cycle,
          currency: priceInfo.currency,
          paymentStatus: requiresActionIntent ? "pending" : paymentStatus,
          startsAt: new Date(),
          expiresAt,
          trialEndsAt,
          nextBillingDate: expiresAt,
          externalSubscriptionId: subscription.id,
          metadata: {
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            stripe_payment_method_id: paymentMethodId,
            platform: body.platform ?? null,
            payment_type: "apple_pay_or_google_pay",
            ...(requiresActionIntent ? { requires_3d_secure: true } : {}),
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[subscriptions:create] DB insert failed for stripe_sub=${subscription.id}: ${message} — rolling back Stripe subscription`,
        );
        // Cancel the just-created Stripe sub so we never strand a billable
        // sub against no local row (keyless one-shot rollback — see design).
        await stripe.subscriptions
          .cancel(subscription.id)
          .catch((cancelErr) => {
            const cm =
              cancelErr instanceof Error
                ? cancelErr.message
                : String(cancelErr);
            console.error(
              `[subscriptions:create] Stripe rollback ALSO failed for ${subscription.id}: ${cm} — manual intervention required`,
            );
          });
        // A unique-violation here means a CONCURRENT request already inserted
        // the user's one live row (the partial unique index — widened in
        // spec 17 / Phase A to include 'trialing'+'past_due' — is the atomic
        // arbiter). This request lost the race; its orphan Stripe sub was
        // just cancelled above. Return 409 (not a bare 500) so the client
        // refreshes and renders the winning subscription, rather than
        // surfacing an internal error for what is a benign double-submit
        // (spec 17 / Phase A, closes HIGH-2 / AC-A2.4).
        if (isUniqueViolation(err)) {
          ctx.set.status = 409;
          return {
            error:
              "A subscription is already being set up for your account. Please refresh and try again.",
          };
        }
        ctx.set.status = 500;
        return { error: `Failed to create subscription record: ${message}` };
      }

      // Flip trial flags immediately on a trial-using path — even on the
      // 3DS branch, so an abandoned challenge can't refarm trials (legacy
      // line 740-765). This is the ONE path where the handler touches
      // `profiles.*`; the DB trigger handles every other derived column.
      if (trial.flag !== null) {
        const updateData =
          trial.flag === "user"
            ? { hasUsedUserTrial: true }
            : { hasUsedTrainerTrial: true };
        try {
          await profileRepo.update(userId, updateData);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // Non-fatal: the subscription is created and recorded. A failed
          // trial-flag flip means the user could theoretically retry and
          // get another trial, but the partial-unique-index on
          // user_subscriptions(active OR pending) will block a duplicate
          // active sub. Log loudly so ops can backfill.
          console.error(
            `[subscriptions:create] trial flag update failed for user=${userId}: ${message} — partial-unique-index will still block duplicate active sub`,
          );
        }
      }

      if (requiresActionIntent) {
        return {
          success: true,
          requires_action: true,
          subscription_id: inserted.id,
          stripe_subscription_id: subscription.id,
          trial_ends_at: toIso(trialEndsAt),
          next_billing_date: toIso(expiresAt),
          payment_status: "pending",
          client_secret: requiresActionIntent.client_secret ?? undefined,
          change_type: "new",
          scheduled: false,
          effective_at: null,
          is_trial: false, // pending != trialing
        };
      }

      return {
        success: true,
        requires_action: false,
        subscription_id: inserted.id,
        stripe_subscription_id: subscription.id,
        trial_ends_at: toIso(trialEndsAt),
        next_billing_date: toIso(expiresAt),
        payment_status: paymentStatus,
        change_type: "new",
        scheduled: false,
        effective_at: null,
        is_trial: paymentStatus === "trialing",
      };
    },
    {
      body: t.Object({
        tier_name: t.String({ minLength: 1 }),
        billing_cycle: t.Union([t.Literal("monthly"), t.Literal("yearly")]),
        // Optional in M10. When absent, the handler routes to the no-
        // payment-method change-of-tier path (reuses the customer's
        // default PM on file with Stripe) — used by the Subscription
        // Management upgrade/downgrade flow. Required for new-sub and
        // reinstate paths; dispatch enforces.
        payment_method_id: t.Optional(t.String({ minLength: 1 })),
        // Required explicit — no silent default. Caller must opt in to
        // trial usage (Brad Q3 sign-off).
        use_trial: t.Boolean(),
        platform: t.Optional(t.Union([t.Literal("ios"), t.Literal("android")])),
        // Optional client-generated idempotency key (spec 17 / Phase A).
        // Backward-compatible: older clients omit it and the backend derives
        // a deterministic key from the request intent.
        idempotency_key: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
      }),
    },
  );

// Export pure internals for direct unit tests (resolveTrial,
// derivePaymentStatus, isReinstateable are easier to exercise
// against a matrix of inputs without spinning up the Elysia harness).
export const __internals = {
  derivePaymentStatus,
  resolveTrial,
  isReinstateable,
  readCurrentPeriodEnd,
  deriveChangeType,
  parseDecimal,
};
