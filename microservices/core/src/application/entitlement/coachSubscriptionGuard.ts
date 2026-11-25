import Elysia from "elysia";
import { getAuthUser } from "@persistence/api-utils/auth/supabaseAuth";
import { resolveTrainerClientsEntitlement } from "./assertEntitlement";

/**
 * Coach platform access (PER-146, Brad 24 Nov 2026): the coach workspace is
 * only for coaches with an ACTIVE coach subscription. Every coach workspace
 * route refuses anyone else with
 *
 *   403 { code: "coach_subscription_required", message }
 *
 * and the web coach platform sends them to the coach plans page on that code.
 *
 * "Active coach subscription" is NOT redefined here. It is the effective
 * (post-lapse) `subscription_tiers.is_trainer_tier` flag that
 * `resolveTrainerClientsEntitlement` already resolves for the client-seat cap:
 * the latest `user_subscriptions` row joined to the catalog, with a cancelled /
 * expired / past-due row reverting to free-tier rules. Founding and admin grants
 * are ordinary `user_subscriptions` rows, so any coach catalog tier counts.
 *
 * Two ways to apply it:
 *
 *  - `coachWorkspaceGuard` is mounted ONCE near the top of the root app
 *    (`src/api.ts`) and covers every route whose pattern is a coach workspace
 *    route (`isCoachWorkspaceRoute`): everything under `/trainers/me/…`, plus
 *    the two legacy coach routes outside that prefix. A new route under
 *    `/trainers/me/…` is covered with no extra code.
 *  - `coachSubscriptionGuard` is a scoped plugin for a coach route group that
 *    lives OUTSIDE `/trainers/me/…`: `.use(coachSubscriptionGuard)` as the
 *    group's first plugin (one line). Applying it inside `/trainers/me/…` too is
 *    harmless, just a second identical check.
 *
 * Both run BEFORE the route's own auth: with no valid JWT the guard steps aside
 * and the route answers 401 exactly as before, so signed-out behaviour is
 * unchanged. The route's own role check (`isTrainer`) still runs after it.
 */

export const COACH_SUBSCRIPTION_REQUIRED = "coach_subscription_required";

export const COACH_SUBSCRIPTION_REQUIRED_MESSAGE =
  "The coach platform needs an active coach plan. Get one in the Persistence app.";

/**
 * Coach routes that predate the `/trainers/me` prefix. Matched on the route
 * PATTERN, so `/clients/me/relationships` (the athlete's own) never matches.
 */
const LEGACY_COACH_ROUTES: ReadonlySet<string> = new Set([
  "/clients/:clientId/measurements",
  "/clients/:clientId/body-trend",
]);

/** Is this route pattern part of the coach workspace? */
export function isCoachWorkspaceRoute(route: string | undefined): boolean {
  if (!route) return false;
  return (
    route === "/trainers/me" ||
    route.startsWith("/trainers/me/") ||
    LEGACY_COACH_ROUTES.has(route)
  );
}

/** True when the user's effective subscription is on a coach catalog tier. */
export async function hasActiveCoachSubscription(
  userId: string,
): Promise<boolean> {
  const ctx = await resolveTrainerClientsEntitlement(userId);
  return ctx.isTrainerTier;
}

interface GuardContext {
  headers: Record<string, string | undefined>;
  set: { status?: number | string };
}

/**
 * The check itself. Returns `undefined` to let the request through (no valid
 * JWT, so the route's own `requireAuth` answers; or an active coach
 * subscription), or the 403 body to stop it.
 */
export async function refuseWithoutCoachSubscription(
  ctx: GuardContext,
): Promise<{ code: string; message: string } | undefined> {
  const user = await getAuthUser(ctx.headers.authorization);
  if (!user?.sub) return undefined;
  if (await hasActiveCoachSubscription(user.sub)) return undefined;
  ctx.set.status = 403;
  return {
    code: COACH_SUBSCRIPTION_REQUIRED,
    message: COACH_SUBSCRIPTION_REQUIRED_MESSAGE,
  };
}

/** Root-level guard for every coach workspace route. Mount once in api.ts. */
export const coachWorkspaceGuard = new Elysia({
  name: "coach-workspace-guard",
}).onBeforeHandle({ as: "global" }, (ctx) =>
  isCoachWorkspaceRoute(ctx.route)
    ? refuseWithoutCoachSubscription(ctx)
    : undefined,
);

/** One-line guard for a coach route group outside `/trainers/me/…`. */
export const coachSubscriptionGuard = new Elysia({
  name: "coach-subscription-guard",
}).onBeforeHandle({ as: "scoped" }, (ctx) =>
  refuseWithoutCoachSubscription(ctx),
);
