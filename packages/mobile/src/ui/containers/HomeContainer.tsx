import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import type { Goal } from "@/ui/components/home/GoalsSection";
import type { WorkoutCardWorkout } from "@/ui/components/home/WorkoutCard";
import {
  HomePresenter,
  type HomePresenterRecentActivity,
  type HomePresenterViewModel,
} from "@/ui/presenters/HomePresenter";
import { useAuth } from "@/ui/hooks/useAuth";
import { useDashboard } from "@/ui/hooks/useDashboard";
import { useHealthData } from "@/ui/hooks/useHealthData";
import { useStableMockHistory } from "@/ui/hooks/useStableMockHistory";
import { useStaggeredEntry } from "@/ui/hooks/useStaggeredEntry";

/**
 * Home-tab container. Follows the 3-memo pipeline established in M0:
 *
 * 1. `cachedPayload` — sourced from `useDashboard`'s state (which itself
 *    memoises the storage read).
 * 2. `viewModel` — derives the legacy-shaped props each section
 *    presenter expects, from the cached payload + live `useHealthData`
 *    readings. Mock history arrays for body-weight / body-fat / steps
 *    mirror the legacy Home's `generateMockHistory` approach until the
 *    backend ships real history endpoints.
 * 3. `animationStyles` — five per-section staggered entry styles.
 *
 * Pull-to-refresh bypasses the TTL by calling both `dashboard.refresh`
 * and `health.refresh` in parallel (AC 5.10).
 *
 * Spec: specs/06-progress-goals/design.md § Dashboard mobile architecture
 *       (M1) > Container data pipeline · requirements.md STORY-005 AC 5.1–5.12
 */

/**
 * Pick the greeting display name. Returns `null` (not a string fallback)
 * when the cached profile lacks a first name — `null` is the signal for
 * the presenter that profile data hasn't materialised yet, which the
 * loading + error branches below interpret. The previous `"Lifter"`
 * fallback masked real API failures behind a polite-looking greeting;
 * Brad called this out explicitly during the PR #37 review.
 *
 * Spec: specs/06-progress-goals/requirements.md STORY-005 AC 5.9
 */
function deriveUserName(firstName: string | null | undefined): string | null {
  if (firstName && firstName.trim().length > 0) return firstName;
  return null;
}

/**
 * Delay between `isLoading` flipping true and the presenter showing the
 * "Taking longer than usual…" caption under the loader. Sits halfway
 * between an unnoticeable fetch and the 10s adapter-side timeout — long
 * enough that fast fetches never trip it, short enough that the user
 * gets a signal before the full timeout fires.
 */
export const HOME_LOADER_CAPTION_DELAY_MS = 5_000;

