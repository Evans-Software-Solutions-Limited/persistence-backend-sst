import { ReferralRepository } from "../repositories/referralRepository";

/**
 * Freeze a user's referral attribution at first paid conversion (BRIEF D5).
 * Best-effort by contract: the RevenueCat sync calls this after activating a
 * subscription and MUST NOT fail the purchase if the lock fails, so errors are
 * logged and swallowed here.
 */
export async function lockReferralAttribution(
  userId: string,
  repo: ReferralRepository = new ReferralRepository(),
): Promise<boolean> {
  try {
    return await repo.lock(userId);
  } catch (err) {
    console.warn(`[referrals] lock failed for user ${userId}:`, err);
    return false;
  }
}
