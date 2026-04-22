import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { Alert } from "react-native";
import {
  HomePresenter,
  type HomePresenterViewModel,
} from "@/ui/presenters/HomePresenter";
import { useDashboard } from "@/ui/hooks/useDashboard";
import { useHealthData } from "@/ui/hooks/useHealthData";
import { useStaggeredEntry } from "@/ui/hooks/useStaggeredEntry";

/**
 * Home-tab container. Follows the 3-memo pipeline established in M0:
 *
 * 1. `cachedPayload` — sourced from `useDashboard`'s state (which itself
 *    memoises the storage read).
 * 2. `viewModel` — derives the presenter-shaped props from cached
 *    payload + live `useHealthData` readings.
 * 3. `animationStyles` — five per-section staggered entry styles, one
 *    per section.
 *
 * Pull-to-refresh bypasses the TTL by calling both `dashboard.refresh`
 * and `health.refresh` in parallel (AC 5.10).
 *
 * Spec: specs/06-progress-goals/design.md § Dashboard mobile architecture
 *       (M1) > Container data pipeline · requirements.md STORY-005 AC 5.1–5.12
 */

export function HomeContainer() {
  const router = useRouter();
  const dashboard = useDashboard();
  const health = useHealthData();

  // Memo #1: cachedPayload slice the view-model derives from.
  const cachedPayload = useMemo(() => dashboard.payload, [dashboard.payload]);

  // Memo #2: presenter-shaped view-model. Recomputes when either the
  // cached payload or any health reading changes.
  const viewModel = useMemo<HomePresenterViewModel>(() => {
    const fallbackProfile = {
      firstName: null as string | null,
    };
    const fallbackSubscription = {
      tierName: null as string | null,
      isFreeTier: true,
      isTrainerTier: false,
      status: null as "active" | "trialing" | "cancelled" | "past_due" | null,
    };
    const fallbackProgress = {
      workoutsThisMonth: 0,
      workoutsLastMonth: 0,
      streak: 0,
      personalRecordsCount: 0,
    };

    return {
      firstName: cachedPayload?.profile.firstName ?? fallbackProfile.firstName,
      subscription: cachedPayload?.subscription ?? fallbackSubscription,
      goals: cachedPayload?.activeGoals ?? [],
      workouts: cachedPayload?.recentWorkouts ?? [],
      progress: cachedPayload?.progress ?? fallbackProgress,
      latestMeasurement: cachedPayload?.latestMeasurement ?? null,
      prOfTheWeek: cachedPayload?.prOfTheWeek ?? null,
      recentActivity: cachedPayload?.recentActivity ?? [],
      stepsToday: health.stepsToday,
      activeCaloriesToday: health.activeCaloriesToday,
      latestBodyWeight: health.latestBodyWeight,
      healthIsAvailable: health.isAvailable,
      healthPermissionStatus: health.permissionStatus,
      lastHealthReadAt: health.lastReadAt,
    };
  }, [
    cachedPayload,
    health.stepsToday,
    health.activeCaloriesToday,
    health.latestBodyWeight,
    health.isAvailable,
    health.permissionStatus,
    health.lastReadAt,
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

  const onRefresh = useCallback(() => {
    void Promise.all([dashboard.refresh(), health.refresh()]);
  }, [dashboard, health]);

  const onUpgradePress = useCallback(() => {
    Alert.alert(
      "Upgrade coming soon",
      "Subscription management lights up in a later milestone.",
    );
  }, []);

  const onWorkoutPress = useCallback(
    (_workoutId: string) => {
      router.push("/(app)/(tabs)/workouts");
    },
    [router],
  );

  const onViewAllWorkoutsPress = useCallback(() => {
    router.push("/(app)/(tabs)/workouts");
  }, [router]);

  const onViewAllProgressPress = useCallback(() => {
    router.push("/(app)/(tabs)/progress");
  }, [router]);

  const onConnectHealthPress = useCallback(() => {
    // M1 non-goal: `/health-permissions` screen. Route is a placeholder
    // until Phase 4 of the health spec ships.
    void health.requestPermissions();
  }, [health]);

  const onActivityPress = useCallback(
    (_sessionId: string) => {
      router.push("/(app)/(tabs)/workouts");
    },
    [router],
  );

  return (
    <HomePresenter
      viewModel={viewModel}
      animationStyles={animationStyles}
      isRefreshing={dashboard.isRefreshing || health.isReading}
      onRefresh={onRefresh}
      onUpgradePress={onUpgradePress}
      onWorkoutPress={onWorkoutPress}
      onViewAllWorkoutsPress={onViewAllWorkoutsPress}
      onViewAllProgressPress={onViewAllProgressPress}
      onConnectHealthPress={onConnectHealthPress}
      onActivityPress={onActivityPress}
    />
  );
}
