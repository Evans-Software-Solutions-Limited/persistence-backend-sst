import Elysia from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { AccountRepository } from "../accountRepository";
import {
  getSupabaseAdminConfig,
  deleteAuthUserWithRetry,
} from "../supabaseAdminClient";
import { SubscriptionRepository } from "../../repositories/subscriptionRepository";
import { getStripe } from "../../stripe/stripeClient";

const accountRepository = new AccountRepository();

/**
 * Detect Stripe errors meaning "the subscription is already cancelled/gone."
 * Mirrors subscriptionsCancelHandler.ts — kept inline to avoid a circular dep.
 */
function isAlreadyCanceledError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code =
    (err as { code?: unknown }).code ??
    (err as { raw?: { code?: unknown } }).raw?.code;
  if (code === "resource_missing") return true;
  const message = err instanceof Error ? err.message : String(err);
  return /already\s+cancell?ed|has been cancell?ed/i.test(message);
}

/**
 * Cancel any active Stripe-direct subscription for the user before purging
 * their data. RevenueCat/Apple IAP subs (externalSubscriptionId starting with
 * "rc_") cannot be cancelled server-side — the mobile confirm dialog instructs
 * the user to cancel in iOS Settings.
 *
 * Throws on a non-recoverable Stripe error so the handler can abort before
 * purging (the user stays signed in and can retry).
 */
async function cancelActiveStripeSubscription(userId: string): Promise<void> {
  const subRepo = new SubscriptionRepository();
  const sub = await subRepo.findMostRecentForUser(userId);
  if (!sub) return;

  const extId = sub.externalSubscriptionId;
  if (typeof extId !== "string" || extId.length === 0) return;
  // Skip RevenueCat-managed (Apple IAP) subscriptions — can't cancel server-side.
  if (extId.startsWith("rc_")) return;
  // Skip already-cancelled rows.
  if (sub.paymentStatus === "cancelled" || sub.paymentStatus === "canceled")
    return;

  const stripe = getStripe();
  try {
    await stripe.subscriptions.cancel(extId);
  } catch (err) {
    if (isAlreadyCanceledError(err)) {
      // Already cancelled on Stripe — idempotent, treat as success.
      return;
    }
    throw err;
  }
}

/**
 * `DELETE /account` — permanently delete the caller's account (08-profile-
 * settings § Revised 2026-06-28, STORY-011; App Store Guideline 5.1.1(v)).
 *
 * Acts only on the authenticated caller's own `userId` (from the JWT — never
 * an id from the body). Flow:
 *   1. Fail fast (500) if the Supabase service-role key is unset — BEFORE any
 *      purge, so an unconfigured stage never half-deletes an account.
 *   2. Cancel any active Stripe-direct subscription (stop billing).
 *   3. Atomically purge all of the caller's owned data (one transaction).
 *   4. Delete the Supabase `auth.users` record (bounded retry; failure is
 *      logged for ops cleanup but does NOT block the 200 — the user's data
 *      is gone and they should be signed out regardless).
 *
 * Idempotent: a retry after a transient failure cancels an already-cancelled
 * sub (resource_missing → ok), purges zero rows, and treats an already-deleted
 * auth user (404) as success.
 */
export const accountDeleteHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .delete("/account", async (ctx) => {
    const { sub: userId } = getUser(ctx);

    // 1. Fail fast if unconfigured.
    try {
      getSupabaseAdminConfig();
    } catch {
      ctx.set.status = 500;
      return { error: "Account deletion is not configured" };
    }

    // 2. Cancel active Stripe subscription (stop billing BEFORE purge).
    try {
      await cancelActiveStripeSubscription(userId);
    } catch (err) {
      console.error("[account:delete] Stripe subscription cancel failed:", err);
      ctx.set.status = 502;
      return {
        error:
          "Couldn't cancel your active subscription. Please try again or cancel it manually first.",
      };
    }

    // 3. Purge all user-owned data (atomic transaction).
    try {
      await accountRepository.purgeUserData(userId);
    } catch (err) {
      console.error("[account:delete] data purge failed:", err);
      ctx.set.status = 500;
      return { error: "Failed to delete account" };
    }

    // 4. Delete the Supabase auth user (bounded retry). After a successful
    //    purge the user's data is already gone — we always return 200 so the
    //    mobile signs out. A transient auth-delete failure is logged for ops
    //    cleanup (the zombie auth.users row has no profile → can't be used
    //    meaningfully, and Apple compliance is met: the PII/data is deleted).
    try {
      await deleteAuthUserWithRetry(userId);
    } catch (err) {
      console.error(
        "[account:delete] auth user delete failed after retries (ops cleanup needed):",
        err,
      );
    }

    return { data: { deleted: true } };
  });
