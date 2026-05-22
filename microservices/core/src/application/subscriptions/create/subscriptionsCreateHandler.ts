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

const REINSTATEMENT_STATUSES = new Set([
  "cancelled",
  "canceled",
  "past_due",
  "trialing",
]);

type CreateSubscriptionBody = {
  tier_name: string;
  billing_cycle: "monthly" | "yearly";
  payment_method_id: string;
  use_trial: boolean;
  platform?: "ios" | "android";
};

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
} | null> {
  const db = getDb();
  const rows = await db
    .select({
      priceMonthly: subscriptionTiers.stripePriceIdMonthly,
      priceYearly: subscriptionTiers.stripePriceIdYearly,
      currency: subscriptionTiers.currency,
      isTrainerTier: subscriptionTiers.isTrainerTier,
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
  };
}

/**
 * Trial-eligibility resolver. Returns the number of trial days to grant
 * (0 = no trial), and which trial flag to set on the profile after the
 * subscription writes succeed.
 *
 *   - `premium` (user tier) — 7 days, gated on `has_used_user_trial`.
 *   - `*_pro` (trainer pro tiers) — 14 days, gated on
 *     `has_used_trainer_trial`. Recognised via the
 *     `subscription_tiers.is_trainer_tier` flag rather than a name
 *     prefix sniff — the latter is what legacy did and it's fragile if
 *     a future tier doesn't fit the convention.
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

  const isTrainerPro = isTrainerTier && tierName.endsWith("_pro");
  if (isTrainerPro) {
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

  const customer = await stripe.customers.create({
    email: profile.email ?? undefined,
    name: profile.fullName ?? undefined,
    metadata: { supabase_user_id: userId },
  });
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
): Promise<void> {
  try {
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code !== "resource_already_exists") {
      throw err;
    }
  }
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });
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
}): Promise<SuccessResponse | ErrorResponse> {
  const {
    stripe,
    subRepo,
    ctx,
    existing,
    existingStripeSubId,
    paymentMethodId,
  } = args;

  let resumed: Stripe.Subscription;
  try {
    // Cast the SDK response down to the bare Subscription shape —
    // `Stripe.Response<T>` adds non-indexable metadata that breaks
    // downstream property reads. Same pattern as
    // eventHandlers/subscriptionUpdated.ts line 320-322.
    resumed = (await stripe.subscriptions.update(existingStripeSubId, {
      cancel_at_period_end: false,
      default_payment_method: paymentMethodId,
      expand: ["latest_invoice.payment_intent"],
    })) as unknown as Stripe.Subscription;
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
  priceInfo: { priceId: string; currency: string; isTrainerTier: boolean };
  tierName: string;
  billingCycle: "monthly" | "yearly";
  paymentMethodId: string;
  platform: "ios" | "android" | null;
  trial: { days: number; flag: "user" | "trainer" | null };
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
  } = args;

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
    subscription = await stripe.subscriptions.create(createParams);
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
  // scheduled_downgrade (per Brad Q7 — this change supersedes the prior
  // intent).
  const existingMeta = readMetadata(existing);
  const { scheduled_downgrade: _droppedDowngrade, ...metaWithoutDowngrade } =
    existingMeta as Record<string, unknown> & {
      scheduled_downgrade?: unknown;
    };
  void _droppedDowngrade;

  const newMeta: Record<string, unknown> = {
    ...metaWithoutDowngrade,
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

      // Branch dispatch:
      //   - existing reinstate-eligible (same tier + cycle, status in
      //     {cancelled, canceled, past_due, trialing}) AND we have the
      //     prior Stripe sub id → reinstate path
      //   - existing with stripe sub id (anything else) → subscription-
      //     change path (Phase 2A.3)
      //   - otherwise → new-subscription path
      if (
        existing !== null &&
        existingStripeSubId !== null &&
        isReinstateable(existing, body.tier_name, body.billing_cycle)
      ) {
        const stripe = getStripe();
        const customerId = await resolveCustomerId(stripe, userId, existing, {
          email: profile.email ?? null,
          fullName: profile.fullName ?? null,
        });
        try {
          await attachPaymentMethod(stripe, customerId, body.payment_method_id);
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
          existing,
          existingStripeSubId,
          paymentMethodId: body.payment_method_id,
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
      if (existing !== null && existingStripeSubId !== null) {
        const stripe = getStripe();
        const customerId = await resolveCustomerId(stripe, userId, existing, {
          email: profile.email ?? null,
          fullName: profile.fullName ?? null,
        });
        try {
          await attachPaymentMethod(stripe, customerId, body.payment_method_id);
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

        return handleSubscriptionChange({
          stripe,
          subRepo,
          profileRepo,
          ctx,
          userId,
          existing,
          existingStripeSubId,
          customerId,
          priceInfo,
          tierName: body.tier_name,
          billingCycle: body.billing_cycle,
          paymentMethodId: body.payment_method_id,
          platform: body.platform ?? null,
          trial: trialForChange,
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
      const customerId = await resolveCustomerId(stripe, userId, existing, {
        email: profile.email ?? null,
        fullName: profile.fullName ?? null,
      });

      try {
        await attachPaymentMethod(stripe, customerId, body.payment_method_id);
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
        subscription = await stripe.subscriptions.create(createParams);
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
            stripe_payment_method_id: body.payment_method_id,
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
      };
    },
    {
      body: t.Object({
        tier_name: t.String({ minLength: 1 }),
        billing_cycle: t.Union([t.Literal("monthly"), t.Literal("yearly")]),
        payment_method_id: t.String({ minLength: 1 }),
        // Required explicit — no silent default. Caller must opt in to
        // trial usage (Brad Q3 sign-off).
        use_trial: t.Boolean(),
        platform: t.Optional(t.Union([t.Literal("ios"), t.Literal("android")])),
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
};
