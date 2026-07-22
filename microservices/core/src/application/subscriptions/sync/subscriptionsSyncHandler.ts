import Elysia from "elysia";

import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";

import {
  SubscriptionRepository,
  type MySubscription,
} from "../../repositories/subscriptionRepository";
import { syncRevenueCatCustomer } from "../../revenuecat/revenueCatSync";

/**
 * POST /subscriptions/sync — reconcile the caller's `user_subscriptions` row
 * from RevenueCat ON DEMAND, then return the refreshed subscription.
 *
 * Why this exists: purchase/restore only talk to RevenueCat on-device; the DB
 * is otherwise updated solely by the async RevenueCat→backend webhook, so
 * right after a restore `GET /subscriptions/me` usually still reads the stale
 * `free` tier (the webhook loses the race). The mobile app calls this after a
 * purchase/restore so the entitlement is confirmed server-side deterministically
 * — the "Subscription Activated!" screen is then gated on THIS confirmed result,
 * not an optimistic on-device snapshot. Reuses the webhook's exact
 * re-fetch-from-REST + upsert logic (`syncRevenueCatCustomer`).
 *
 * Auth required (JWT). The JWT subject IS the RevenueCat `app_user_id` (bound
 * via `Purchases.logIn`), so we sync the caller's own customer — never a
 * client-supplied id.
 *
 * - RevenueCat REST unreachable / sync throws → 502 (transient; client may
 *   retry or fall back to showing the on-device state without claiming success).
 * - `findForUser` fails (missing 'free' catalog row) → 500.
 * - Profile row missing for the authed subject → 404.
 */

type SyncError = { error: string };

export const subscriptionsSyncHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post(
    "/subscriptions/sync",
    async (ctx): Promise<{ data: MySubscription } | SyncError> => {
      const { sub: userId } = getUser(ctx);

      try {
        await syncRevenueCatCustomer(userId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[subscriptions:sync] RevenueCat reconcile failed for user=${userId}: ${message}`,
        );
        ctx.set.status = 502;
        return { error: "subscription_sync_failed" };
      }

      const repo = new SubscriptionRepository();
      let sub: MySubscription | null;
      try {
        sub = await repo.findForUser(userId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[subscriptions:sync] findForUser failed for user=${userId}: ${message}`,
        );
        ctx.set.status = 500;
        return { error: "Failed to load subscription state" };
      }

      if (sub === null) {
        ctx.set.status = 404;
        return { error: "User profile not found" };
      }

      return { data: sub };
    },
  );
