import { router } from "expo-router";
import { useCallback } from "react";
import type { Href } from "expo-router";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";

/**
 * The workout-creation cap, checked at PRESS time, for every create entry
 * point that isn't the workouts list.
 *
 * `WorkoutsListContainer` already gates its own Create: it holds
 * `useWorkouts().mine.quota` for the list it renders, so it can disable the
 * button and show the upgrade banner reactively. The coach surfaces —
 * `CoachLibraryHubContainer`'s contextual action and
 * `CoachWorkoutLibraryContainer`'s Create — pushed
 * `/(app)/workouts/create?ctx=coach` with no check at all, so a capped user
 * reached the creator, wrote a workout, and only found out when the POST came
 * back 402 (or, before the sync drain learned to reconcile, never found out at
 * all — the row just sat there counting against them). Those creates count
 * server-side exactly like any other: `assertEntitlement` compares
 * `COUNT(*) WHERE created_by = userId` against the tier's limit and does not
 * care which screen the request came from.
 *
 * Read at press time rather than subscribed on render, deliberately. The
 * obvious composition — reuse `useWorkoutTotalCapGate`, which already joins
 * the subscription to the quota — drags `useWorkouts()` into both coach
 * containers, and that hook fires a three-slice list refresh plus a sync-queue
 * flush on mount when its cache is stale. `CoachLibraryHubContainer` mounts
 * whenever the coach opens the Library hub, so that is precisely the
 * always-mounted-hook fan-out PR #341 went and removed. The cached `mine`
 * quota carries BOTH `used` and `limit` straight from the server's list
 * envelope, so a synchronous read answers the question with no query mounted
 * and no re-render churn.
 *
 * Fails OPEN when the quota has never been cached (a cold or offline first
 * run, or before the `mine` slice has loaded once). That matches
 * `useWorkoutTotalCapGate`'s documented stance on an unresolved read: an
 * unknown count must not paywall a paying user, and the server's 402 is the
 * backstop — one the drain now cleans up after, rather than leaving a phantom
 * behind.
 */
export type WorkoutCreateCapGate = {
  /**
   * Route to the paywall when the cap is already reached, and report whether
   * it did. Call it as the first statement of a create handler:
   * `if (capGate.blockIfAtLimit()) return;`
   */
  readonly blockIfAtLimit: () => boolean;
};

export function useWorkoutCreateCapGate(): WorkoutCreateCapGate {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const blockIfAtLimit = useCallback(() => {
    if (userId === null) return false;

    const quota = storage.getCachedWorkoutsList(userId, "mine")?.quota ?? null;
    // `limit === null` is an explicitly unlimited tier (premium, premium_plus,
    // the coach ladder) — never blocked. `>=` and not `>`: this gate mirrors
    // the CREATE check (`assertEntitlement`), which denies AT the cap, not the
    // over-limit RECORD lock (`evaluateWorkoutTotalCapLock`), which denies
    // strictly over it.
    if (quota === null || quota.limit === null) return false;
    if (quota.used < quota.limit) return false;

    // BARE route, deliberately — no `?tier=…&cycle=…`. `useWorkoutTotalCapGate`
    // and the feature gates pre-select a tier, but they can: they hold the
    // subscription, so they know which LADDER the user is on. This gate reads
    // only the cached quota, and both its call sites are COACH surfaces — so
    // pre-selecting the consumer default `premium` would do the precise harm
    // `pickUpgradeTier` exists to prevent (a coach who pays and lands on a plan
    // that strips their coaching role). An unselected list lets the selection
    // screen resolve the right ladder itself. This also matches
    // `WorkoutsListContainer.onUpgrade`, the create gate this one mirrors,
    // which pushes the same bare route.
    router.push("/(auth)/subscription-selection" as Href);
    return true;
  }, [storage, userId]);

  return { blockIfAtLimit };
}
