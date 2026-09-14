import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql, desc, ilike, or } from "drizzle-orm";
import { getDb } from "@persistence/db/client";
import {
  businessVoucherBatches as batches,
  businessVouchers as vouchers,
  businessVoucherChallenges as challenges,
  businessVoucherRateLimits as rates,
  profiles,
  userSubscriptions,
  foundingGrants,
  adminAuditLog,
} from "@persistence/db";
import {
  lockUserSubscriptionMutation,
  liveSubscriptionFilter,
  LIVE_SUBSCRIPTION_STATUSES,
} from "./subscriptionRepository";
import { addMonths } from "../founding/foundingOffer";
import {
  canonicalCode,
  eligible,
  generateCode,
  hashSecret,
  normalizeDomains,
  normalizeEmail,
  VoucherError,
  type BatchInput,
} from "../vouchers/voucherRules";
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Batch = typeof batches.$inferSelect;
type Voucher = typeof vouchers.$inferSelect;
type Challenge = typeof challenges.$inferSelect;
export type VerifiedAccount = { id: string; email: string };
function status(v: Voucher, b: Batch) {
  return v.redeemedAt
    ? "redeemed"
    : v.revokedAt
      ? "revoked"
      : b.redeemBy && b.redeemBy <= new Date()
        ? "expired"
        : "unused";
}
function presentVoucher(v: Voucher, b: Batch) {
  return {
    id: v.id,
    batchId: v.batchId,
    codeHint: v.codeHint,
    employeeEmail: v.employeeEmail,
    status: status(v, b),
    eligibilityEmail: v.eligibilityEmail,
    accountEmail: v.accountEmail,
    accountId: v.accountId,
    redeemedAt: v.redeemedAt?.toISOString() ?? null,
    expiresAt: v.expiresAt?.toISOString() ?? null,
  };
}
function presentBatch(b: Batch, vs: Voucher[]) {
  const counts = {
    issued: vs.length,
    unused: 0,
    redeemed: 0,
    expired: 0,
    revoked: 0,
  };
  for (const v of vs) counts[status(v, b)]++;
  return {
    id: b.id,
    businessName: b.businessName,
    reference: b.reference,
    tierName: b.tierName,
    months: b.months,
    allowedDomains: b.allowedDomains,
    redeemBy: b.redeemBy?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    counts,
  };
}
function challengeDto(c: Challenge, b: Batch) {
  return {
    challengeId: c.id,
    verified: !!c.verifiedAt,
    eligibilityEmail: c.eligibilityEmail,
    accountEmail: c.accountEmail,
    businessName: b.businessName,
    tierName: b.tierName,
    months: b.months,
    expiresAt: c.expiresAt.toISOString(),
  };
}
function redemptionDto(v: Voucher, b: Batch) {
  return {
    voucherId: v.id,
    businessName: b.businessName,
    tierName: b.tierName,
    months: b.months,
    eligibilityEmail: v.eligibilityEmail!,
    accountEmail: v.accountEmail!,
    expiresAt: v.expiresAt!.toISOString(),
  };
}
async function audit(
  tx: Tx,
  actorId: string,
  action: string,
  entityId: string,
  after: Record<string, unknown>,
  reason?: string,
) {
  await tx.insert(adminAuditLog).values({
    actorId,
    action: `business_voucher.${action}`,
    entityType: "business_voucher_batch",
    entityId,
    after,
    reason,
  });
}
export class VoucherRepository {
  async list(q?: string) {
    const db = getDb();
    const bs = await db
      .select()
      .from(batches)
      .where(
        q
          ? or(
              ilike(batches.businessName, `%${q}%`),
              ilike(batches.reference, `%${q}%`),
            )
          : undefined,
      )
      .orderBy(desc(batches.createdAt))
      .limit(500);
    if (!bs.length) return [];
    const vs = await db
      .select()
      .from(vouchers)
      .where(
        inArray(
          vouchers.batchId,
          bs.map((b) => b.id),
        ),
      );
    return bs.map((b) =>
      presentBatch(
        b,
        vs.filter((v) => v.batchId === b.id),
      ),
    );
  }
  async detail(id: string) {
    const db = getDb();
    const [b] = await db.select().from(batches).where(eq(batches.id, id));
    if (!b) throw new VoucherError("not_found", 404);
    const vs = await db
      .select()
      .from(vouchers)
      .where(eq(vouchers.batchId, id))
      .orderBy(vouchers.createdAt, vouchers.id);
    return {
      batch: presentBatch(b, vs),
      vouchers: vs.map((v) => presentVoucher(v, b)),
    };
  }
  async create(input: BatchInput, actorId: string) {
    const domains = normalizeDomains(input.allowedDomains);
    const name = input.businessName.trim();
    if (
      !name ||
      name.length > 200 ||
      (input.reference?.length ?? 0) > 200 ||
      !Number.isInteger(input.quantity) ||
      input.quantity < 1 ||
      input.quantity > 500 ||
      !Number.isInteger(input.months) ||
      input.months < 1 ||
      input.months > 120 ||
      !["premium", "premium_plus"].includes(input.tierName)
    )
      throw new VoucherError("invalid_batch");
    const deadline = input.redeemBy ? new Date(input.redeemBy) : null;
    if (
      deadline &&
      (!Number.isFinite(deadline.getTime()) || deadline <= new Date())
    )
      throw new VoucherError("invalid_deadline");
    if (input.employeeEmails && input.employeeEmails.length !== input.quantity)
      throw new VoucherError("invalid_assignments");
    const emails = Array.from({ length: input.quantity }, (_, i) =>
      input.employeeEmails?.[i]?.trim()
        ? normalizeEmail(input.employeeEmails[i])
        : null,
    );
    const assigned = emails.filter((e): e is string => !!e);
    if (
      new Set(assigned).size !== assigned.length ||
      assigned.some((e) => !eligible(e, domains, null))
    )
      throw new VoucherError("invalid_assignments");
    return getDb().transaction(async (tx) => {
      const [b] = await tx
        .insert(batches)
        .values({
          businessName: name,
          reference: input.reference?.trim() || null,
          tierName: input.tierName,
          months: input.months,
          allowedDomains: domains,
          redeemBy: deadline,
          createdBy: actorId,
        })
        .returning();
      const codes = emails.map((employeeEmail) => ({
        id: randomUUID(),
        code: generateCode(),
        employeeEmail,
      }));
      const vs = await tx
        .insert(vouchers)
        .values(
          codes.map((c) => ({
            id: c.id,
            batchId: b.id,
            codeHash: hashSecret(c.code),
            codeHint: c.code.slice(-6),
            employeeEmail: c.employeeEmail,
          })),
        )
        .returning();
      await audit(tx, actorId, "create", b.id, {
        quantity: input.quantity,
        businessName: name,
        tierName: b.tierName,
        months: b.months,
        allowedDomains: domains,
      });
      return { batch: presentBatch(b, vs), codes };
    });
  }
  async assign(
    id: string,
    assignments: { voucherId: string; employeeEmail: string | null }[],
    actorId: string,
  ) {
    if (
      !assignments.length ||
      assignments.length > 500 ||
      new Set(assignments.map((a) => a.voucherId)).size !== assignments.length
    )
      throw new VoucherError("invalid_assignments");
    const normalized = assignments.map((a) => ({
      ...a,
      employeeEmail: a.employeeEmail?.trim()
        ? normalizeEmail(a.employeeEmail)
        : null,
    }));
    return getDb().transaction(async (tx) => {
      const [b] = await tx
        .select()
        .from(batches)
        .where(eq(batches.id, id))
        .for("update");
      if (!b) throw new VoucherError("not_found", 404);
      const vs = await tx
        .select()
        .from(vouchers)
        .where(eq(vouchers.batchId, id))
        .orderBy(vouchers.id)
        .for("update");
      const changes = new Map(
        normalized.map((a) => [a.voucherId, a.employeeEmail]),
      );
      if (
        normalized.some(
          (a) =>
            !vs.some(
              (v) => v.id === a.voucherId && status(v, b) === "unused",
            ) ||
            (a.employeeEmail &&
              !eligible(a.employeeEmail, b.allowedDomains, null)),
        )
      )
        throw new VoucherError("invalid_assignments", 409);
      const finalEmails = vs
        .map((v) => (changes.has(v.id) ? changes.get(v.id) : v.employeeEmail))
        .filter(Boolean);
      if (new Set(finalEmails).size !== finalEmails.length)
        throw new VoucherError("duplicate_employee", 409);
      // Clear first so swapping two assignments never trips the unique index.
      await tx
        .update(vouchers)
        .set({ employeeEmail: null })
        .where(
          inArray(
            vouchers.id,
            normalized.map((a) => a.voucherId),
          ),
        );
      for (const a of normalized)
        await tx
          .update(vouchers)
          .set({ employeeEmail: a.employeeEmail })
          .where(eq(vouchers.id, a.voucherId));
      await audit(tx, actorId, "assign", id, { assignments: normalized });
      return { updated: normalized.length };
    });
  }
  async revoke(
    id: string,
    voucherId: string | undefined,
    reason: string,
    actorId: string,
  ) {
    if (!reason.trim()) throw new VoucherError("reason_required");
    return getDb().transaction(async (tx) => {
      const [b] = await tx
        .select()
        .from(batches)
        .where(eq(batches.id, id))
        .for("update");
      if (!b) throw new VoucherError("not_found", 404);
      const changed = await tx
        .update(vouchers)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(vouchers.batchId, id),
            voucherId ? eq(vouchers.id, voucherId) : undefined,
            isNull(vouchers.redeemedAt),
            isNull(vouchers.revokedAt),
          ),
        )
        .returning({ id: vouchers.id });
      await audit(
        tx,
        actorId,
        "revoke",
        id,
        { voucherIds: changed.map((v) => v.id) },
        reason,
      );
      return { revoked: changed.length };
    });
  }
  async exportAudit(id: string, actorId: string) {
    await this.detail(id);
    await getDb().transaction((tx) => audit(tx, actorId, "export", id, {}));
    return { recorded: true };
  }
  /** Bounded opportunistic housekeeping on every authenticated redemption call.
   * Row locks prevent races with verification/counter resets; SKIP LOCKED keeps
   * one busy challenge from delaying the request. Permanent vouchers are never
   * deleted. Completed challenge handles support retries for 30 days.
   */
  async cleanupExpiredProofs(): Promise<void> {
    const db = getDb();
    await db.execute(sql`DELETE FROM business_voucher_rate_limits WHERE key IN (
      SELECT key FROM business_voucher_rate_limits WHERE resets_at <= NOW()
      ORDER BY resets_at LIMIT 100 FOR UPDATE SKIP LOCKED
    )`);
    await db.execute(sql`DELETE FROM business_voucher_challenges WHERE id IN (
      SELECT id FROM business_voucher_challenges
      WHERE completed_at IS NULL AND expires_at <= NOW()
      ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
    )`);
    await db.execute(sql`DELETE FROM business_voucher_challenges WHERE id IN (
      SELECT id FROM business_voucher_challenges
      WHERE completed_at < NOW() - INTERVAL '30 days'
      ORDER BY completed_at LIMIT 100 FOR UPDATE SKIP LOCKED
    )`);
  }
  async rateLimit(keys: { key: string; limit: number }[]) {
    await this.cleanupExpiredProofs();
    // Deliberately independent committed transactions: failed verification must
    // still consume its attempt across Lambda instances.
    for (const { key, limit } of keys) {
      const [r] = await getDb()
        .insert(rates)
        .values({
          key: hashSecret(key),
          attempts: 1,
          resetsAt: new Date(Date.now() + 3600000),
        })
        .onConflictDoUpdate({
          target: rates.key,
          set: {
            attempts: sql`CASE WHEN ${rates.resetsAt} <= NOW() THEN 1 ELSE ${rates.attempts}+1 END`,
            resetsAt: sql`CASE WHEN ${rates.resetsAt} <= NOW() THEN NOW()+INTERVAL '1 hour' ELSE ${rates.resetsAt} END`,
          },
        })
        .returning();
      if (r.attempts > limit)
        throw new VoucherError(
          "rate_limited",
          429,
          "Too many attempts. Please try again later.",
        );
    }
  }
  async prepare(
    account: VerifiedAccount,
    code: string,
    email: string,
    otpHash: string | null,
    challengeId: string,
  ) {
    return getDb().transaction(async (tx) => {
      const [v] = await tx
        .select()
        .from(vouchers)
        .where(eq(vouchers.codeHash, hashSecret(canonicalCode(code))))
        .for("update");
      if (!v) throw new VoucherError();
      const [b] = await tx
        .select()
        .from(batches)
        .where(eq(batches.id, v.batchId));
      if (
        status(v, b) !== "unused" ||
        !eligible(email, b.allowedDomains, v.employeeEmail)
      )
        throw new VoucherError();
      const [c] = await tx
        .insert(challenges)
        .values({
          id: challengeId,
          voucherId: v.id,
          accountId: account.id,
          accountEmail: account.email,
          eligibilityEmail: email,
          otpHash,
          verifiedAt: account.email === email ? new Date() : null,
          expiresAt: new Date(Date.now() + 600000),
        })
        .returning();
      return challengeDto(c, b);
    });
  }
  async discardChallenge(id: string) {
    await getDb().delete(challenges).where(eq(challenges.id, id));
  }
  async verify(account: VerifiedAccount, id: string, otpHash: string) {
    const result = await getDb().transaction(async (tx) => {
      const [c] = await tx
        .select()
        .from(challenges)
        .where(eq(challenges.id, id))
        .for("update");
      if (
        !c ||
        c.accountId !== account.id ||
        c.accountEmail !== account.email ||
        c.expiresAt <= new Date() ||
        c.completedAt ||
        c.attempts >= 5
      )
        return null;
      if (!c.verifiedAt) {
        const valid = c.otpHash === otpHash;
        const [updated] = await tx
          .update(challenges)
          .set({
            attempts: c.attempts + 1,
            ...(valid ? { verifiedAt: new Date(), otpHash: null } : {}),
          })
          .where(eq(challenges.id, id))
          .returning();
        if (!valid) return null;
        Object.assign(c, updated);
      }
      const [v] = await tx
        .select()
        .from(vouchers)
        .where(eq(vouchers.id, c.voucherId));
      const [b] = await tx
        .select()
        .from(batches)
        .where(eq(batches.id, v.batchId));
      return challengeDto(c, b);
    });
    if (!result) throw new VoucherError();
    return result;
  }
  async redeem(account: VerifiedAccount, id: string) {
    return getDb().transaction(async (tx) => {
      await lockUserSubscriptionMutation(tx, account.id);
      const [profile] = await tx
        .select({
          id: profiles.id,
          role: profiles.role,
          deletedAt: profiles.deletedAt,
        })
        .from(profiles)
        .where(eq(profiles.id, account.id))
        .for("update");
      if (!profile || profile.deletedAt)
        throw new VoucherError("account_unavailable", 409);
      const [c] = await tx
        .select()
        .from(challenges)
        .where(eq(challenges.id, id))
        .for("update");
      if (!c || c.accountId !== account.id || c.accountEmail !== account.email)
        throw new VoucherError();
      const [v] = await tx
        .select()
        .from(vouchers)
        .where(eq(vouchers.id, c.voucherId))
        .for("update");
      const [b] = await tx
        .select()
        .from(batches)
        .where(eq(batches.id, v.batchId));
      if (c.completedAt) {
        if (c.completedAt.getTime() < Date.now() - 30 * 86400000)
          throw new VoucherError();
        if (v.accountId === account.id && v.redeemedAt)
          return redemptionDto(v, b);
      }
      if (
        !c.verifiedAt ||
        c.expiresAt <= new Date() ||
        status(v, b) !== "unused" ||
        !eligible(c.eligibilityEmail, b.allowedDomains, v.employeeEmail)
      )
        throw new VoucherError();
      if (profile.role !== "user")
        throw new VoucherError(
          "account_conflict",
          409,
          "This account cannot receive a consumer membership. Contact support.",
        );
      const live = await tx
        .select({ id: userSubscriptions.id })
        .from(userSubscriptions)
        .where(
          and(
            eq(userSubscriptions.userId, account.id),
            liveSubscriptionFilter(),
            sql`${userSubscriptions.tierName} <> 'free'`,
          ),
        )
        .limit(1);
      const pending = await tx
        .select({ id: foundingGrants.id })
        .from(foundingGrants)
        .where(
          and(
            isNull(foundingGrants.revokedAt),
            isNull(foundingGrants.appliedAt),
            or(
              eq(foundingGrants.userId, account.id),
              and(
                sql`lower(${foundingGrants.email})=${account.email}`,
                isNull(foundingGrants.appliedAt),
              ),
            ),
          ),
        )
        .limit(1);
      if (live.length || pending.length)
        throw new VoucherError(
          "subscription_conflict",
          409,
          "This account already has a membership or pending grant. Contact support before redeeming.",
        );
      const now = new Date();
      const expiresAt = addMonths(now, b.months);
      await tx
        .update(userSubscriptions)
        .set({ paymentStatus: "expired", updatedAt: now })
        .where(
          and(
            eq(userSubscriptions.userId, account.id),
            inArray(userSubscriptions.paymentStatus, [
              ...LIVE_SUBSCRIPTION_STATUSES,
            ]),
          ),
        );
      const [sub] = await tx
        .insert(userSubscriptions)
        .values({
          userId: account.id,
          tierName: b.tierName,
          paymentStatus: "active",
          startsAt: now,
          expiresAt,
          cancelledAt: now,
          billingCycle: "monthly",
          externalSubscriptionId: `business_voucher_${v.id}`,
          metadata: {
            source: "business_voucher",
            voucher_id: v.id,
            batch_id: b.id,
            business_name: b.businessName,
          },
        })
        .returning({ id: userSubscriptions.id });
      const [redeemed] = await tx
        .update(vouchers)
        .set({
          redeemedAt: now,
          accountId: account.id,
          accountEmail: account.email,
          eligibilityEmail: c.eligibilityEmail,
          subscriptionId: sub.id,
          expiresAt,
        })
        .where(eq(vouchers.id, v.id))
        .returning();
      await tx
        .update(challenges)
        .set({ completedAt: now, otpHash: null })
        .where(eq(challenges.id, id));
      await audit(tx, account.id, "redeem", b.id, {
        voucherId: v.id,
        subscriptionId: sub.id,
        accountId: account.id,
      });
      return redemptionDto(redeemed, b);
    });
  }
}
