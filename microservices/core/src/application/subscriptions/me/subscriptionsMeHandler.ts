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

/**
 * GET /subscriptions/me — current entitlement read.
 *
 * Auth required (JWT via `requireAuth` middleware). Returns the user's
 * current subscription joined with tier + profile role + trial-eligibility
 * flags. When the user has no `user_subscriptions` row, the repository
 * synthesises a `free`-tier shape from the catalog so the UI never has
 * to handle a null sub specially.
 *
 * **Trigger contract**: handler is read-only. NEVER writes to
 * `profiles.subscription_id`, `profiles.role`, `subscription_limits.*`.
 * NEVER writes to `profiles.has_used_*_trial` here — those are written
 * only by the create handler's trial-using paths.
 *
 * Edge cases:
 *   - Auth failure → 401 (handled by `requireAuth` middleware).
 *   - Profile row missing for the JWT subject → 404 (the schema
 *     invariant says every authed user has a profile; surface loudly).
 *   - Free-tier catalog row missing → 500 (repo throws; deploy
 *     misconfig). Caller's error handler logs structurally.
 */

type MeError = { error: string };

export const subscriptionsMeHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .get(
    "/subscriptions/me",
    async (ctx): Promise<{ data: MySubscription } | MeError> => {
      const { sub: userId } = getUser(ctx);

      const repo = new SubscriptionRepository();
      let sub: MySubscription | null;
      try {
        sub = await repo.findForUser(userId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Structured log so an alert on this log line surfaces the
        // deploy misconfig (missing 'free' tier in the catalog).
        console.error(
          `[subscriptions:me] findForUser failed for user=${userId}: ${message}`,
        );
        ctx.set.status = 500;
        return { error: "Failed to load subscription state" };
      }

      if (sub === null) {
        // Profile row missing for an authed userId — schema corruption.
        // Surface as 404 so the mobile shows a "profile not found"
        // state rather than treating it as a network blip.
        ctx.set.status = 404;
        return { error: "User profile not found" };
      }

      return { data: sub };
    },
  );
