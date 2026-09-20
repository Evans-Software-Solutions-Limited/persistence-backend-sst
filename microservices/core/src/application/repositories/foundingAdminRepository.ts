import { and, eq, sql } from "drizzle-orm";
import {
  catalogTier,
  isGrantableTier,
} from "@persistence/subscription-catalog";
import {
  foundingGrants,
  foundingRefunds,
  profiles,
  subscriptionTiers,
  userSubscriptions,
  type FoundingRefund,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { AdminAuditRepository } from "./adminAuditRepository";
import { liveSubscriptionFilter } from "./subscriptionRepository";
import {
  foundingExternalId,
  isFoundingTier,
  FOUNDING_OFFERS,
} from "../founding/foundingOffer";

export class FoundingAdminError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export class FoundingAdminRepository {
  async changeTier(
    id: string,
    tierName: string,
    reason: string,
    actorId: string,
  ) {
    if (!isGrantableTier(tierName))
      throw new FoundingAdminError("invalid_tier", 400);
    return getDb().transaction(async (tx) => {
      const [grant] = await tx
        .select()
        .from(foundingGrants)
        .where(eq(foundingGrants.id, id))
        .for("update");
      if (!grant) throw new FoundingAdminError("not_found", 404);
      // applyPending takes the user lock before the grant row; extend does the
      // reverse. Never wait for the user lock while holding the grant row.
      if (grant.userId) {
        const [lock] = await tx
          .select({
            acquired: sql<boolean>`pg_try_advisory_xact_lock(hashtext(${`subscription_user_${grant.userId}`}))`,
          })
          .from(foundingGrants)
          .where(eq(foundingGrants.id, id));
        if (!lock.acquired) throw new FoundingAdminError("grant_changed_retry");
      }
      if (grant.revokedAt) throw new FoundingAdminError("revoked");
      if (grant.appliedAt && !grant.userId)
        throw new FoundingAdminError("account_deleted");
      if (
        !isGrantableTier(grant.tierName) ||
        catalogTier(grant.tierName).audience !== catalogTier(tierName).audience
      )
        throw new FoundingAdminError("different_audience", 400);
      if (
        grant.grantKind === "founding" &&
        (!isFoundingTier(tierName) ||
          !isFoundingTier(grant.tierName) ||
          FOUNDING_OFFERS[tierName].pool !==
            FOUNDING_OFFERS[grant.tierName].pool)
      )
        throw new FoundingAdminError("different_pool", 400);
      const [tier] = await tx
        .select({ name: subscriptionTiers.tierName })
        .from(subscriptionTiers)
        .where(eq(subscriptionTiers.tierName, tierName));
      if (!tier) throw new FoundingAdminError("tier_missing", 400);
      let expiresAt: Date | null = null;
      if (grant.userId) {
        const [profile] = await tx
          .select({ role: profiles.role, deletedAt: profiles.deletedAt })
          .from(profiles)
          .where(eq(profiles.id, grant.userId))
          .for("update");
        if (!profile || profile.deletedAt)
          throw new FoundingAdminError("account_pending_deletion");
        if (profile.role === "admin")
          throw new FoundingAdminError("protected_account");
        if (
          catalogTier(tierName).audience === "consumer" &&
          ["personal_trainer", "physiotherapist"].includes(profile.role ?? "")
        )
          throw new FoundingAdminError("coach_demotion");
        const subs = await tx
          .select({
            id: userSubscriptions.id,
            expiresAt: userSubscriptions.expiresAt,
            externalId: userSubscriptions.externalSubscriptionId,
          })
          .from(userSubscriptions)
          .where(
            and(
              eq(userSubscriptions.userId, grant.userId),
              liveSubscriptionFilter(),
            ),
          )
          .for("update");
        const sub = subs.find(
          (s) =>
            s.id === grant.subscriptionId &&
            s.externalId === foundingExternalId(grant.id),
        );
        if (!sub || subs.length !== 1)
          throw new FoundingAdminError("grant_not_active");
        expiresAt = sub.expiresAt;
        await tx
          .update(userSubscriptions)
          .set({ tierName, updatedAt: new Date() })
          .where(eq(userSubscriptions.id, sub.id));
      }
      await tx
        .update(foundingGrants)
        .set({ tierName })
        .where(eq(foundingGrants.id, id));
      await new AdminAuditRepository().record(
        {
          actorId,
          action: "founding_grant.change_tier",
          entityType: "founding_grant",
          entityId: id,
          before: { tierName: grant.tierName },
          after: { tierName, expiresAt: expiresAt?.toISOString() ?? null },
          reason,
        },
        tx,
      );
      return { id, tierName, expiresAt };
    });
  }

  async findRefund(grantId: string): Promise<FoundingRefund | null> {
    const [row] = await getDb()
      .select()
      .from(foundingRefunds)
      .where(eq(foundingRefunds.grantId, grantId));
    return row ?? null;
  }

  async requestRefund(
    grantId: string,
    reason: string,
    actorId: string,
  ): Promise<FoundingRefund> {
    return getDb().transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${"founding_refund_" + grantId}))`,
      );
      const [existing] = await tx
        .select()
        .from(foundingRefunds)
        .where(eq(foundingRefunds.grantId, grantId));
      if (existing) {
        if (existing.reason !== reason)
          throw new FoundingAdminError("refund_already_requested");
        return existing;
      }
      const [created] = await tx
        .insert(foundingRefunds)
        .values({ grantId, reason, actorId })
        .returning();
      await new AdminAuditRepository().record(
        {
          actorId,
          action: "founding_grant.refund_requested",
          entityType: "founding_grant",
          entityId: grantId,
          after: { status: "requested" },
          reason,
        },
        tx,
      );
      return created;
    });
  }

  async recordRefund(
    grantId: string,
    refundId: string,
    status: string,
  ): Promise<FoundingRefund> {
    return getDb().transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(foundingRefunds)
        .where(eq(foundingRefunds.grantId, grantId))
        .for("update");
      // A delayed HTTP response must not downgrade a state already reconciled.
      if (before.refundId && before.refundId !== refundId)
        throw new FoundingAdminError("refund_mismatch");
      if (
        ["failed", "canceled"].includes(before.status) ||
        (before.status === "succeeded" &&
          ["pending", "requires_action"].includes(status)) ||
        (before.status === status && before.refundId === refundId)
      )
        return before;
      const [after] = await tx
        .update(foundingRefunds)
        .set({ refundId, status, updatedAt: new Date() })
        .where(eq(foundingRefunds.grantId, grantId))
        .returning();
      await new AdminAuditRepository().record(
        {
          actorId: before.actorId,
          action: "founding_grant.refund_updated",
          entityType: "founding_grant",
          entityId: grantId,
          before: { status: before.status },
          after: { status, refundId },
          reason: before.reason,
        },
        tx,
      );
      return after;
    });
  }
}
