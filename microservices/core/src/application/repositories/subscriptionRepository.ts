import { and, desc, eq } from "drizzle-orm";
import { userSubscriptions } from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * Drizzle-inferred row type for `user_subscriptions`. Includes every column
 * (id, user_id, tier_name, payment_status, expires_at, …, metadata, …).
 */
export type UserSubscription = typeof userSubscriptions.$inferSelect;

/**
 * Drizzle-inferred insert type. All columns required except those with
 * defaults (id, currency, payment_status, starts_at, billing_cycle,
 * metadata, timestamps) — Drizzle marks those optional.
 */
export type NewUserSubscription = typeof userSubscriptions.$inferInsert;

/**
 * Repository for `user_subscriptions` reads + writes.
 *
 * **Critical contract**: writes here MUST NOT touch
 *  - `profiles.subscription_id`
 *  - `profiles.role`
 *  - `subscription_limits.*`
 *
 * Those columns are maintained by the Postgres trigger
 * `update_subscription_limits_trigger` (see
 * `supabase/migrations/004_subscriptions_and_roles.sql` line 438+),
 * which fires AFTER INSERT OR UPDATE on this table and propagates the
 * derived state automatically. Touching them from handler code would
 * race against the trigger and corrupt the derived state.
 *
 * Pattern matches `ProfileRepository` — methods are async, take typed
 * primary identifiers as the first parameter, return `null` for missing
 * rows rather than throwing.
 */
export class SubscriptionRepository {
  static readonly key = "SubscriptionRepository";

  /**
   * Find by the Stripe-assigned `external_subscription_id` (`sub_…`).
   * Used by webhook handlers to locate the local row from a Stripe
   * subscription event. Returns `null` if no row matches — the webhook
   * handler logs a warning and skips when this happens (e.g. an event
   * for a subscription that was created out-of-band).
   *
   * Stripe IDs are immutable per subscription, so this is the canonical
   * lookup; querying by `user_id` is unreliable when a user has multiple
   * subscriptions in their history (cancelled + reactivated, upgrade-
   * caused replacements, etc.).
   */
  async findByExternalId(
    externalSubscriptionId: string,
  ): Promise<UserSubscription | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(userSubscriptions)
      .where(
        eq(userSubscriptions.externalSubscriptionId, externalSubscriptionId),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Find the user's most recent subscription row regardless of status.
   * Used by the outbound `POST /subscriptions` endpoint to detect
   * reinstatement vs. subscription change — both branches need to see
   * whatever the user's latest sub looked like, including cancelled
   * ones (you can reinstate a cancelled sub) and trialing ones (grace-
   * period reinstatement).
   *
   * Returns `null` when the user has never had a subscription (fresh
   * user → caller proceeds with insert path).
   */
  async findMostRecentForUser(
    userId: string,
  ): Promise<UserSubscription | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(userSubscriptions)
      .where(eq(userSubscriptions.userId, userId))
      .orderBy(desc(userSubscriptions.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Lookup a `user_subscriptions` row by primary key, scoped to the
   * authenticated user. Used by `POST /subscriptions/:id/cancel` to
   * enforce ownership before issuing any Stripe-side cancel — without
   * the `userId` constraint a user could pass another user's row id
   * and trigger a cancellation on their subscription. Returns `null`
   * either when the row doesn't exist OR when it belongs to a different
   * user; the handler maps both to 404 to avoid revealing whether an
   * id exists.
   */
  async findByIdForUser(
    id: string,
    userId: string,
  ): Promise<UserSubscription | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(userSubscriptions)
      .where(
        and(eq(userSubscriptions.id, id), eq(userSubscriptions.userId, userId)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Insert a new `user_subscriptions` row, returning the inserted row
   * (including DB-assigned `id` and timestamps). Caller is responsible
   * for ensuring `external_subscription_id` doesn't already exist — the
   * outbound flow checks `findByExternalId` first; the webhook flow
   * checks the same before inserting on subscription.created.
   */
  async insert(data: NewUserSubscription): Promise<UserSubscription> {
    const db = getDb();
    const rows = await db.insert(userSubscriptions).values(data).returning();
    const inserted = rows[0];
    if (!inserted) {
      throw new Error(
        `SubscriptionRepository.insert returned no rows for user ${data.userId}`,
      );
    }
    return inserted;
  }

  /**
   * Update a `user_subscriptions` row by primary key. Returns the
   * updated row, or `null` if no row matched (rare — caller should
   * have located the row first via `findByExternalId`).
   *
   * Bumps `updated_at` automatically — the column has a default of
   * `now()` but it's an INSERT default only; UPDATE needs us to set
   * it explicitly so the value advances on mutation.
   */
  async updateById(
    id: string,
    data: Partial<Omit<UserSubscription, "id" | "createdAt">>,
  ): Promise<UserSubscription | null> {
    const db = getDb();
    const rows = await db
      .update(userSubscriptions)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(userSubscriptions.id, id))
      .returning();
    return rows[0] ?? null;
  }
}
