import { asc, eq } from "drizzle-orm";
import { subscriptionTiers } from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * Drizzle-inferred row type for `subscription_tiers`. Includes every
 * column (id, tier_name, display_name, prices, features, …).
 */
export type SubscriptionTierRow = typeof subscriptionTiers.$inferSelect;

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
    const rows = await db
      .select()
      .from(subscriptionTiers)
      .where(eq(subscriptionTiers.isActive, true))
      .orderBy(asc(subscriptionTiers.priceMonthly));
    return rows;
  }
}
