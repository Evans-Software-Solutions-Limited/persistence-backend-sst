import { asc, eq } from "drizzle-orm";
import { subscriptionTiers } from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * The catalog-read shape: every `subscription_tiers` column EXCEPT
 * `loadout_access`, which `listActive` deliberately does not project (see
 * the comment there — it keeps this public endpoint readable on a
 * database that hasn't had the M19-P0 migration applied yet). Add a
 * column here only once something actually reads it.
 */
export type SubscriptionTierRow = Omit<
  typeof subscriptionTiers.$inferSelect,
  "loadoutAccess"
>;

/**
 * Repository for `subscription_tiers` reads. The catalog table is
 * read-only at runtime — tier metadata is seeded via migrations and
 * (occasionally) updated out-of-band when Brad wants to tweak prices
 * or feature flags. No write methods here.
 *
 * Catalog reads are global — no `userId` filter, no ownership check.
 * `GET /subscription-tiers` is a public endpoint (the auth-flow
 * subscription-selection screen renders before sign-in) so the absence
 * of a userId scope is by design.
 */
export class SubscriptionTiersRepository {
  static readonly key = "SubscriptionTiersRepository";

  /**
   * Return every active tier in `price_monthly ASC` order. The mobile
   * subscription-selection screen consumes this directly — the
   * "Free" tier IS returned (when `is_active = true`) because it's the
   * default starting state, but the UI never renders it as a buyable
   * card. The role-toggle filtering (user-tier vs trainer-tier) is the
   * mobile's responsibility based on `is_trainer_tier`.
   *
   * Empty result → caller returns `{ data: [] }` with 200 (deploy
   * misconfiguration, not a runtime error).
   */
  async listActive(): Promise<SubscriptionTierRow[]> {
    const db = getDb();
    // EXPLICIT projection, deliberately. A bare `.select()` makes Drizzle
    // emit every column named in `schema.ts`, which couples this PUBLIC,
    // UNAUTHENTICATED endpoint to the migration state: production
    // migrations are applied by hand (CLAUDE.md § Database), so a Lambda
    // deployed before the migration runs would emit a column the database
    // doesn't have yet, throw Postgres 42703, and show every user —
    // signed in or not — "Failed to Load Subscription Options".
    //
    // Listing the columns the wire mapper actually reads makes the deploy
    // order safe in that direction. `loadout_access` is intentionally NOT
    // projected: nothing reads it yet (the `loadout` entitlement gate is a
    // later slice), so the catalog must not require it to exist.
    const rows = await db
      .select({
        id: subscriptionTiers.id,
        tierName: subscriptionTiers.tierName,
        displayName: subscriptionTiers.displayName,
        description: subscriptionTiers.description,
        priceMonthly: subscriptionTiers.priceMonthly,
        priceYearly: subscriptionTiers.priceYearly,
        currency: subscriptionTiers.currency,
        features: subscriptionTiers.features,
        workoutLimit: subscriptionTiers.workoutLimit,
        aiAccess: subscriptionTiers.aiAccess,
        aiWorkoutLimit: subscriptionTiers.aiWorkoutLimit,
        gymBuddyAccess: subscriptionTiers.gymBuddyAccess,
        gymBuddyCanCreateWorkouts: subscriptionTiers.gymBuddyCanCreateWorkouts,
        gymBuddyCanSuggestWorkouts:
          subscriptionTiers.gymBuddyCanSuggestWorkouts,
        trainerClientLimit: subscriptionTiers.trainerClientLimit,
        isTrainerTier: subscriptionTiers.isTrainerTier,
        analyticsAccess: subscriptionTiers.analyticsAccess,
        exportAccess: subscriptionTiers.exportAccess,
        isActive: subscriptionTiers.isActive,
        stripePriceIdMonthly: subscriptionTiers.stripePriceIdMonthly,
        stripePriceIdYearly: subscriptionTiers.stripePriceIdYearly,
        createdAt: subscriptionTiers.createdAt,
      })
      .from(subscriptionTiers)
      .where(eq(subscriptionTiers.isActive, true))
      .orderBy(asc(subscriptionTiers.priceMonthly));
    return rows;
  }
}
