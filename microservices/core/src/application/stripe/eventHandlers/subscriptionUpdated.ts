import type Stripe from "stripe";
import {
  SubscriptionRepository,
  type UserSubscription,
} from "../../repositories/subscriptionRepository";
import { getStripe } from "../stripeClient";
import {
  mapStripeStatusToPaymentStatus,
  mapStripeStatusToPaymentStatusForUpdate,
  readCurrentPeriodEnd,
  readUserIdFromMetadata,
  resolveExpiresAt,
  unixSecondsToDate,
} from "./_helpers";

/**
 * Handler for `customer.subscription.updated` — the heaviest of the
 * webhook event types. Three distinct concerns are fused into one Stripe
 * event:
 *
 *   1. **Basic update.** Refresh payment_status, expires_at, trial_ends_at,
 *      next_billing_date, cancelled_at from Stripe truth.
 *   2. **Scheduled-downgrade activation.** When the outbound flow has set
 *      `metadata.scheduled_downgrade` (e.g. user downgraded mid-period),
 *      Stripe waits until the current period ends, then fires this event
 *      with `cancel_at_period_end=true` and `current_period_end` in the
 *      past. At that point we flip `tier_name` to the scheduled
 *      target and clear the marker.
 *   3. **Subscription-change rollback / commit.** When the outbound flow
 *      created a new subscription as a replacement (upgrade/downgrade
 *      that bypassed reinstatement), it stamps the previous Stripe sub
 *      id into `metadata.old_stripe_subscription_id`. We use the new
 *      sub's status to decide:
 *      - succeeded (active / trialing): cancel the old sub on Stripe
 *        (with retry), clear the metadata marker. **Outbound Stripe
 *        SDK call** — the only one in the inbound path.
 *      - failed (incomplete_expired): retrieve the old sub from Stripe
 *        and restore the local row to its state (tier, billing_cycle,
 *        status, dates, external_subscription_id). The user keeps their
 *        previous subscription.
 *
 * Mirrors legacy stripe-webhook lines 176-544. The branches around the
 * metadata flags only fire for subscriptions whose outbound creation
 * went through the legacy `stripe-create-subscription` (or, after the
 * next milestone, the new `POST /subscriptions`) — both write the same
 * metadata flags, so the inbound handler is agnostic to which outbound
 * created the sub.
 */

const MAX_CANCEL_ATTEMPTS = 3;

/**
 * Cancel an old Stripe subscription with bounded retry. Linear backoff
 * matches legacy line 384 (`setTimeout(resolve, 1000 * cancelAttempts)`)
 * — total wait of 1+2+3 = 6 seconds across 3 attempts. Returns `true`
 * on success, `false` after exhausting retries; caller logs but does
 * not throw, since a stranded old subscription is a billing-side issue
 * that needs manual intervention, not a webhook-retry candidate
 * (Stripe retrying the same event won't change the answer).
 */
/**
 * Detect Stripe errors that mean "the subscription is already cancelled
 * or deleted" — i.e. our previous attempt at this same operation
 * succeeded server-side but couldn't commit the local metadata clear
 * (Neon hiccup mid-operation, etc.) and Stripe is now retrying us.
 *
 * Treating these as success closes the loop the legacy stripe-webhook
 * left open: without this, Stripe retries the same event for ~3 days,
 * burning 6s of Lambda time per delivery on doomed cancel attempts,
 * never reaching the metadata clear (Inspector Brad PR #69
 * medium-severity find).
 *
 * Two error shapes to detect:
 *   - `code: "resource_missing"` — Stripe's standard code when the
 *     target id no longer exists (subscription fully deleted).
 *   - Stripe API error messages containing "already cancel(l)ed" /
 *     "has been canceled" — for partially-deleted-but-readable subs.
 */