export function HomeContainer() {
  const router = useRouter();
  const { session } = useAuth();
  const dashboard = useDashboard();
  const health = useHealthData();

  // Memo #1: cachedPayload slice the view-model derives from.
  const cachedPayload = useMemo(() => dashboard.payload, [dashboard.payload]);

  // Body weight: prefer the backend measurement (always kg by
  // contract), fall back to the HealthKit sample with its own unit.
  // The unit label tracks whichever source supplied the value.
  // Lifted OUT of the view-model memo so the mock-history hooks
  // below can key on the stable value without the memo re-running
  // on every unrelated tick.
  const weightSource: { value: number; unit: "kg" | "lbs" } | null =
    cachedPayload?.latestMeasurement?.weightKg != null
      ? { value: cachedPayload.latestMeasurement.weightKg, unit: "kg" }
      : health.latestBodyWeight != null
        ? {
            value: health.latestBodyWeight.value,
            unit: health.latestBodyWeight.unit,
          }
        : null;
  const bodyWeight = weightSource?.value ?? null;
  const bodyWeightUnit = weightSource?.unit ?? "kg";
  const bodyFat = cachedPayload?.latestMeasurement?.bodyFatPercentage ?? null;

  // Stable mock-history references — regenerate only when the
  // underlying value changes, NOT on every unrelated view-model
  // re-compute. Math.random inside a useMemo factory would have
  // caused the tile graphs to jump on every health reading update.
  // See bugbot thread on PR #37.
  const bodyWeightHistory = useStableMockHistory(bodyWeight);
  const bodyFatHistory = useStableMockHistory(bodyFat);

  // Memo #2: presenter-shaped view-model. Recomputes when either the
  // cached payload or any health reading changes.
  const viewModel = useMemo<HomePresenterViewModel>(() => {
    const workouts: WorkoutCardWorkout[] = (
      cachedPayload?.recentWorkouts ?? []
    ).map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      estimated_duration_minutes: w.estimatedDurationMinutes,
      is_assigned: w.isAssigned,
      assigned_by_type: w.assignedByType,
      created_by: w.createdBy,
    }));

    const goals: Goal[] = (cachedPayload?.activeGoals ?? []).map((g) => ({
      id: g.id,
      title: g.title,
      current: g.current,
      target: g.target,
      unit: g.unit,
      icon: "flag",
    }));

    const recentActivity: HomePresenterRecentActivity[] = (
      cachedPayload?.recentActivity ?? []
    ).map((a) => ({
      workout_session_id: a.workoutSessionId,
      workout_name: a.workoutName,
      completed_at: a.completedAt,
    }));

    return {
      userName: deriveUserName(cachedPayload?.profile.firstName),
      subscriptionTier: cachedPayload?.subscription.tierName ?? null,
      isFreeTier: cachedPayload?.subscription.isFreeTier ?? true,
      goals,
      workouts,
      currentUserId: session?.userId,
      workoutsThisMonth: cachedPayload?.progress.workoutsThisMonth ?? 0,
      workoutsLastMonth: cachedPayload?.progress.workoutsLastMonth ?? 0,
      activeEnergy: health.activeCaloriesToday ?? 0,
      basalEnergy: 0,
      standTime: 0,
      bodyWeight,
      bodyWeightUnit,
      bodyWeightHistory,
      bodyFat,
      bodyFatHistory,
      stepsToday: health.stepsToday ?? 0,
      stepsHistory: health.stepsHistory.map((h) => ({
        date: new Date(h.date),
        steps: h.steps,
      })),
      recentActivity,
      latestBodyWeight: health.latestBodyWeight,
      healthIsAvailable: health.isAvailable,
      healthPermissionStatus: health.permissionStatus,
    };
  }, [
    cachedPayload,
    session?.userId,
    bodyWeight,
    bodyWeightUnit,
    bodyFat,
    bodyWeightHistory,
    bodyFatHistory,
    health.stepsToday,
    health.stepsHistory,
    health.activeCaloriesToday,
    health.latestBodyWeight,
    health.isAvailable,
    health.permissionStatus,
  ]);

  // Memo #3: per-section animation styles. One `useStaggeredEntry` per
  // section index so the hook call order stays stable across renders.
  const greetingStyle = useStaggeredEntry(0);
  const goalsStyle = useStaggeredEntry(1);
  const workoutsStyle = useStaggeredEntry(2);
  const progressStyle = useStaggeredEntry(3);
  const activityStyle = useStaggeredEntry(4);

  const animationStyles = useMemo(
    () => [
      greetingStyle,
      goalsStyle,
      workoutsStyle,
      progressStyle,
      activityStyle,
    ],
    [greetingStyle, goalsStyle, workoutsStyle, progressStyle, activityStyle],
  );

  // Depend on the stable useCallback-wrapped methods directly, not the
  // whole hook-return objects. useDashboard() and useHealthData() build
  // their return value as a plain inline object each render, so those
  // references would churn the memoization.
  const dashboardRefresh = dashboard.refresh;
  const healthRefresh = health.refresh;
  const onRefresh = useCallback(() => {
    void Promise.all([dashboardRefresh(), healthRefresh()]);
  }, [dashboardRefresh, healthRefresh]);

  // Re-fetch the dashboard whenever the home tab regains focus.
  // Mutations from the workouts tab (create / edit / delete) call
  // `storage.invalidateDashboard(userId)`, but the cache delete
  // doesn't propagate to React state — the home hook still has
  // the old payload until something pulls fresh data. The hook's
  // `inFlightRef` dedupes if a refresh is already in flight, so
  // cost is at most one GET /dashboard per focus.
  useFocusEffect(
    useCallback(() => {
      void dashboardRefresh();
    }, [dashboardRefresh]),
  );

  const onUpgradePress = useCallback(() => {
    Alert.alert(
      "Upgrade coming soon",
      "Subscription management lights up in a later milestone.",
    );
  }, []);

  const onManageSubscriptionPress = useCallback(() => {
    Alert.alert(
      "Manage subscription",
      "Subscription management lights up in a later milestone.",
    );
  }, []);

  // Deeplink the workouts tab with `?workoutId=X` so its container's
  // useLocalSearchParams handler auto-opens the matching popover.
  // Without the param, tapping a card on home dropped the user onto
  // the workouts tab with nothing focused — looked broken.
  const onWorkoutPress = useCallback(
    (workoutId: string) => {
      router.push(`/(app)/(tabs)/workouts?workoutId=${workoutId}` as never);
    },
    [router],
  );

  // Start CTA (M3 owns the active-session screen). For now, deeplink
  // the workouts tab to that specific workout's popover so the user
  // can pick their start path from there. M3 will replace this.
  const onWorkoutStart = useCallback(
    (workoutId: string) => {
      router.push(`/(app)/(tabs)/workouts?workoutId=${workoutId}` as never);
    },
    [router],
  );

  const onViewAllWorkoutsPress = useCallback(() => {
    router.push("/(app)/(tabs)/workouts");
  }, [router]);

  const onViewAllProgressPress = useCallback(() => {
    router.push("/(app)/(tabs)/progress");
  }, [router]);

  const healthRequestPermissions = health.requestPermissions;
  const onConnectHealthPress = useCallback(() => {
    // M1 non-goal: `/health-permissions` screen. Route is a placeholder
    // until Phase 4 of the health spec ships.
    void healthRequestPermissions();
  }, [healthRequestPermissions]);

  const onActivityPress = useCallback(
    (_sessionId: string) => {
      router.push("/(app)/(tabs)/workouts");
    },
    [router],
  );

  // Per Brad's review: a successful payload that comes back with a
  // null profile.firstName is a contract violation (every signed-in
  // user has a profile row). His preferred UX is "stay in loading
  // state until the profile resolves; only show an error if it stays
  // null after a retry." We honour that with a single auto-retry:
  // when we observe a null firstName from a settled refresh, we fire
  // one more refresh in the background. Until that retry resolves,
  // the user keeps seeing the loader rather than a flash of error.
  // If it STILL comes back null afterwards, we surface the full-
  // screen error. PR #38 review captured this directly:
  // > "There shouldn't be an error, the data should be there, so the
  // > error shouldn't be shown, it should have the loading state
  // > until the profile is found and if it isnt its something wrong
  // > with our current api implementation."
  const profileIncomplete =
    cachedPayload !== null && cachedPayload.profile.firstName === null;

  const profileRetryAttemptedRef = useRef(false);
  const dashboardIsRefreshing = dashboard.isRefreshing;
  useEffect(() => {
    // Reset the guard whenever a successful refresh restores the
    // first name. Otherwise a flaky API that briefly returned null
    // would burn the one-shot and never auto-retry on the NEXT app
    // open.
    if (!profileIncomplete) {
      profileRetryAttemptedRef.current = false;
      return;
    }
    if (dashboardIsRefreshing) return;
    if (profileRetryAttemptedRef.current) return;
    profileRetryAttemptedRef.current = true;
    void dashboardRefresh();
  }, [profileIncomplete, dashboardIsRefreshing, dashboardRefresh]);

  // Cold-start: no cached payload yet AND a background refresh is in
  // flight. Also: a payload landed but profile.firstName is still null
  // and we haven't yet given the auto-retry a chance to resolve. In
  // both cases we keep the P-logo loader full-screen rather than
  // flashing the section tree (or the error state) prematurely.
  const profileRetryPending =
    profileIncomplete &&
    (dashboardIsRefreshing || !profileRetryAttemptedRef.current);
  const isLoading =
    (cachedPayload === null && dashboardIsRefreshing) || profileRetryPending;

  // Surface refresh failures with the right severity:
  // - cache empty + error → blocking full-screen error ("we couldn't
  //   load your dashboard"). Includes the profile-incomplete case
  //   above, which is synthesised as an api/server error so the
  //   presenter doesn't need a separate prop.
  // - cache present + error → non-blocking inline banner ("couldn't
  //   refresh — showing cached data"), modelled on M0's
  //   ExerciseListPresenter stale strip. The banner addresses Brad's
  //   "Spotify-like working-offline indicator" ask without pulling in
  //   a full NetInfo dependency this round; the timeout code is the
  //   strongest signal we have for "no connectivity right now".
  //
  // The synthesised profile error is held back while
  // `profileRetryPending` is true: we'd rather sit on the loader for
  // an extra round-trip than flash a "your profile didn't load" error
  // that immediately disappears once the retry returns a real name.
  const dashboardError = dashboard.error;
  const syntheticProfileError = useMemo(() => {
    if (!profileIncomplete) return null;
    if (profileRetryPending) return null;
    return {
      kind: "api" as const,
      code: "server" as const,
      message:
        "Your profile didn't load. This usually clears on retry — if it doesn't, check back shortly.",
    };
  }, [profileIncomplete, profileRetryPending]);
  const effectiveError = dashboardError ?? syntheticProfileError;

  // 5-second loader caption — kicks in for slow fetches before the
  // 10s adapter timeout fires. Cleared when isLoading flips off or
  // the component unmounts; never keeps a stale handle around.
  const [showSlowLoaderCaption, setShowSlowLoaderCaption] = useState(false);
  useEffect(() => {
    if (!isLoading) {
      setShowSlowLoaderCaption(false);
      return;
    }
    const handle = setTimeout(
      () => setShowSlowLoaderCaption(true),
      HOME_LOADER_CAPTION_DELAY_MS,
    );
    return () => clearTimeout(handle);
  }, [isLoading]);

  return (
    <HomePresenter
      viewModel={viewModel}
      animationStyles={animationStyles}
      isLoading={isLoading}
      showSlowLoaderCaption={showSlowLoaderCaption}
      error={effectiveError}
      isRefreshing={dashboard.isRefreshing || health.isReading}
      onRefresh={onRefresh}
      onUpgradePress={onUpgradePress}
      onManageSubscriptionPress={onManageSubscriptionPress}
      onWorkoutPress={onWorkoutPress}
      onWorkoutStart={onWorkoutStart}
      onViewAllWorkoutsPress={onViewAllWorkoutsPress}
      onViewAllProgressPress={onViewAllProgressPress}
      onConnectHealthPress={onConnectHealthPress}
      onActivityPress={onActivityPress}
    />
  );
}
