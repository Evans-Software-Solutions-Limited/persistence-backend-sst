import { useCallback, useMemo } from "react";
import { router, type Href } from "expo-router";
import type { BillingCycle } from "@/domain/models/subscription";
import { useMySubscription } from "@/ui/hooks/useMySubscription";
import { useTrainSegment } from "@/ui/hooks/useTrainSegment";
import { useWorkouts } from "@/ui/hooks/useWorkouts";

/**
 * useWorkoutTotalCapGate — client-side verdict for the free-tier "3
 * workouts TOTAL, over-limit lock" product decision (Brad, locked).
 *
 * Mirrors the `useLoadoutGate` / `useFeatureGate` division of labour: this
 * is a CLIENT verdict computed off already-cached data so the start-workout
 * entry points can route to the resolution screen instead of the session
 * route BEFORE ever hitting the network. The server's
 * `evaluateWorkoutTotalCapLock` (`POST /sessions/record` 402 with reason
 * `'workout_limit_exceeded'`) is the authoritative backstop for when this
 * client verdict is stale (second device, a workout deleted server-side but
 * not yet re-synced locally, direct API use) — see
 * `useWorkoutTotalCapGate`'s sibling handling in `SyncBlockedBannerMount`.
 *
 * Data sources (per the brief: "get the count/limit from the existing quota
 * source"):
 *   - COUNT: `useWorkouts().mine.quota.used` — the same
 *     `COUNT(*) FROM workouts WHERE created_by = userId` the backend's
 *     `workoutRepository.getQuota()` and `evaluateWorkoutTotalCapLock` both
 *     read. This is a TOTAL, never a monthly figure.
 *   - LIMIT: `useMySubscription().data.workoutLimit`, NOT
 *     `useWorkouts().mine.quota.limit`. `getQuota()`'s own `limit` field is
 *     resolved via an INNER JOIN on a LIVE `user_subscriptions` row
 *     (`payment_status IN ('active','pending')`) — but a genuinely free user
 *     has NO `user_subscriptions` row at all (only paid tiers get one; see
 *     `004_subscriptions_and_roles.sql`'s `setup_subscription`), so that join
 *     matches nothing and `quota.limit` reads `null` (unlimited) for every
 *     organic free user. `/subscriptions/me` (`subscriptionRepository
 *     .findForUser`) doesn't have that gap — it SYNTHESISES the free tier's
 *     shape (including `workoutLimit`) whenever there's no live sub row, and
 *     the same synthesis fires for a lapsed/cancelled/expired sub once its
 *     grace period ends. So `subscription.tierName === "free"` already
 *     means "effectively free, including reverted" — no separate
 *     `paymentStatus`/`expiresAt` grace-period check is needed here (unlike
 *     `useFeatureGate`/`useLoadoutGate`, which gate flags the backend
 *     doesn't collapse this way).
 *
 * Denies (is over-limit) ONLY when STRICTLY over — `used > limit`, not
 * `>=`. A user sitting at exactly the limit is not locked out (mirrors the
 * server's `evaluateWorkoutTotalCapLock`).
 */

export type WorkoutTotalCapGate = {
  /** True when the user is over the free total and should be routed to the resolution screen instead of starting a session. */
  readonly isOverLimit: boolean;
  /** False only while the subscription query hasn't resolved at least once. An errored query counts as resolved (falls through to "not over limit" — the server 402 backstop covers a stale/wrong read). */
  readonly isResolved: boolean;
  /** Current TOTAL workout count (`useWorkouts().mine.quota.used`). */
  readonly used: number;
  /** Free tier's workout limit, or null if unresolved/unlimited. */
  readonly limit: number | null;
  /** Push the resolution screen. */
  readonly onLocked: () => void;
  /** Navigate to the Train hub's Workouts segment (to delete a workout). */
  readonly onGoToWorkouts: () => void;
  /** Push the paywall (Premium pre-selected). */
  readonly onUpgrade: () => void;
};

/**
 * Pure verdict, exported for unit testing without the React Query /
 * useWorkouts wrapping.
 */
export function computeWorkoutTotalCapVerdict(
  tierName: string | null,
  used: number,
  limit: number | null,
): boolean {
  if (tierName !== "free") return false;
  if (limit === null) return false;
  return used > limit;
}

export function useWorkoutTotalCapGate(): WorkoutTotalCapGate {
  const subQuery = useMySubscription();
  const workouts = useWorkouts();

  const subscription = subQuery.data ?? null;
  const isResolved = subscription !== null || subQuery.isError;
  const used = workouts.mine.quota?.used ?? 0;
  const limit = subscription?.workoutLimit ?? null;
  const billingCycle: BillingCycle = subscription?.billingCycle ?? "monthly";

  const isOverLimit = useMemo(
    () =>
      computeWorkoutTotalCapVerdict(
        subscription?.tierName ?? null,
        used,
        limit,
      ),
    [subscription, used, limit],
  );

  const onLocked = useCallback(() => {
    router.push("/(app)/workout-limit-locked" as Href);
  }, []);

  // Same pattern as `HomeContainer.onOpenWorkoutsList` — pin the Train hub
  // to the Workouts segment before navigating so the user lands where they
  // can delete a workout, not wherever the hub last happened to be.
  const onGoToWorkouts = useCallback(() => {
    const train = useTrainSegment.getState();
    train.setPendingSegment("Workouts");
    train.setSegment("Workouts");
    router.push("/(app)/(tabs)/train" as Href);
  }, []);

  const onUpgrade = useCallback(() => {
    router.push(
      `/(auth)/subscription-selection?tier=premium&cycle=${billingCycle}` as Href,
    );
  }, [billingCycle]);

  return useMemo<WorkoutTotalCapGate>(
    () => ({
      isOverLimit,
      isResolved,
      used,
      limit,
      onLocked,
      onGoToWorkouts,
      onUpgrade,
    }),
    [isOverLimit, isResolved, used, limit, onLocked, onGoToWorkouts, onUpgrade],
  );
}
