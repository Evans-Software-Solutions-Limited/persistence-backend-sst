import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  foundingGrants,
  profiles,
  referralCodes,
  subscriptionTiers,
  userSubscriptions,
  type FoundingGrant,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  FOUNDING_POOL_CAPS,
  addMonths,
  foundingExternalId,
  tiersInPool,
  type FoundingPaymentMethod,
  type FoundingPool,
  type FoundingTierName,
} from "../founding/foundingOffer";
import { LIVE_SUBSCRIPTION_STATUSES } from "./subscriptionRepository";

/**
 * Founding-member grants (FOUNDING-OFFER BACKEND_BRIEF § 1, § 5).
 *
 * A grant is the record of an off-app payment. It becomes an entitlement by
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
  amountMinor: number;
  currency: string;
  paymentMethod: string;
  paymentReference: string | null;
  paidAt: Date;
  referralCode: string | null;
  referralLabel: string | null;
  subscriptionExpiresAt: Date | null;
  invitedAt: Date | null;
  appliedAt: Date | null;
  revokedAt: Date | null;
  revokeReason: string | null;
  notes: string | null;
  createdAt: Date;
  status: "pending" | "active" | "expired" | "revoked";
}

export interface CreateGrantInput {
  id: string;
  userId: string | null;
  email: string;
  tierName: FoundingTierName;
  months: number;
  amountMinor: number;
  currency: string;
  paymentMethod: FoundingPaymentMethod;
  paymentReference: string | null;
  paidAt: Date;
  referralCodeId: string | null;
  grantedBy: string;
  notes: string | null;
}

export type CreateGrantOutcome =
  | {
      kind: "created";
      grant: FoundingGrant;
      subscriptionExpiresAt: Date | null;
      seats: { pool: FoundingPool; used: number; cap: number };
    }
  | {
      kind: "pool_full";
      seats: { pool: FoundingPool; used: number; cap: number };
    }
  | { kind: "duplicate" };

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function statusOf(row: {
  userId: string | null;
  revokedAt: Date | null;
  subscriptionExpiresAt: Date | null;
}): GrantListRow["status"] {
  if (row.revokedAt) return "revoked";
  if (!row.userId) return "pending";
  if (
    row.subscriptionExpiresAt &&
    row.subscriptionExpiresAt.getTime() <= Date.now()
  )
    return "expired";
  return "active";
}

export class FoundingGrantRepository {
  async findProfileByEmail(
    email: string,
  ): Promise<{ id: string; email: string | null; role: string | null } | null> {
    const db = getDb();
    const rows = await db
      .select({ id: profiles.id, email: profiles.email, role: profiles.role })
      .from(profiles)
      .where(sql`lower(${profiles.email}) = ${email.toLowerCase()}`)
      .limit(1);
    return rows[0] ?? null;
  }

  async findProfileById(
    id: string,
  ): Promise<{ id: string; email: string | null; role: string | null } | null> {
    const db = getDb();
    const rows = await db
      .select({ id: profiles.id, email: profiles.email, role: profiles.role })
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
          inArray(foundingGrants.tierName, tiersInPool(pool)),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  }

  async seatsForPool(
    pool: FoundingPool,
  ): Promise<{ pool: FoundingPool; used: number; cap: number }> {
    const db = getDb();
    const used = await this.countLiveInPool(db, pool);
    return { pool, used, cap: FOUNDING_POOL_CAPS[pool] };
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
      paidAt: Date;
      paymentMethod: string;
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
          source: "founding_offer",
          grant_id: input.grantId,
          payment_method: input.paymentMethod,
          payment_reference: input.paymentReference,
          referral_code_id: input.referralCodeId,
          paid_at: input.paidAt.toISOString(),
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
   * pool's advisory lock. Returns `pool_full` without writing when the cap is
   * reached, `duplicate` when the user/email already holds a live grant.
   */
  async create(
    input: CreateGrantInput,
    pool: FoundingPool,
  ): Promise<CreateGrantOutcome> {
    const db = getDb();
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${"founding_pool_" + pool}))`,
      );

      const cap = FOUNDING_POOL_CAPS[pool];
      const used = await this.countLiveInPool(tx, pool);
      if (used >= cap) return { kind: "pool_full", seats: { pool, used, cap } };

      const dupe = await tx
        .select({ id: foundingGrants.id })
        .from(foundingGrants)
        .where(
          and(
            isNull(foundingGrants.revokedAt),
            input.userId
              ? sql`(${foundingGrants.userId} = ${input.userId} OR lower(${foundingGrants.email}) = ${input.email})`
              : sql`lower(${foundingGrants.email}) = ${input.email}`,
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

      return {
        kind: "created",
        grant: rows[0],
        subscriptionExpiresAt,
        seats: { pool, used: used + 1, cap },
      };
    });
  }

  /** Pending grants (paid, no account yet) for an email, oldest first. */
  async findPendingByEmail(email: string): Promise<FoundingGrant[]> {
    const db = getDb();
    return db
      .select()
      .from(foundingGrants)
      .where(
        and(
          isNull(foundingGrants.userId),
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
  ): Promise<{
    applied: boolean;
    expiresAt: Date | null;
    tierName: string | null;
  }> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const claimed = await tx
        .update(foundingGrants)
        .set({ userId, appliedAt: new Date() })
        .where(
          and(
            eq(foundingGrants.id, grantId),
            isNull(foundingGrants.userId),
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
      return {
        applied: true,
        expiresAt: sub.expiresAt,
        tierName: grant.tierName,
      };
    });
  }

  async markInvited(grantId: string): Promise<void> {
    const db = getDb();
    await db
      .update(foundingGrants)
      .set({ invitedAt: new Date() })
      .where(eq(foundingGrants.id, grantId));
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

  /**
   * Revoke: stamp the grant and cancel + expire its subscription row (the user
   * reverts to free-tier rules immediately). Idempotent.
   */
  async revoke(id: string, reason: string): Promise<FoundingGrant | null> {
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
        amountMinor: foundingGrants.amountMinor,
        currency: foundingGrants.currency,
        paymentMethod: foundingGrants.paymentMethod,
        paymentReference: foundingGrants.paymentReference,
        paidAt: foundingGrants.paidAt,
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
    return rows.map((r) => ({ ...r, status: statusOf(r) }));
  }

  async listForUser(userId: string): Promise<GrantListRow[]> {
    const db = getDb();
    const all = await this.list({ limit: 1000 });
    void db;
    return all.filter((g) => g.userId === userId);
  }

  async summary(): Promise<{
    pools: Record<FoundingPool, { used: number; cap: number }>;
    byTier: Array<{ tierName: string; count: number; revenueMinor: number }>;
    revenueMinor: number;
    pending: number;
  }> {
    const db = getDb();
    const rows = await db
      .select({
        tierName: foundingGrants.tierName,
        count: sql<number>`count(*)::int`,
        revenueMinor: sql<number>`coalesce(sum(${foundingGrants.amountMinor}), 0)::int`,
        pending: sql<number>`count(*) FILTER (WHERE ${foundingGrants.userId} IS NULL)::int`,
      })
      .from(foundingGrants)
      .where(isNull(foundingGrants.revokedAt))
      .groupBy(foundingGrants.tierName);
    const byTier = rows.map((r) => ({
      tierName: r.tierName,
      count: Number(r.count ?? 0),
      revenueMinor: Number(r.revenueMinor ?? 0),
    }));
    const usedIn = (pool: FoundingPool) =>
      byTier
        .filter((t) => (tiersInPool(pool) as string[]).includes(t.tierName))
        .reduce((n, t) => n + t.count, 0);
    return {
      pools: {
        consumer: {
          used: usedIn("consumer"),
          cap: FOUNDING_POOL_CAPS.consumer,
        },
        coach: { used: usedIn("coach"), cap: FOUNDING_POOL_CAPS.coach },
      },
      byTier,
      revenueMinor: byTier.reduce((n, t) => n + t.revenueMinor, 0),
      pending: rows.reduce((n, r) => n + Number(r.pending ?? 0), 0),
    };
  }
}