function isAlreadyCanceledError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code =
    (err as { code?: unknown }).code ??
    (err as { raw?: { code?: unknown } }).raw?.code;
  if (code === "resource_missing") return true;
  const message = err instanceof Error ? err.message : String(err);
  return /already\s+cancell?ed|has been cancell?ed/i.test(message);
}

async function cancelOldSubscriptionWithRetry(oldId: string): Promise<boolean> {
  const stripe = getStripe();
  for (let attempt = 1; attempt <= MAX_CANCEL_ATTEMPTS; attempt += 1) {
    try {
      await stripe.subscriptions.cancel(oldId);
      console.log(
        `[stripe:subscription.updated] cancelled old sub ${oldId} on attempt ${attempt}`,
      );
      return true;
    } catch (err) {
      if (isAlreadyCanceledError(err)) {
        // Idempotent recovery: a previous delivery cancelled the sub on
        // Stripe's side but failed to clear our local metadata. We're
        // here on a retry — proceed to the metadata clear as if the
        // cancel succeeded.
        console.log(
          `[stripe:subscription.updated] old sub ${oldId} already cancelled on Stripe — treating as success and clearing local marker`,
        );
        return true;
      }
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[stripe:subscription.updated] cancel attempt ${attempt} for ${oldId} failed: ${message}`,
      );
      if (attempt < MAX_CANCEL_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  console.error(
    `[stripe:subscription.updated] failed to cancel old sub ${oldId} after ${MAX_CANCEL_ATTEMPTS} attempts — manual intervention required`,
  );
  return false;
}

/**
 * Resolve the tier_name + billing_cycle for an "original" subscription
 * we're rolling back to. The legacy queries `subscription_tiers` to map
 * the price_id back to a tier name; we do the same via a direct Drizzle
 * query inlined here (it's a one-shot lookup, doesn't justify a whole
 * repository method).
 *
 * Returns null when no tier matches the price — caller falls back to
 * "free"/monthly defaults (matches legacy lines 461-462).
 */
async function resolveTierForPrice(priceId: string): Promise<{
  tierName: string;
  billingCycle: "monthly" | "yearly";
} | null> {
  const { eq, or } = await import("drizzle-orm");
  const { subscriptionTiers } = await import("@persistence/db");
  const { getDb } = await import("@persistence/db/client");

  const db = getDb();
  const rows = await db
    .select({
      tierName: subscriptionTiers.tierName,
      monthly: subscriptionTiers.stripePriceIdMonthly,
      yearly: subscriptionTiers.stripePriceIdYearly,
    })
    .from(subscriptionTiers)
    .where(
      or(
        eq(subscriptionTiers.stripePriceIdMonthly, priceId),
        eq(subscriptionTiers.stripePriceIdYearly, priceId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    tierName: row.tierName,
    billingCycle: row.monthly === priceId ? "monthly" : "yearly",
  };
}

type Metadata = Record<string, unknown> & {
  scheduled_downgrade?: { new_tier?: string };
  old_stripe_subscription_id?: string;
  stripe_subscription_id?: string;
};

function readMetadata(row: UserSubscription): Metadata {
  return (row.metadata as Metadata | null) ?? ({} as Metadata);
}

/**
 * Determine `cancelled_at` for the basic-update path. Three cases:
 *  1. `subscription.canceled_at` set → that wins (immediate or scheduled-
 *      cancel that's already been logged on Stripe's side).
 *  2. `subscription.cancel_at_period_end` set with a period end:
 *     - existing local `cancelled_at` already there → preserve it
 *       (don't overwrite the original request time on every update).
 *     - else → stamp now (cancellation was just scheduled).
 *  3. Neither → null (subscription is fully active, no cancellation in
 *      flight).
 */
function resolveCancelledAt(
  subscription: Stripe.Subscription,
  existing: UserSubscription,
): Date | null {
  if (subscription.canceled_at) {
    return unixSecondsToDate(subscription.canceled_at);
  }
  if (
    subscription.cancel_at_period_end &&
    readCurrentPeriodEnd(subscription) !== null
  ) {
    return existing.cancelledAt ?? new Date();
  }
  return null;
}

export async function handleSubscriptionUpdated(
  event: Stripe.Event,
): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const userId = readUserIdFromMetadata(subscription);
  if (userId === null) {
    console.warn(
      `[stripe:subscription.updated] ${subscription.id} missing supabase_user_id — skipping`,
    );
    return;
  }

  const repo = new SubscriptionRepository();
  const existing = await repo.findByExternalId(subscription.id);
  if (existing === null) {
    console.warn(
      `[stripe:subscription.updated] no local row for ${subscription.id} — out-of-band sub, skipping`,
    );
    return;
  }

  // --- 1. Basic update ---------------------------------------------------
  const paymentStatus = mapStripeStatusToPaymentStatusForUpdate(subscription);
  const expiresAt = resolveExpiresAt(subscription);
  const cancelledAt = resolveCancelledAt(subscription, existing);

  await repo.updateById(existing.id, {
    paymentStatus,
    expiresAt,
    trialEndsAt: unixSecondsToDate(subscription.trial_end),
    nextBillingDate: expiresAt, // same value — legacy line 248
    cancelledAt,
  });

  // --- 2. Scheduled-downgrade activation --------------------------------
  const existingMeta = readMetadata(existing);
  const periodEnd = readCurrentPeriodEnd(subscription);
  if (
    existingMeta.scheduled_downgrade &&
    subscription.cancel_at_period_end &&
    periodEnd !== null &&
    periodEnd <= Math.floor(Date.now() / 1000)
  ) {
    const newTier = existingMeta.scheduled_downgrade.new_tier;
    const { scheduled_downgrade: _drop, ...rest } = existingMeta;
    void _drop;

    if (typeof newTier !== "string" || newTier.length === 0) {
      // Malformed marker — JSON metadata could carry anything, and a
      // missing / empty / wrong-type `new_tier` would otherwise leave the
      // marker in place forever, with every subsequent
      // customer.subscription.updated re-entering this dead branch.
      // Clear the marker so we don't loop, and log loudly so the bad
      // outbound write is visible (Inspector Brad PR #69 medium-severity
      // find).
      console.warn(
        `[stripe:subscription.updated] scheduled_downgrade has malformed new_tier (${JSON.stringify(newTier)}) on user_subscriptions.id=${existing.id} — clearing marker without applying a tier change`,
      );
      await repo.updateById(existing.id, { metadata: rest });
    } else if (newTier !== "free") {
      await repo.updateById(existing.id, {
        tierName: newTier,
        paymentStatus,
        cancelledAt: null,
        metadata: rest,
      });
    } else {
      // newTier === "free"
      await repo.updateById(existing.id, {
        tierName: "free",
        paymentStatus: "cancelled",
        cancelledAt: null,
        metadata: rest,
      });
    }
  }

  // --- 3. Subscription-change rollback / commit -------------------------
  // Re-read after the basic + scheduled-downgrade updates so subsequent
  // branches see fresh metadata. The scheduled-downgrade path above
  // already strips `old_stripe_subscription_id` if it was set there;
  // however the typical flow has the two flags set by SEPARATE outbound
  // calls, so we still need to inspect.
  const refreshed = await repo.findByExternalId(subscription.id);
  if (refreshed === null) return;
  const refreshedMeta = readMetadata(refreshed);
  const oldStripeSubId = refreshedMeta.old_stripe_subscription_id;
  if (typeof oldStripeSubId !== "string" || oldStripeSubId.length === 0) {
    return;
  }

  if (subscription.status === "active" || subscription.status === "trialing") {
    // New sub succeeded — cancel the old one + clear the marker.
    const cancelOk = await cancelOldSubscriptionWithRetry(oldStripeSubId);
    if (cancelOk) {
      const { old_stripe_subscription_id: _drop, ...rest } = refreshedMeta;
      void _drop;
      await repo.updateById(refreshed.id, { metadata: rest });
    } else {
      // Preserve metadata so manual ops can retry. No DB change here.
      console.error(
        `[stripe:subscription.updated] preserving old_stripe_subscription_id=${oldStripeSubId} for manual intervention`,
      );
    }
    return;
  }

  if (subscription.status === "incomplete_expired") {
    // New sub failed — restore to the original. Fetch the original from
    // Stripe (it should still be live and untouched) and overwrite our
    // local row with its state.
    try {
      // Cast away the SDK's `Stripe.Response<Stripe.Subscription>` wrapper
      // — at runtime it IS a Subscription with extra metadata (lastResponse,
      // requestId), but Stripe SDK v22's typings moved some fields onto
      // the wrapper without keeping them index-accessible. We only read
      // Subscription fields below, so the cast is safe.
      const original = (await getStripe().subscriptions.retrieve(
        oldStripeSubId,
      )) as Stripe.Subscription;
      const originalStatus = mapStripeStatusToPaymentStatus(original.status);
      const priceId = original.items?.data?.[0]?.price?.id;
      const tierLookup = priceId ? await resolveTierForPrice(priceId) : null;

      const { old_stripe_subscription_id: _drop, ...rest } = refreshedMeta;
      void _drop;
      await repo.updateById(refreshed.id, {
        externalSubscriptionId: original.id,
        tierName: tierLookup?.tierName ?? "free",
        billingCycle: tierLookup?.billingCycle ?? "monthly",
        paymentStatus: originalStatus,
        // Clear cancelledAt: the basic-update pass above wrote it from
        // the FAILED sub's data (incomplete_expired subs have a
        // canceled_at set by Stripe), but we're now restoring to the
        // ORIGINAL sub which is still active. Without this the row
        // ends up "Active until X" + "Cancelled at Y" simultaneously,
        // exactly the confused state PR #67's defensive client-side
        // collapse was trying to clean up (Inspector Brad PR #69
        // sweep #3 low-severity find).
        cancelledAt: null,
        trialEndsAt: unixSecondsToDate(original.trial_end),
        expiresAt: unixSecondsToDate(readCurrentPeriodEnd(original)),
        nextBillingDate: unixSecondsToDate(readCurrentPeriodEnd(original)),
        metadata: {
          ...rest,
          stripe_subscription_id: original.id,
        },
      });
      console.log(
        `[stripe:subscription.updated] restored user=${userId} to original sub ${original.id} (status=${originalStatus})`,
      );
    } catch (err) {
      // Couldn't reach Stripe — fall back to the legacy's last-ditch
      // "at least restore the external id" path. Without this, the
      // user's local row would still point at the failed sub id, and
      // future webhook events for the original sub would land in the
      // "no local row" branch.
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[stripe:subscription.updated] fallback restoration for ${oldStripeSubId}: ${message}`,
      );
      const { old_stripe_subscription_id: _drop, ...rest } = refreshedMeta;
      void _drop;
      await repo
        .updateById(refreshed.id, {
          externalSubscriptionId: oldStripeSubId,
          // Same reasoning as the happy-path restoration: clear the
          // failed-sub's cancelledAt so the row doesn't carry conflicting
          // active-vs-cancelled signals. We don't know the original sub's
          // status here (couldn't reach Stripe), but pointing the row at
          // the old id without clearing cancelledAt would leave the UI
          // showing a cancelled-at date for what's now the active sub.
          cancelledAt: null,
          metadata: {
            ...rest,
            stripe_subscription_id: oldStripeSubId,
          },
        })
        .catch((fallbackErr) => {
          const fmessage =
            fallbackErr instanceof Error
              ? fallbackErr.message
              : String(fallbackErr);
          console.error(
            `[stripe:subscription.updated] fallback restoration ALSO failed: ${fmessage}`,
          );
        });
    }
  }
}
