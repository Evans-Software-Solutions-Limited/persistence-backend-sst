import Elysia, { t } from "elysia";
import { adminGuard } from "../_adminGuard";
import { getUser } from "@persistence/api-utils/auth/supabaseAuth";
import { AdminAuditRepository } from "../../repositories/adminAuditRepository";
import { ReferralRepository } from "../../repositories/referralRepository";
import {
  isValidReferralCode,
  normalizeReferralCode,
} from "../../referrals/referralCode";

/**
 * POST /admin/referral-attributions — set or replace a user's attribution by
 * hand (spec-32 § 5 "controlled reassignment"). Reason is mandatory and lands
 * in the audit log. Refuses to move a LOCKED attribution (409).
 */
export const adminAttributionsHandler = new Elysia().use(adminGuard).post(
  "/admin/referral-attributions",
  async (ctx) => {
    const { sub: actorId } = getUser(ctx);
    const canonical = normalizeReferralCode(ctx.body.code);
    if (!isValidReferralCode(canonical)) {
      ctx.set.status = 400;
      return { message: "Code must be 4–24 letters or digits" };
    }
    const repo = new ReferralRepository();
    const before = await repo.findAppliedForUser(ctx.body.userId);
    const outcome = await repo.claim({
      userId: ctx.body.userId,
      canonicalCode: canonical,
      source: "admin",
      createdBy: actorId,
    });
    if (outcome.kind === "invalid") {
      ctx.set.status = 404;
      return { message: "That code isn't valid" };
    }
    if (outcome.kind === "locked") {
      ctx.set.status = 409;
      return { message: "This user's attribution is locked" };
    }
    await new AdminAuditRepository().record({
      actorId,
      action: "referral_attribution.set",
      entityType: "user",
      entityId: ctx.body.userId,
      before: before ? { code: before.code } : null,
      after: { code: outcome.applied.code },
      reason: ctx.body.reason,
    });
    return { data: outcome.applied };
  },
  {
    body: t.Object({
      userId: t.String({ format: "uuid" }),
      code: t.String({ minLength: 1, maxLength: 64 }),
      reason: t.String({ minLength: 3, maxLength: 500 }),
    }),
  },
);
