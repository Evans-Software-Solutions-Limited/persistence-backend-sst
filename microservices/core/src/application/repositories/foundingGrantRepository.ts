import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  foundingGrants,
  foundingPoolLimits,
  profiles,
  referralCodes,
  subscriptionTiers,
  userSubscriptions,
  type FoundingGrant,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  addMonths,
  foundingExternalId,
  tiersInPool,
  type FoundingPaymentMethod,
  type FoundingPool,
  type FoundingTierName,
} from "../founding/foundingOffer";
import {
  LIVE_SUBSCRIPTION_STATUSES,
  liveSubscriptionFilter,
  lockUserSubscriptionMutation,
} from "./subscriptionRepository";
import type { DatabaseTransaction } from "./referralRepository";

/**
 * Founding-member grants (FOUNDING-OFFER BACKEND_BRIEF § 1, § 5).
 *
 * A grant is a direct administrative entitlement. An optional contribution may
 * be recorded alongside it but never determines access. A grant becomes active by
 * creating a direct `user_subscriptions` row (BRIEF D3) — either immediately
 * (the buyer already has an account) or later, when a PENDING grant is applied
 * on the buyer's first authenticated read after signing up with that email.
 *
 * Writes that must be atomic (seat check + subscription row + grant row) run in
 * one transaction under a per-pool advisory lock so two admins cannot both take
 * the last seat.
 */

export interface GrantListRow {
  id: string;
  userId: string | null;
  email: string;
  tierName: string;
  tierLabel: string | null;
  months: number;
  grantKind: "founding" | "complimentary";
  contributionAmountMinor: number;
  contributionCurrency: string;
  contributionMethod: string | null;
  contributionReference: string | null;
  contributedAt: Date | null;
  referralCode: string | null;
  referralLabel: string | null;
  subscriptionExpiresAt: Date | null;
  invitedAt: Date | null;
  appliedAt: Date | null;
  revokedAt: Date | null;
  revokeReason: string | null;
  notes: string | null;
  createdAt: Date;
  status: "pending" | "active" | "expired" | "revoked" | "account_deleted";
}

export interface CreateGrantInput {
  id: string;
  userId: string | null;
  email: string;
  tierName: FoundingTierName;
  months: number;
  grantKind?: "founding" | "complimentary";
  amountMinor: number;
  currency: string;
  paymentMethod: FoundingPaymentMethod | null;
  paymentReference: string | null;
  paidAt: Date | null;
  referralCodeId: string | null;
  grantedBy: string;
  notes: string | null;
}

export type CreateGrantOutcome =
  | {
      kind: "created";
      grant: FoundingGrant;
      subscriptionExpiresAt: Date | null;
      seats: { pool: FoundingPool; used: number; cap: number } | null;
    }
  | {
      kind: "pool_full";
      seats: { pool: FoundingPool; used: number; cap: number };
    }
  | {
      kind: "active_store_subscription";
      subscription: { tierName: string; expiresAt: Date | null };
    }
  | { kind: "duplicate" };

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface GrantTransactionContext {
  transaction: DatabaseTransaction;
  grant: FoundingGrant;
  subscriptionExpiresAt: Date | null;
}

export interface PendingGrantTransactionContext {
  transaction: DatabaseTransaction;
  grant: FoundingGrant;
  expiresAt: Date;
}

export type ExtendGrantOutcome =
  | { kind: "extended"; grant: FoundingGrant; expiresAt: Date | null }
  | {
      kind: "invalid_months" | "not_found" | "revoked" | "account_deleted";
    }
  | {
      kind: "active_store_subscription";
      subscription: { tierName: string; expiresAt: Date | null };
    };

function statusOf(row: {
  userId: string | null;
  appliedAt: Date | null;
  revokedAt: Date | null;
  subscriptionExpiresAt: Date | null;
}): GrantListRow["status"] {
  if (row.revokedAt) return "revoked";
  if (!row.appliedAt) return "pending";
  if (!row.userId) return "account_deleted";
  if (
    row.subscriptionExpiresAt &&
    row.subscriptionExpiresAt.getTime() <= Date.now()
  )
    return "expired";
  return "active";
}

