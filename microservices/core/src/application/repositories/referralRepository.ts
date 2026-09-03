import { and, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  foundingGrants,
  profiles,
  referralCodes,
  referralRedemptions,
  type ReferralCode,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * Referral codes + one-attribution-per-user redemptions (FOUNDING-OFFER,
 * thin slice of spec-32 Slice B). A code is ATTRIBUTION ONLY — nothing here
 * touches `user_subscriptions` or prices (BRIEF D6).
 *
 * Concurrency contract for capped codes (spec-32 § 6): the claim is a single
 * conditional UPDATE that increments `redemption_count` only while it is below
 * `max_redemptions`, so two concurrent claims on the last seat cannot both
 * succeed. Counting rows first and inserting later is NOT used anywhere here.
 */

export type ClaimSource = "app" | "admin" | "web_link";

export interface AppliedReferral {
  codeId: string;
  code: string;
  label: string;
  partnerName: string | null;
  lockedAt: Date | null;
  source: ClaimSource;
  createdAt: Date;
}

export type ClaimOutcome =
  | { kind: "applied"; applied: AppliedReferral; replacedCodeId: string | null }
  | { kind: "invalid" }
  | { kind: "locked"; applied: AppliedReferral }
  | { kind: "unchanged"; applied: AppliedReferral };

export interface ReferralCodeSummary extends ReferralCode {
  grantCount: number;
  paidCount: number;
}

export interface CreateReferralCodeInput {
  code: string;
  displayCode: string;
  label: string;
  partnerName?: string | null;
  kind: "vendor" | "campaign" | "founding" | "internal";
  maxRedemptions?: number | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  campaignSlug?: string | null;
  notes?: string | null;
  createdBy: string;
}

export interface UpdateReferralCodeInput {
  status?: "active" | "paused" | "archived";
  label?: string;
  partnerName?: string | null;
  maxRedemptions?: number | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  campaignSlug?: string | null;
  notes?: string | null;
}

type Db = ReturnType<typeof getDb>;
export type DatabaseTransaction = Parameters<
  Parameters<Db["transaction"]>[0]
>[0];
type Tx = DatabaseTransaction;

async function lockReferralUser(tx: Tx, userId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`referral_user_${userId}`}))`,
  );
}

function toApplied(row: {
  codeId: string;
  code: string;
  canonicalCode?: string;
  label: string;
  partnerName: string | null;
  lockedAt: Date | null;
  source: string;
  createdAt: Date;
}): AppliedReferral {
  return {
    codeId: row.codeId,
    code: row.code,
    label: row.label,
    partnerName: row.partnerName,
    lockedAt: row.lockedAt,
    source: row.source as ClaimSource,
    createdAt: row.createdAt,
  };
}

export class ReferralRepository {
  // ─── Codes (admin) ──────────────────────────────────────────────────────

  async createCode(input: CreateReferralCodeInput): Promise<ReferralCode> {
    return this.createCodeIn(getDb(), input);
  }

  async createCodeIn(
    db: Db | Tx,
    input: CreateReferralCodeInput,
  ): Promise<ReferralCode> {
    const rows = await db
      .insert(referralCodes)
      .values({
        code: input.code,
        displayCode: input.displayCode,
        label: input.label,
        partnerName: input.partnerName ?? null,
        kind: input.kind,
        maxRedemptions: input.maxRedemptions ?? null,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        campaignSlug: input.campaignSlug ?? null,
        notes: input.notes ?? null,
        createdBy: input.createdBy,
      })
      .returning();
    return rows[0];
  }

  async findCodeById(id: string): Promise<ReferralCode | null> {
    return this.findCodeByIdIn(getDb(), id);
  }

  async findCodeByIdIn(db: Db | Tx, id: string): Promise<ReferralCode | null> {
    const rows = await db
      .select()
      .from(referralCodes)
      .where(eq(referralCodes.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findCodeByCanonical(code: string): Promise<ReferralCode | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(referralCodes)
      .where(eq(referralCodes.code, code))
      .limit(1);
    return rows[0] ?? null;
  }

  async isCodeEligible(id: string, transaction?: Tx): Promise<boolean> {
    const db = transaction ?? getDb();
    const query = db
      .select({ id: referralCodes.id })
      .from(referralCodes)
      .where(
        and(
          eq(referralCodes.id, id),
          eq(referralCodes.status, "active"),
          or(
            isNull(referralCodes.startsAt),
            sql`${referralCodes.startsAt} <= now()`,
          ),
          or(
            isNull(referralCodes.endsAt),
            sql`${referralCodes.endsAt} > now()`,
          ),
          or(
            isNull(referralCodes.maxRedemptions),
            sql`${referralCodes.redemptionCount} < ${referralCodes.maxRedemptions}`,
          ),
        ),
      )
      .limit(1);
    const rows = transaction ? await query.for("update") : await query;
    return rows.length > 0;
  }

  async updateCode(
    id: string,
    patch: UpdateReferralCodeInput,
  ): Promise<ReferralCode | null> {
    return this.updateCodeIn(getDb(), id, patch);
  }

  async updateCodeIn(
    db: Db | Tx,
    id: string,
    patch: UpdateReferralCodeInput,
  ): Promise<ReferralCode | null> {
    const rows = await db
      .update(referralCodes)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(referralCodes.id, id))
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Admin list with the three numbers vendor settlement needs per code:
   * claims (`redemption_count`), founding grants carrying the code, and
   * redemptions that reached a paid conversion (`locked_at IS NOT NULL`).
   */
  async listCodes(filter: {
    status?: "active" | "paused" | "archived";
    q?: string;
  }): Promise<ReferralCodeSummary[]> {
    const db = getDb();
    const conditions = [];
    if (filter.status) conditions.push(eq(referralCodes.status, filter.status));
    if (filter.q && filter.q.trim().length > 0) {
      const like = `%${filter.q.trim()}%`;
      conditions.push(
        or(
          ilike(referralCodes.code, like),
          ilike(referralCodes.label, like),
          ilike(referralCodes.partnerName, like),
        ),
      );
    }
    const rows = await db
      .select({
        code: referralCodes,
        grantCount: sql<number>`(
          SELECT count(*)::int FROM ${foundingGrants}
          WHERE ${foundingGrants.referralCodeId} = ${referralCodes.id}
            AND ${foundingGrants.revokedAt} IS NULL
        )`,
        paidCount: sql<number>`(
          SELECT count(*)::int FROM ${referralRedemptions}
          WHERE ${referralRedemptions.codeId} = ${referralCodes.id}
            AND ${referralRedemptions.lockedAt} IS NOT NULL
        )`,
      })
      .from(referralCodes)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(referralCodes.createdAt));
    return rows.map((r) => ({
      ...r.code,
      grantCount: Number(r.grantCount ?? 0),
      paidCount: Number(r.paidCount ?? 0),
    }));
  }

  async listRedemptionsForCode(
    codeId: string,
    limit = 200,
  ): Promise<
    Array<{
      userId: string;
      email: string | null;
      source: string;
      lockedAt: Date | null;
      createdAt: Date;
    }>
  > {
    const db = getDb();
    return db
      .select({
        userId: referralRedemptions.userId,
        email: profiles.email,
        source: referralRedemptions.source,
        lockedAt: referralRedemptions.lockedAt,
        createdAt: referralRedemptions.createdAt,
      })
      .from(referralRedemptions)
      .leftJoin(profiles, eq(profiles.id, referralRedemptions.userId))
      .where(eq(referralRedemptions.codeId, codeId))
      .orderBy(desc(referralRedemptions.createdAt))
      .limit(limit);
  }

  async countCodes(): Promise<{
    codes: number;
    claims: number;
    locked: number;
  }> {
    const db = getDb();
    const [codes] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(referralCodes);
    const [claims] = await db
      .select({
        n: sql<number>`count(*)::int`,
        locked: sql<number>`count(${referralRedemptions.lockedAt})::int`,
      })
      .from(referralRedemptions);
    return {
      codes: Number(codes?.n ?? 0),
      claims: Number(claims?.n ?? 0),
      locked: Number(claims?.locked ?? 0),
    };
  }

  // ─── Attribution (user + admin) ─────────────────────────────────────────

  async findAppliedForUser(userId: string): Promise<AppliedReferral | null> {
    const db = getDb();
    const rows = await this.selectApplied(db, userId);
    return rows[0] ? toApplied(rows[0]) : null;
  }

  private selectApplied(db: Db | Tx, userId: string) {
    return db
      .select({
        codeId: referralCodes.id,
        code: referralCodes.displayCode,
        canonicalCode: referralCodes.code,
        label: referralCodes.label,
        partnerName: referralCodes.partnerName,
        lockedAt: referralRedemptions.lockedAt,
        source: referralRedemptions.source,
        createdAt: referralRedemptions.createdAt,
      })
      .from(referralRedemptions)
      .innerJoin(
        referralCodes,
        eq(referralCodes.id, referralRedemptions.codeId),
      )
      .where(eq(referralRedemptions.userId, userId))
      .limit(1);
  }

  /**
   * Claim `canonicalCode` for `userId` (BRIEF D5). One transaction:
   *  1. Serialize all claim/remove/lock work for this user.
   *  2. If the user already holds a LOCKED attribution → `locked` (no writes),
   *     or already holds this code → `unchanged`, even if its cap is now full.
   *  3. Conditional increment on the code (active, inside its window, below
   *     cap) → zero rows means `invalid` — uniformly, whatever the reason.
   *  4. Upsert the user's single redemption row; when replacing an unlocked
   *     attribution, decrement the previous code's count and remember it in
   *     `replaced_code_id`.
   */
  async claim(
    input: {
      userId: string;
      canonicalCode: string;
      source: ClaimSource;
      createdBy?: string | null;
    },
    transaction?: Tx,
  ): Promise<ClaimOutcome> {
    const db = getDb();
    const execute = async (tx: Tx): Promise<ClaimOutcome> => {
      // `lock()` and `remove()` take the same transaction-scoped lock. Once it
      // is held, the redemption read below cannot go stale before our write.
      await lockReferralUser(tx, input.userId);
      const existingRows = await this.selectApplied(tx, input.userId);
      const existing = existingRows[0] ? toApplied(existingRows[0]) : null;
      if (existing?.lockedAt) {
        return { kind: "locked", applied: existing };
      }

      // Idempotency must not depend on the code still being claimable. A user
      // who already owns the final redemption can retry after the cap fills or
      // the campaign closes without turning success into an invalid-code error.
      if (existing && existingRows[0].canonicalCode === input.canonicalCode) {
        return { kind: "unchanged", applied: existing };
      }

      const claimed = await tx
        .update(referralCodes)
        .set({
          redemptionCount: sql`${referralCodes.redemptionCount} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(referralCodes.code, input.canonicalCode),
            eq(referralCodes.status, "active"),
            or(
              isNull(referralCodes.startsAt),
              sql`${referralCodes.startsAt} <= now()`,
            ),
            or(
              isNull(referralCodes.endsAt),
              sql`${referralCodes.endsAt} > now()`,
            ),
            or(
              isNull(referralCodes.maxRedemptions),
              sql`${referralCodes.redemptionCount} < ${referralCodes.maxRedemptions}`,
            ),
          ),
        )
        .returning({
          id: referralCodes.id,
          displayCode: referralCodes.displayCode,
          label: referralCodes.label,
          partnerName: referralCodes.partnerName,
        });
      const code = claimed[0];
      if (!code) return { kind: "invalid" };

      const now = new Date();
      if (existing) {
        await tx
          .update(referralCodes)
          .set({
            redemptionCount: sql`GREATEST(${referralCodes.redemptionCount} - 1, 0)`,
          })
          .where(eq(referralCodes.id, existing.codeId));
        await tx
          .update(referralRedemptions)
          .set({
            codeId: code.id,
            source: input.source,
            replacedCodeId: existing.codeId,
            createdBy: input.createdBy ?? null,
            updatedAt: now,
          })
          .where(eq(referralRedemptions.userId, input.userId));
      } else {
        await tx.insert(referralRedemptions).values({
          codeId: code.id,
          userId: input.userId,
          source: input.source,
          createdBy: input.createdBy ?? null,
        });
      }

      return {
        kind: "applied",
        replacedCodeId: existing?.codeId ?? null,
        applied: {
          codeId: code.id,
          code: code.displayCode,
          label: code.label,
          partnerName: code.partnerName,
          lockedAt: null,
          source: input.source,
          createdAt: existing?.createdAt ?? now,
        },
      };
    };
    return transaction ? execute(transaction) : db.transaction(execute);
  }

  /** Remove an UNLOCKED attribution. Returns false when locked or absent. */
  async remove(userId: string): Promise<"removed" | "locked" | "none"> {
    const db = getDb();
    return db.transaction(async (tx) => {
      await lockReferralUser(tx, userId);
      const rows = await tx
        .select({
          codeId: referralRedemptions.codeId,
          lockedAt: referralRedemptions.lockedAt,
        })
        .from(referralRedemptions)
        .where(eq(referralRedemptions.userId, userId))
        .limit(1);
      const row = rows[0];
      if (!row) return "none";
      if (row.lockedAt) return "locked";
      await tx
        .delete(referralRedemptions)
        .where(eq(referralRedemptions.userId, userId));
      await tx
        .update(referralCodes)
        .set({
          redemptionCount: sql`GREATEST(${referralCodes.redemptionCount} - 1, 0)`,
        })
        .where(eq(referralCodes.id, row.codeId));
      return "removed";
    });
  }

  /**
   * Freeze the user's attribution at first paid conversion (BRIEF D5). Idempotent;
   * returns whether this call did the locking. Best-effort callers (the RC sync)
   * must catch — a lock failure must never fail a purchase.
   */
  async lock(userId: string, transaction?: Tx): Promise<boolean> {
    const db = getDb();
    const execute = async (tx: Tx): Promise<boolean> => {
      await lockReferralUser(tx, userId);
      const rows = await tx
        .update(referralRedemptions)
        .set({ lockedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(referralRedemptions.userId, userId),
            isNull(referralRedemptions.lockedAt),
          ),
        )
        .returning({ id: referralRedemptions.id });
      return rows.length > 0;
    };
    return transaction ? execute(transaction) : db.transaction(execute);
  }

  /** True when the user holds a locked attribution to a DIFFERENT code. */
  async hasLockedOtherCode(userId: string, codeId: string): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .select({ id: referralRedemptions.id })
      .from(referralRedemptions)
      .where(
        and(
          eq(referralRedemptions.userId, userId),
          isNotNull(referralRedemptions.lockedAt),
          sql`${referralRedemptions.codeId} <> ${codeId}`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
