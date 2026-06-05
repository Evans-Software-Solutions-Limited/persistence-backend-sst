import { eq, or } from "drizzle-orm";
import { subscriptionTiers, userSubscriptions } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { getStripe } from "./application/stripe/stripeClient";
import {
  reconcileDetect,
  type LocalSubscriptionView,
} from "./application/stripe/reconcile/reconcileDetect";

/**
 * Scheduled, read-only Stripe⇄DB drift detector (spec 17 / Phase B, closes
 * audit HIGH-3). Wired to an hourly SST Cron in `infra/api.ts`.
 *
 * Emits two structured log lines:
 *   - `[reconcile:summary] {...}` — always, with the run counts.
 *   - `[reconcile:drift] {...}`   — ONLY when Stripe and the DB disagree, at
 *     ERROR level. This line is the alert hook: wire a CloudWatch Logs metric
 *     filter on `[reconcile:drift]` + an alarm so ops are paged when the mirror
 *     drifts (a missed/dropped/mis-processed webhook). See the spec's runbook.
 *
 * Writes NOTHING — healing remains the manual, reviewed `scripts/
 * reconcile-stripe.ts --write` op.
 */
export async function handler(): Promise<{
  hasDrift: boolean;
  total: number;
  drift: number;
  skipped: number;
}> {
  const stripe = getStripe();
  const db = getDb();

  const result = await reconcileDetect({
    listSubscriptions: () =>
      stripe.subscriptions.list({ status: "all", limit: 100 }),
    findByExternalId: async (
      stripeSubscriptionId,
    ): Promise<LocalSubscriptionView | null> => {
      const rows = await db
        .select({
          tierName: userSubscriptions.tierName,
          paymentStatus: userSubscriptions.paymentStatus,
        })
        .from(userSubscriptions)
        .where(
          eq(userSubscriptions.externalSubscriptionId, stripeSubscriptionId),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    resolveTierForPrice: async (priceId) => {
      const rows = await db
        .select({ tierName: subscriptionTiers.tierName })
        .from(subscriptionTiers)
        .where(
          or(
            eq(subscriptionTiers.stripePriceIdMonthly, priceId),
            eq(subscriptionTiers.stripePriceIdYearly, priceId),
          ),
        )
        .limit(1);
      return rows[0]?.tierName ?? null;
    },
  });

  console.log(`[reconcile:summary] ${JSON.stringify(result.counts)}`);

  if (result.hasDrift) {
    // ERROR level + greppable prefix = the alert signal. Cap the embedded
    // findings so a large drift run doesn't blow the CloudWatch line limit;
    // the count is authoritative, the sample aids triage.
    console.error(
      `[reconcile:drift] ${JSON.stringify({
        count: result.findings.length,
        sample: result.findings.slice(0, 25),
      })}`,
    );
  }

  return {
    hasDrift: result.hasDrift,
    total: result.counts.total,
    drift: result.counts.drift,
    skipped: result.counts.skipped,
  };
}
