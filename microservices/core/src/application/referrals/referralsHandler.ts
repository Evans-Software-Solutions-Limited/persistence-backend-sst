import Elysia, { t } from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { ReferralRepository } from "../repositories/referralRepository";
import { isValidReferralCode, normalizeReferralCode } from "./referralCode";

/**
 * User-facing referral attribution (FOUNDING-OFFER BACKEND_BRIEF § 4b):
 *   POST   /referrals/claim  { code }  — claim / replace (until locked)
 *   GET    /referrals/me               — applied summary
 *   DELETE /referrals/me               — remove (until locked)
 *
 * Attribution only: nothing here changes price or entitlement (BRIEF D6).
 * Every failure to claim is the SAME 404 message — never reveal whether a code
 * exists, is paused, expired or exhausted (spec-32 § 10).
 *
 * Rate limit: a small in-memory per-user counter (10 attempts / hour). Per
 * Lambda instance, so it is a nuisance limit, not a security boundary — the
 * uniform error already denies enumeration value. Documented as v1.
 */
const ATTEMPT_WINDOW_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

export function checkClaimRateLimit(userId: string, now = Date.now()): boolean {
  const entry = attempts.get(userId);
  if (!entry || entry.resetAt <= now) {
    attempts.set(userId, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_ATTEMPTS) return false;
  entry.count += 1;
  return true;
}

/** Test hook. */
export function resetClaimRateLimit(): void {
  attempts.clear();
}

const INVALID = { message: "That code isn't valid" };

export const referralsHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post(
    "/referrals/claim",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      if (!checkClaimRateLimit(userId)) {
        ctx.set.status = 429;
        return { message: "Too many attempts — try again later" };
      }
      const canonical = normalizeReferralCode(ctx.body.code);
      if (!isValidReferralCode(canonical)) {
        ctx.set.status = 404;
        return INVALID;
      }
      const outcome = await new ReferralRepository().claim({
        userId,
        canonicalCode: canonical,
        source: "app",
      });
      switch (outcome.kind) {
        case "invalid":
          ctx.set.status = 404;
          return INVALID;
        case "locked":
          ctx.set.status = 409;
          return {
            message: "Your referral is already locked in",
            data: { applied: outcome.applied },
          };
        case "unchanged":
        case "applied":
          return { data: { applied: outcome.applied } };
      }
    },
    { body: t.Object({ code: t.String({ minLength: 1, maxLength: 64 }) }) },
  )
  .get("/referrals/me", async (ctx) => {
    const { sub: userId } = getUser(ctx);
    const applied = await new ReferralRepository().findAppliedForUser(userId);
    return { data: { applied } };
  })
  .delete("/referrals/me", async (ctx) => {
    const { sub: userId } = getUser(ctx);
    const res = await new ReferralRepository().remove(userId);
    if (res === "locked") {
      ctx.set.status = 409;
      return { message: "Your referral is already locked in" };
    }
    return { data: { removed: res === "removed" } };
  });