export class FoundingGrantRepository {
  async findProfileByEmail(email: string): Promise<{
    id: string;
    email: string | null;
    role: string | null;
    deletedAt: Date | null;
  } | null> {
    const db = getDb();
    const rows = await db
      .select({
        id: profiles.id,
        email: profiles.email,
        role: profiles.role,
        deletedAt: profiles.deletedAt,
      })
      .from(profiles)
      .where(sql`lower(${profiles.email}) = ${email.toLowerCase()}`)
      .limit(1);
    return rows[0] ?? null;
  }

  async findProfileById(id: string): Promise<{
    id: string;
    email: string | null;
    role: string | null;
    deletedAt: Date | null;
  } | null> {
    const db = getDb();
    const rows = await db
      .select({
        id: profiles.id,
        email: profiles.email,
        role: profiles.role,
        deletedAt: profiles.deletedAt,
      })
      .from(profiles)
      .where(eq(profiles.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async tierExists(tierName: string): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .select({ tierName: subscriptionTiers.tierName })
      .from(subscriptionTiers)
      .where(eq(subscriptionTiers.tierName, tierName))
      .limit(1);
    return rows.length > 0;
  }

  private async countLiveInPool(
    tx: Db | Tx,
    pool: FoundingPool,
  ): Promise<number> {
    const rows = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(foundingGrants)
      .where(
        and(
          isNull(foundingGrants.revokedAt),
          eq(foundingGrants.grantKind, "founding"),
          inArray(foundingGrants.tierName, tiersInPool(pool)),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  }

  private async findLiveStoreSubscriptionIn(
    tx: Tx,
    userId: string,
  ): Promise<{ tierName: string; expiresAt: Date | null } | null> {
    const rows = await tx
      .select({
        tierName: userSubscriptions.tierName,
        expiresAt: userSubscriptions.expiresAt,
      })
      .from(userSubscriptions)
      .where(
        and(
          eq(userSubscriptions.userId, userId),
          liveSubscriptionFilter(),
          sql`left(${userSubscriptions.externalSubscriptionId}, 3) = 'rc_'`,
        ),
      )
      .orderBy(desc(userSubscriptions.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async seatsForPool(
    pool: FoundingPool,
  ): Promise<{ pool: FoundingPool; used: number; cap: number }> {
    const db = getDb();
    const used = await this.countLiveInPool(db, pool);
    const limits = await db
      .select({ cap: foundingPoolLimits.cap })
      .from(foundingPoolLimits)
      .where(eq(foundingPoolLimits.pool, pool))
      .limit(1);
    if (!limits[0]) throw new Error(`Missing founding pool limit: ${pool}`);
    return { pool, used, cap: limits[0].cap };
  }

  /** Does this address already hold a live or pending founding grant? */
  async hasLiveOrPendingGrantForEmail(email: string): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .select({ id: foundingGrants.id })
      .from(foundingGrants)
      .where(
        and(
          sql`lower(${foundingGrants.email}) = ${email.toLowerCase()}`,
          isNull(foundingGrants.revokedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Take a pool seat atomically: capacity check AND the write that consumes
   * it, in ONE transaction under the pool's advisory lock.
   *
   * `decide` runs inside that transaction. It reports how many seats are held
   * by checkouts in flight and hands back the write to perform if there is
   * room — so the count and the reservation can never straddle a concurrent
   * purchase. Returning `"pool_full"` or the caller's own refusal string
   * commits nothing.
   */
  async reserveSeatUnderPoolLock<TRow, TRefusal extends string>(
    pool: FoundingPool,
    decide: (
      tx: Tx,
    ) => Promise<{ held: number; reserve: () => Promise<TRow> } | TRefusal>,
  ): Promise<TRow | TRefusal | "pool_full"> {
    const db = getDb();
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${"founding_pool_" + pool}))`,
      );
      const decision = await decide(tx);
      if (typeof decision === "string") return decision;
      const limits = await tx
        .select({ cap: foundingPoolLimits.cap })
        .from(foundingPoolLimits)
        .where(eq(foundingPoolLimits.pool, pool))
        .limit(1);
      if (!limits[0]) throw new Error(`Missing founding pool limit: ${pool}`);
      const used = await this.countLiveInPool(tx, pool);
      if (used + decision.held >= limits[0].cap) return "pool_full" as const;
      return decision.reserve();
    });
  }

  /**
   * Seats left in `pool`, counting BOTH non-revoked grants and the checkout
   * holds passed in by `countHeld`, under the pool's advisory lock.
   *
   * The lock and the single transaction are the point. A web purchase decides
   * "is there a seat?" minutes before the grant that consumes it exists, so the
   * two counts have to be taken together and no other purchase may slip
   * between them — otherwise the last place is sold twice and someone gets
   * refunded by hand.
   *
   * `countHeld` is injected rather than imported so this repository stays
   * about `founding_grants`; the caller supplies the checkout-hold read.
   */
  async freeSeatsWithHolds(
    pool: FoundingPool,
    countHeld: (tx: Tx) => Promise<number>,
  ): Promise<{
    pool: FoundingPool;
    used: number;
    held: number;
    cap: number;
    free: number;
  }> {
    const db = getDb();
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${"founding_pool_" + pool}))`,
      );
      const limits = await tx
        .select({ cap: foundingPoolLimits.cap })
        .from(foundingPoolLimits)
        .where(eq(foundingPoolLimits.pool, pool))
        .limit(1);
      if (!limits[0]) throw new Error(`Missing founding pool limit: ${pool}`);
      const cap = limits[0].cap;
      const used = await this.countLiveInPool(tx, pool);
      const held = await countHeld(tx);
      return { pool, used, held, cap, free: Math.max(0, cap - used - held) };
    });
  }

  /**
   * Insert the `user_subscriptions` row for a grant (BRIEF D3) inside `tx`:
   * cancel every live row for the user first (the `user_subscriptions_active_unique`
   * partial index allows one), then insert. `cancelled_at = now()` on purpose so
   * the app renders "active until <date>" rather than promising a renewal.
   */
  private async writeSubscriptionRow(
    tx: Tx,
    input: {
      grantId: string;
      userId: string;
      tierName: FoundingTierName;
      months: number;
      paidAt: Date | null;
      paymentMethod: string | null;
      paymentReference: string | null;
      referralCodeId: string | null;
    },
  ): Promise<{ id: string; expiresAt: Date }> {
    await tx
      .update(userSubscriptions)
      .set({ paymentStatus: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(userSubscriptions.userId, input.userId),
          inArray(userSubscriptions.paymentStatus, [
            ...LIVE_SUBSCRIPTION_STATUSES,
          ]),
        ),
      );
    const startsAt = new Date();
    const expiresAt = addMonths(startsAt, input.months);
    const rows = await tx
      .insert(userSubscriptions)
      .values({
        userId: input.userId,
        tierName: input.tierName,
        currency: "GBP",
        paymentStatus: "active",
        startsAt,
        expiresAt,
        cancelledAt: startsAt,
        billingCycle: "monthly",
        externalSubscriptionId: foundingExternalId(input.grantId),
        metadata: {
          source: "administrative_grant",
          grant_id: input.grantId,
          contribution_method: input.paymentMethod,
          contribution_reference: input.paymentReference,
          referral_code_id: input.referralCodeId,
          contributed_at: input.paidAt?.toISOString() ?? null,
        },
      })
      .returning({
        id: userSubscriptions.id,
        expiresAt: userSubscriptions.expiresAt,
      });
    const row = rows[0];
    return { id: row.id, expiresAt: row.expiresAt ?? expiresAt };
  }

  /**
   * Create a grant (and, when `userId` is set, its subscription row) under the
   * pool's advisory lock for founding grants. Complimentary grants bypass the
   * pool. Returns `pool_full` without writing when the cap is
   * reached, `duplicate` when the user/email already holds a live grant.
   */
  async create(
    input: CreateGrantInput,
    pool: FoundingPool,
    finalize?: (context: GrantTransactionContext) => Promise<void>,
  ): Promise<CreateGrantOutcome> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const grantKind = input.grantKind ?? "founding";
      if (grantKind === "founding") {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${"founding_pool_" + pool}))`,
        );
      }

      if (input.userId) {
        await lockUserSubscriptionMutation(tx, input.userId);
        const storeSubscription = await this.findLiveStoreSubscriptionIn(
          tx,
          input.userId,
        );
        if (storeSubscription) {
          return {
            kind: "active_store_subscription",
            subscription: storeSubscription,
          };
        }
      }

      let seats: { pool: FoundingPool; used: number; cap: number } | null =
        null;
      if (grantKind === "founding") {
        const limits = await tx
          .select({ cap: foundingPoolLimits.cap })
          .from(foundingPoolLimits)
          .where(eq(foundingPoolLimits.pool, pool))
          .limit(1);
        if (!limits[0]) throw new Error(`Missing founding pool limit: ${pool}`);
        const cap = limits[0].cap;
        const used = await this.countLiveInPool(tx, pool);
        if (used >= cap)
          return { kind: "pool_full", seats: { pool, used, cap } };
        seats = { pool, used: used + 1, cap };
      }

      const dupe = await tx
        .select({ id: foundingGrants.id })
        .from(foundingGrants)
        .where(
          and(
            isNull(foundingGrants.revokedAt),
            input.userId
              ? sql`(${foundingGrants.userId} = ${input.userId} OR (lower(${foundingGrants.email}) = ${input.email} AND ${foundingGrants.appliedAt} IS NULL))`
              : sql`lower(${foundingGrants.email}) = ${input.email} AND ${foundingGrants.appliedAt} IS NULL`,
          ),
        )
        .limit(1);
      if (dupe.length > 0) return { kind: "duplicate" };

      let subscriptionId: string | null = null;
      let subscriptionExpiresAt: Date | null = null;
      if (input.userId) {
        const sub = await this.writeSubscriptionRow(tx, {
          grantId: input.id,
          userId: input.userId,
          tierName: input.tierName,
          months: input.months,
          paidAt: input.paidAt,
          paymentMethod: input.paymentMethod,
          paymentReference: input.paymentReference,
          referralCodeId: input.referralCodeId,
        });
        subscriptionId = sub.id;
        subscriptionExpiresAt = sub.expiresAt;
      }

      const rows = await tx
        .insert(foundingGrants)
        .values({
          id: input.id,
          userId: input.userId,
          email: input.email,
          tierName: input.tierName,
          months: input.months,
          grantKind,
          amountMinor: input.amountMinor,
          currency: input.currency,
          paymentMethod: input.paymentMethod,
          paymentReference: input.paymentReference,
          paidAt: input.paidAt,
          referralCodeId: input.referralCodeId,
          subscriptionId,
          grantedBy: input.grantedBy,
          appliedAt: input.userId ? new Date() : null,
          notes: input.notes,
        })
        .returning();

      if (finalize) {
        await finalize({
          transaction: tx,
          grant: rows[0],
          subscriptionExpiresAt,
        });
      }

      return {
        kind: "created",
        grant: rows[0],
        subscriptionExpiresAt,
        seats,
      };
    });
  }

  /**
   * The live grant a Stripe payment paid for, found by the payment-intent id
   * stored as its contribution reference.
   *
   * Scoped to `stripe_checkout`: `payment_reference` is a free-text field that
   * also holds hand-typed bank references, and a refund must never revoke a
   * grant just because somebody's bank reference happened to collide with a
   * Stripe id.
   */
  async findLiveByPaymentReference(
    reference: string,
  ): Promise<FoundingGrant | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(foundingGrants)
      .where(
        and(
          eq(foundingGrants.paymentReference, reference),
          eq(foundingGrants.paymentMethod, "stripe_checkout"),
          isNull(foundingGrants.revokedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Pending grants (no account yet) for an email, oldest first. */
  async findPendingByEmail(email: string): Promise<FoundingGrant[]> {
    const db = getDb();
    return db
      .select()
      .from(foundingGrants)
      .where(
        and(
          isNull(foundingGrants.appliedAt),
          isNull(foundingGrants.revokedAt),
          sql`lower(${foundingGrants.email}) = ${email.toLowerCase()}`,
        ),
      )
      .orderBy(foundingGrants.createdAt);
  }

  /**
   * Bind a pending grant to the account that just signed up with its email and
   * create the subscription row. Conditional on the grant still being pending so
   * two concurrent first reads apply it once.
   */
  async applyPending(
    grantId: string,
    userId: string,
    finalize?: (context: PendingGrantTransactionContext) => Promise<void>,
  ): Promise<{
    applied: boolean;
    expiresAt: Date | null;
    tierName: string | null;
    storeSubscription?: { tierName: string; expiresAt: Date | null };
  }> {
    const db = getDb();
    return db.transaction(async (tx) => {
      await lockUserSubscriptionMutation(tx, userId);
      const storeSubscription = await this.findLiveStoreSubscriptionIn(
        tx,
        userId,
      );
      if (storeSubscription) {
        return {
          applied: false,
          expiresAt: null,
          tierName: null,
          storeSubscription,
        };
      }

      const claimed = await tx
        .update(foundingGrants)
        .set({ userId, appliedAt: new Date() })
        .where(
          and(
            eq(foundingGrants.id, grantId),
            isNull(foundingGrants.userId),
            isNull(foundingGrants.appliedAt),
            isNull(foundingGrants.revokedAt),
          ),
        )
        .returning();
      const grant = claimed[0];
      if (!grant) return { applied: false, expiresAt: null, tierName: null };

      const sub = await this.writeSubscriptionRow(tx, {
        grantId: grant.id,
        userId,
        tierName: grant.tierName as FoundingTierName,
        months: grant.months,
        paidAt: grant.paidAt,
        paymentMethod: grant.paymentMethod,
        paymentReference: grant.paymentReference,
        referralCodeId: grant.referralCodeId,
      });
      await tx
        .update(foundingGrants)
        .set({ subscriptionId: sub.id })
        .where(eq(foundingGrants.id, grant.id));
      if (finalize) {
        await finalize({
          transaction: tx,
          grant,
          expiresAt: sub.expiresAt,
        });
      }
      return {
        applied: true,
        expiresAt: sub.expiresAt,
        tierName: grant.tierName,
      };
    });
  }

  async markInvited(
    grantId: string,
    finalize?: (transaction: DatabaseTransaction) => Promise<void>,
  ): Promise<void> {
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx
        .update(foundingGrants)
        .set({ invitedAt: new Date() })
        .where(eq(foundingGrants.id, grantId));
      await finalize?.(tx);
    });
  }

  async findById(id: string): Promise<FoundingGrant | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(foundingGrants)
      .where(eq(foundingGrants.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async extend(
    id: string,
    additionalMonths: number,
    finalize?: (
      before: FoundingGrant,
      after: FoundingGrant,
      expiresAt: Date | null,
      transaction: DatabaseTransaction,
    ) => Promise<void>,
  ): Promise<ExtendGrantOutcome> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const found = await tx
        .select()
        .from(foundingGrants)
        .where(eq(foundingGrants.id, id))
        .for("update")
        .limit(1);
      const before = found[0];
      if (!before) return { kind: "not_found" };
      if (before.revokedAt) return { kind: "revoked" };
      if (before.appliedAt && !before.userId)
        return { kind: "account_deleted" };
      if (before.months + additionalMonths > 120)
        return { kind: "invalid_months" };

      let expiresAt: Date | null = null;
      if (before.userId) {
        await lockUserSubscriptionMutation(tx, before.userId);
        const store = await this.findLiveStoreSubscriptionIn(tx, before.userId);
        if (store)
          return { kind: "active_store_subscription", subscription: store };
        if (!before.subscriptionId) return { kind: "account_deleted" };
        const subs = await tx
          .select({ expiresAt: userSubscriptions.expiresAt })
          .from(userSubscriptions)
          .where(eq(userSubscriptions.id, before.subscriptionId))
          .for("update")
          .limit(1);
        if (!subs[0]) return { kind: "account_deleted" };
        const now = new Date();
        const base =
          subs[0].expiresAt && subs[0].expiresAt.getTime() > now.getTime()
            ? subs[0].expiresAt
            : now;
        expiresAt = addMonths(base, additionalMonths);
        await tx
          .update(userSubscriptions)
          .set({
            paymentStatus: "active",
            expiresAt,
            cancelledAt: now,
            updatedAt: now,
          })
          .where(eq(userSubscriptions.id, before.subscriptionId));
      }

      const updated = await tx
        .update(foundingGrants)
        .set({ months: before.months + additionalMonths })
        .where(eq(foundingGrants.id, id))
        .returning();
      const after = updated[0];
      await finalize?.(before, after, expiresAt, tx);
      return { kind: "extended", grant: after, expiresAt };
    });
  }

  /**
   * Revoke: stamp the grant and cancel + expire its subscription row (the user
   * reverts to free-tier rules immediately). Idempotent.
   */
  async revoke(
    id: string,
    reason: string,
    finalize?: (
      grant: FoundingGrant,
      transaction: DatabaseTransaction,
    ) => Promise<void>,
  ): Promise<FoundingGrant | null> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const rows = await tx
        .update(foundingGrants)
        .set({ revokedAt: new Date(), revokeReason: reason })
        .where(and(eq(foundingGrants.id, id), isNull(foundingGrants.revokedAt)))
        .returning();
      const grant = rows[0];
      if (!grant) return null;
      if (grant.subscriptionId) {
        await tx
          .update(userSubscriptions)
          .set({
            paymentStatus: "cancelled",
            expiresAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(userSubscriptions.id, grant.subscriptionId));
      }
      if (finalize) await finalize(grant, tx);
      return grant;
    });
  }

  async list(filter: {
    revoked?: boolean;
    limit?: number;
  }): Promise<GrantListRow[]> {
    const db = getDb();
    const rows = await db
      .select({
        id: foundingGrants.id,
        userId: foundingGrants.userId,
        email: foundingGrants.email,
        tierName: foundingGrants.tierName,
        tierLabel: subscriptionTiers.displayName,
        months: foundingGrants.months,
        grantKind: foundingGrants.grantKind,
        contributionAmountMinor: foundingGrants.amountMinor,
        contributionCurrency: foundingGrants.currency,
        contributionMethod: foundingGrants.paymentMethod,
        contributionReference: foundingGrants.paymentReference,
        contributedAt: foundingGrants.paidAt,
        referralCode: referralCodes.displayCode,
        referralLabel: referralCodes.label,
        subscriptionExpiresAt: userSubscriptions.expiresAt,
        invitedAt: foundingGrants.invitedAt,
        appliedAt: foundingGrants.appliedAt,
        revokedAt: foundingGrants.revokedAt,
        revokeReason: foundingGrants.revokeReason,
        notes: foundingGrants.notes,
        createdAt: foundingGrants.createdAt,
      })
      .from(foundingGrants)
      .leftJoin(
        subscriptionTiers,
        eq(subscriptionTiers.tierName, foundingGrants.tierName),
      )
      .leftJoin(
        referralCodes,
        eq(referralCodes.id, foundingGrants.referralCodeId),
      )
      .leftJoin(
        userSubscriptions,
        eq(userSubscriptions.id, foundingGrants.subscriptionId),
      )
      .where(
        filter.revoked === undefined
          ? undefined
          : filter.revoked
            ? sql`${foundingGrants.revokedAt} IS NOT NULL`
            : isNull(foundingGrants.revokedAt),
      )
      .orderBy(desc(foundingGrants.createdAt))
      .limit(filter.limit ?? 500);
    return rows.map((r) => ({
      ...r,
      grantKind: r.grantKind as "founding" | "complimentary",
      status: statusOf(r),
    }));
  }

  async listForUser(userId: string): Promise<GrantListRow[]> {
    const db = getDb();
    const all = await this.list({ limit: 1000 });
    void db;
    return all.filter((g) => g.userId === userId);
  }

  async summary(): Promise<{
    pools: Record<FoundingPool, { used: number; cap: number }>;
    byTier: Array<{
      tierName: string;
      count: number;
      contributionMinor: number;
    }>;
    contributionMinor: number;
    pending: number;
  }> {
    const db = getDb();
    const rows = await db
      .select({
        tierName: foundingGrants.tierName,
        count: sql<number>`count(*)::int`,
        contributionMinor: sql<number>`coalesce(sum(${foundingGrants.amountMinor}), 0)::int`,
        pending: sql<number>`count(*) FILTER (WHERE ${foundingGrants.appliedAt} IS NULL)::int`,
      })
      .from(foundingGrants)
      .where(isNull(foundingGrants.revokedAt))
      .groupBy(foundingGrants.tierName);
    const byTier = rows.map((r) => ({
      tierName: r.tierName,
      count: Number(r.count ?? 0),
      contributionMinor: Number(r.contributionMinor ?? 0),
    }));
    const [consumer, coach] = await Promise.all([
      this.seatsForPool("consumer"),
      this.seatsForPool("coach"),
    ]);
    return {
      pools: {
        consumer: { used: consumer.used, cap: consumer.cap },
        coach: { used: coach.used, cap: coach.cap },
      },
      byTier,
      contributionMinor: byTier.reduce((n, t) => n + t.contributionMinor, 0),
      pending: rows.reduce((n, r) => n + Number(r.pending ?? 0), 0),
    };
  }
}
