import { and, eq, isNull, ne, sql } from "drizzle-orm";
import {
  foundingClaimChallenges as challenges,
  foundingGrants,
  userSubscriptions,
  type FoundingGrant,
  type FoundingClaimChallenge,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  lockUserSubscriptionMutation,
  liveSubscriptionFilter,
} from "./subscriptionRepository";
import { AdminAuditRepository } from "./adminAuditRepository";
import type { DatabaseTransaction } from "./referralRepository";

export type ClaimAccount = { id: string; email: string };
export type ClaimResult = {
  claimed: true;
  tierName: string;
  expiresAt: Date | null;
};
export class FoundingClaimError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(
    code = "invalid_claim",
    status = 400,
    message = "This code is invalid or expired. Request a new code and try again.",
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export class FoundingClaimRepository {
  async prepare(
    account: ClaimAccount,
    email: string,
    id: string,
    otpHash: string,
  ) {
    const db = getDb();
    // Bounded cleanup retains successful retries for 30 days, not indefinite email proofs.
    await db.execute(
      sql`DELETE FROM founding_claim_challenges WHERE id IN (SELECT id FROM founding_claim_challenges WHERE (completed_at IS NULL AND expires_at <= NOW()) OR completed_at < NOW()-INTERVAL '30 days' ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED)`,
    );
    const [grant] = await db
      .select({ id: foundingGrants.id })
      .from(foundingGrants)
      .where(
        and(
          sql`lower(${foundingGrants.email})=${email}`,
          isNull(foundingGrants.userId),
          isNull(foundingGrants.appliedAt),
          isNull(foundingGrants.revokedAt),
        ),
      )
      .limit(1);
    await db.insert(challenges).values({
      id,
      grantId: grant?.id ?? null,
      accountId: account.id,
      accountEmail: account.email,
      purchaseEmail: email,
      otpHash,
      expiresAt: new Date(Date.now() + 600000),
    });
  }
  async discard(id: string) {
    await getDb().delete(challenges).where(eq(challenges.id, id));
  }
  async consume(
    account: ClaimAccount,
    id: string,
    hash: string,
    apply: (
      grant: FoundingGrant,
      tx: DatabaseTransaction,
    ) => Promise<{
      applied: boolean;
      tierName: string | null;
      expiresAt: Date | null;
    }>,
  ): Promise<ClaimResult> {
    const result = await getDb().transaction(async (tx) => {
      await lockUserSubscriptionMutation(tx, account.id);
      const [c] = await tx
        .select()
        .from(challenges)
        .where(eq(challenges.id, id))
        .for("update");
      if (!c || c.accountId !== account.id || c.accountEmail !== account.email)
        return null;
      if (c.completedAt) {
        if (Date.now() - c.completedAt.getTime() > 30 * 86400000) return null;
        return this.completed(c, tx);
      }
      if (c.expiresAt <= new Date() || c.attempts >= 5) return null;
      await tx
        .update(challenges)
        .set({ attempts: c.attempts + 1 })
        .where(eq(challenges.id, id));
      if (c.otpHash !== hash) return null; // commit unsuccessful attempts
      if (!c.grantId) return { unavailable: true } as const;
      const [grant] = await tx
        .select()
        .from(foundingGrants)
        .where(eq(foundingGrants.id, c.grantId))
        .for("update");
      if (
        !grant ||
        grant.revokedAt ||
        grant.userId ||
        grant.appliedAt ||
        grant.email.trim().toLowerCase() !== c.purchaseEmail
      )
        return { unavailable: true } as const;
      const live = await tx
        .select({ id: userSubscriptions.id })
        .from(userSubscriptions)
        .where(
          and(
            eq(userSubscriptions.userId, account.id),
            liveSubscriptionFilter(),
            ne(userSubscriptions.tierName, "free"),
          ),
        )
        .limit(1);
      const other = await tx
        .select({ id: foundingGrants.id })
        .from(foundingGrants)
        .where(
          and(
            isNull(foundingGrants.revokedAt),
            ne(foundingGrants.id, grant.id),
            sql`(${foundingGrants.userId}=${account.id} OR (${foundingGrants.appliedAt} IS NULL AND lower(${foundingGrants.email})=${account.email}))`,
          ),
        )
        .limit(1);
      if (live.length || other.length)
        throw new FoundingClaimError(
          "subscription_conflict",
          409,
          "This account already has access. Contact support before claiming another grant.",
        );
      const applied = await apply(grant, tx);
      if (!applied.applied || !applied.tierName)
        throw new FoundingClaimError(
          "account_conflict",
          409,
          "This grant cannot be attached to this account. Contact support.",
        );
      await tx
        .update(challenges)
        .set({ completedAt: new Date(), otpHash: null })
        .where(eq(challenges.id, id));
      await new AdminAuditRepository().record(
        {
          actorId: account.id,
          action: "founding_grant.claim_verified_email",
          entityType: "founding_grant",
          entityId: grant.id,
          after: {
            userId: account.id,
            challengeId: id,
            tierName: applied.tierName,
          },
          reason: "Purchase email verified by one-time code",
        },
        tx,
      );
      return {
        claimed: true as const,
        tierName: applied.tierName,
        expiresAt: applied.expiresAt,
      };
    });
    if (!result) throw new FoundingClaimError();
    if ("unavailable" in result)
      throw new FoundingClaimError(
        "grant_unavailable",
        409,
        "No unclaimed access is available for this email. Check the email used for your purchase or invitation, or contact support.",
      );
    return result;
  }
  private async completed(
    c: FoundingClaimChallenge,
    tx: DatabaseTransaction,
  ): Promise<ClaimResult | null> {
    if (!c.grantId) return null;
    const [row] = await tx
      .select({
        tierName: foundingGrants.tierName,
        expiresAt: userSubscriptions.expiresAt,
      })
      .from(foundingGrants)
      .innerJoin(
        userSubscriptions,
        eq(userSubscriptions.id, foundingGrants.subscriptionId),
      )
      .where(
        and(
          eq(foundingGrants.id, c.grantId),
          eq(foundingGrants.userId, c.accountId),
          isNull(foundingGrants.revokedAt),
          liveSubscriptionFilter(),
        ),
      );
    return row
      ? { claimed: true, tierName: row.tierName, expiresAt: row.expiresAt }
      : null;
  }
}
