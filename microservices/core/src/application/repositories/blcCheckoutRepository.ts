import { and, eq, sql } from "drizzle-orm";
import { profiles, userSubscriptions } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { liveSubscriptionFilter } from "./subscriptionRepository";

/**
 * The two database questions the Blue Light Card checkout asks.
 *
 * There is no BLC table: the rail is a Stripe subscription, and the
 * `user_subscriptions` row is created by the existing
 * `customer.subscription.created` handler from the subscription's metadata.
 * What the checkout needs is (a) whether this account may buy, mirroring the
 * founding checkout's identity rules minus the grant check, and (b) for the
 * thanks page, whether the subscription row has landed and is live.
 */
export type BlcEligibilityRefusal =
  | "account_ineligible"
  | "active_subscription";

export class BlcCheckoutRepository {
  /**
   * May this account start a BLC subscription?
   *
   *  - `account_ineligible`: no profile, soft-deleted (inside the 30-day
   *    cooling-off window), an admin, or a coach — the two BLC tiers are
   *    consumer tiers and a coach account is sold the trainer catalogue.
   *  - `active_subscription`: a LIVE paid row already exists. Stripe would
   *    happily create a second subscription; the `user_subscriptions`
   *    active-unique index would then refuse the row and the buyer would be
   *    paying for access the app never shows. Refused BEFORE Stripe is asked.
   */
  async eligibility(accountId: string): Promise<BlcEligibilityRefusal | null> {
    const db = getDb();
    const [profile] = await db
      .select({ role: profiles.role, deletedAt: profiles.deletedAt })
      .from(profiles)
      .where(eq(profiles.id, accountId))
      .limit(1);
    if (
      !profile ||
      profile.deletedAt ||
      profile.role === "admin" ||
      profile.role === "personal_trainer" ||
      profile.role === "physiotherapist"
    ) {
      return "account_ineligible";
    }
    const [sub] = await db
      .select({ id: userSubscriptions.id })
      .from(userSubscriptions)
      .where(
        and(
          eq(userSubscriptions.userId, accountId),
          liveSubscriptionFilter(),
          sql`${userSubscriptions.tierName} <> 'free'`,
        ),
      )
      .limit(1);
    return sub ? "active_subscription" : null;
  }

  /**
   * Has the webhook turned this Stripe subscription into a LIVE row yet? The
   * thanks page polls this until it is true, then sends the buyer to the app.
   */
  async isLiveSubscription(externalSubscriptionId: string): Promise<boolean> {
    const db = getDb();
    const [row] = await db
      .select({ id: userSubscriptions.id })
      .from(userSubscriptions)
      .where(
        and(
          eq(userSubscriptions.externalSubscriptionId, externalSubscriptionId),
          liveSubscriptionFilter(),
        ),
      )
      .limit(1);
    return row !== undefined;
  }
}
