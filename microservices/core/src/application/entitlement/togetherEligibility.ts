import { and, desc, eq, isNull, lte } from "drizzle-orm";
import {
  profiles,
  subscriptionTiers,
  userSubscriptions,
} from "@persistence/db/schema";
import type { Db } from "@persistence/db";
import { SUBSCRIPTION_CATALOG } from "@persistence/subscription-catalog";
import {
  classifySubscriptionStatus,
  resolveEffectiveScheduledTier,
} from "./assertEntitlement";

type Executor = Pick<Db, "select">;
/** Grants already project into user_subscriptions; role or display labels never grant access. */
export async function evaluateTogetherEligibility(
  db: Executor,
  userId: string,
): Promise<boolean> {
  const [profile] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.id, userId), isNull(profiles.deletedAt)));
  if (!profile) return false;
  const [subscription] = await db
    .select({
      tierName: userSubscriptions.tierName,
      paymentStatus: userSubscriptions.paymentStatus,
      expiresAt: userSubscriptions.expiresAt,
      cancelledAt: userSubscriptions.cancelledAt,
      metadata: userSubscriptions.metadata,
    })
    .from(userSubscriptions)
    .where(
      and(
        eq(userSubscriptions.userId, userId),
        lte(userSubscriptions.startsAt, new Date()),
      ),
    )
    .orderBy(desc(userSubscriptions.createdAt), desc(userSubscriptions.id))
    .limit(1);
  if (!subscription) return false;
  const scheduled = resolveEffectiveScheduledTier(subscription.metadata);
  if (
    classifySubscriptionStatus(
      subscription.paymentStatus,
      subscription.expiresAt,
      subscription.cancelledAt,
      scheduled !== null,
    )
  )
    return false;
  const tier = scheduled ?? subscription.tierName;
  if (
    !SUBSCRIPTION_CATALOG.some(
      (entry) =>
        entry.id === tier && entry.id !== "free" && entry.audience !== "org",
    )
  )
    return false;
  const [catalog] = await db
    .select({ name: subscriptionTiers.tierName })
    .from(subscriptionTiers)
    .where(eq(subscriptionTiers.tierName, tier));
  return Boolean(catalog);
}
