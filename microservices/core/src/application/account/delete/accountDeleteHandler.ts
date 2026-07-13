import Elysia from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { AccountRepository } from "../accountRepository";
import { getSupabaseAdminConfig } from "../supabaseAdminClient";
import { cancelStripeSubscriptions } from "../cancelUserStripeSubscriptions";

const accountRepository = new AccountRepository();

/**
 * `DELETE /account` — soft-delete the caller's account into a 30-day
 * cooling-off window (Cluster 2a; supersedes the immediate-purge flow that
 * shipped for 08-profile-settings § Revised 2026-06-28, STORY-011 / App Store
 * Guideline 5.1.1(v) — the guideline requires an in-app deletion PATH, not
 * that data vanish instantly, and a cooling-off period is standard practice
 * elsewhere in the industry).
 *
 * Acts only on the authenticated caller's own `userId` (from the JWT — never
 * an id from the body). Flow:
 *   1. Fail fast (500) if the Supabase service-role key is unset — mirrors
 *      the old fail-fast guard so a mis-configured stage never silently
 *      accepts a deletion request the nightly purge worker can't later
 *      complete (it needs the same admin key to delete the auth user).
 *   2. Cancel any active Stripe-direct subscription (stop billing NOW, not in
 *      30 days — the user shouldn't be billed during the cooling-off window).
 *      Dormant no-op for RevenueCat/Apple-IAP-only users (no `sub_…` ids) —
 *      harmless safety net, left as-is.
 *   3. Stamp `profiles.deleted_at` / `purge_after` (30 days out). NO data
 *      purge and NO auth-user delete here — those are the nightly purge
 *      worker's job once the window elapses (`accountPurgeCron.ts`).
 *
 * Idempotent: re-calling before the window elapses just re-stamps both
 * columns (extends the cooling-off window from "now"), and re-cancelling an
 * already-cancelled Stripe sub is itself idempotent (resource_missing → ok).
 */
export const accountDeleteHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .delete("/account", async (ctx) => {
    const { sub: userId } = getUser(ctx);

    // 1. Fail fast if unconfigured — the purge worker needs this same
    //    config later, so refuse to start the cooling-off window at all if
    //    it's unset (an operator error, not a per-request condition).
    try {
      getSupabaseAdminConfig();
    } catch {
      ctx.set.status = 500;
      return { error: "Account deletion is not configured" };
    }

    // 2. Cancel active Stripe subscription (stop billing during cooldown).
    try {
      await cancelStripeSubscriptions(userId);
    } catch (err) {
      console.error("[account:delete] Stripe subscription cancel failed:", err);
      ctx.set.status = 502;
      return {
        error:
          "Couldn't cancel your active subscription. Please try again or cancel it manually first.",
      };
    }

    // 3. Soft-delete: stamp deleted_at/purge_after. No purge, no auth-user
    //    delete — the nightly worker completes the deletion after 30 days.
    let purgeAfter: Date;
    try {
      purgeAfter = await accountRepository.softDelete(userId);
    } catch (err) {
      console.error("[account:delete] soft-delete stamp failed:", err);
      ctx.set.status = 500;
      return { error: "Failed to delete account" };
    }

    return {
      data: { softDeleted: true, purgeAfter: purgeAfter.toISOString() },
    };
  });
