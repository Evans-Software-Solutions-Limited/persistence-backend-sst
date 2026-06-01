import React from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import type {
  HealthPermissionStatus,
  HealthWeight,
} from "@/domain/ports/health.port";
import type { ApiError } from "@/shared/errors";
import { ErrorState, PLogoDrawLoader } from "@/ui/components";
import { GoalsSection, type Goal } from "@/ui/components/home/GoalsSection";
import { GreetingSection } from "@/ui/components/home/GreetingSection";
import { MyProgressSection } from "@/ui/components/home/MyProgressSection";
import { RecentActivitySection } from "@/ui/components/home/RecentActivitySection";
import { YourWorkoutsSection } from "@/ui/components/home/YourWorkoutsSection";
import type { WorkoutCardWorkout } from "@/ui/components/home/WorkoutCard";
import { Colors, Spacing, Typography } from "@/ui/theme/homeLegacyTheme";
import { colorPalette } from "@/ui/theme/tokens";

/**
 * Pure Home presenter. Receives the full view-model from
 * `HomeContainer`; renders nothing that needs hooks or context.
 *
 * Each section component was ported verbatim from the legacy app
 * (`persistence-mobile/components/home/*`). This presenter wires
 * them together in the same section order as the legacy HomePresenter:
 * Greeting → Goals → YourWorkouts → MyProgress → RecentActivity.
 *
 * Spec: specs/06-progress-goals/design.md § Dashboard mobile architecture
 *       (M1) > UI structure · requirements.md STORY-005 AC 5.1–5.12
 */

type SectionAnimationStyle = Parameters<typeof Animated.View>[0]["style"];

export type HomePresenterRecentActivity = {
  workout_session_id: string;
  workout_name: string;
  completed_at: string;
};

export type HomePresenterViewModel = {
  /**
   * The signed-in user's first name. `null` signals "not yet known"
   * — either the cache is empty or the API hasn't returned a profile.
   * The container surfaces an error / loader for the null case rather
   * than letting the presenter render a fallback string. Removing the
   * `"Lifter"` fallback closed the silent-API-failure bug Brad
   * flagged on PR #37.
   */
  userName: string | null;
  subscriptionTier: string | null;
  isFreeTier: boolean;
  /** Initials for the profile avatar that opens the ProfileDrawer (08). */
  avatarInitials: string;
  goals: readonly Goal[];
  workouts: readonly WorkoutCardWorkout[];
  currentUserId?: string;
  workoutsThisMonth: number;
  workoutsLastMonth: number;
  activeEnergy: number;
  basalEnergy: number;
  standTime: number;
  bodyWeight: number | null;
  bodyWeightUnit: "kg" | "lbs";
  bodyWeightHistory: { date: Date; value: number }[];
  bodyFat: number | null;
  bodyFatHistory: { date: Date; value: number }[];
  stepsToday: number;
  stepsHistory: { date: Date; steps: number }[];
  recentActivity: readonly HomePresenterRecentActivity[];
  latestBodyWeight: HealthWeight | null;
  healthIsAvailable: boolean;
  healthPermissionStatus: HealthPermissionStatus;
};

export type HomePresenterProps = {
  viewModel: HomePresenterViewModel;
  /** Five per-section animated styles; indices match section order. */
  animationStyles: readonly SectionAnimationStyle[];
  /**
   * Cold-start loading state — no cached payload yet + a background
   * refresh is in flight. Renders the custom P-logo loader full-screen
   * (matches the legacy app's first-open behaviour).
   */
  isLoading: boolean;
  /**
   * True once the load has been spinning long enough to deserve a
   * reassurance caption ("Taking longer than usual…"). The container
   * arms a 5-second timer when `isLoading` flips on; this prop fires
   * when it elapses. The 10-second adapter timeout follows shortly
   * after, at which point `error` takes over.
   */
  showSlowLoaderCaption?: boolean;
  /**
   * Last refresh error from `useDashboard`. The presenter routes by
   * cache state:
   * - cache empty + error → full-screen `ErrorState` with retry.
   * - cache present + error → inline banner above the scroll
   *   ("Couldn't refresh — showing cached data").
   * Both branches keep `onRefresh` available so the user can retry.
   *
   * Spec: specs/06-progress-goals/requirements.md STORY-005 AC 5.9
   */
  error?: ApiError | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  onUpgradePress: () => void;
  onManageSubscriptionPress?: () => void;
  onWorkoutPress: (workoutId: string) => void;
  onWorkoutStart: (workoutId: string) => void;
  onWorkoutEdit?: (workoutId: string) => void;
  onWorkoutDelete?: (workoutId: string) => void;
  onViewAllWorkoutsPress: () => void;
  onViewAllProgressPress: () => void;
  onConnectHealthPress: () => void;
  onActivityPress?: (sessionId: string) => void;
  /** Opens the ProfileDrawer from the greeting avatar (08-profile-settings). */
  onOpenProfileDrawer?: () => void;
};

/**
 * Plain-and-direct copy for refresh failures. Brand voice tuned with
 * Brad: trustworthy, no jargon, no apology cascade. The message is
 * tailored to the error code so the user gets a meaningful next step
 * (timeout = check connection; everything else = generic recovery).
 */
function describeError(error: ApiError): { title: string; message: string } {
  switch (error.code) {
    case "timeout":
      return {
        title: "Couldn't load your dashboard",
        message:
          "The request took too long. Check your connection and tap Retry.",
      };
    case "unauthorized":
      return {
        title: "Session expired",
        message: "Sign back in to continue. Tap Retry to try again first.",
      };
    case "network":
      return {
        title: "No connection",
        message:
          "We couldn't reach the server. Check your connection and tap Retry.",
      };
    default:
      return {
        title: "Couldn't load your dashboard",
        message:
          error.message ||
          "Something went wrong on our side. Tap Retry to try again.",
      };
  }
}

export function HomePresenter({
  viewModel,
  animationStyles,
  isLoading,
  showSlowLoaderCaption = false,
  error = null,
  isRefreshing,
  onRefresh,
  onUpgradePress,
  onManageSubscriptionPress,
  onWorkoutPress,
  onWorkoutStart,
  onWorkoutEdit,
  onWorkoutDelete,
  onViewAllWorkoutsPress,
  onViewAllProgressPress,
  onConnectHealthPress,
  onActivityPress,
  onOpenProfileDrawer,
}: HomePresenterProps) {
  if (isLoading) {
    return (
      <View
        style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
        testID="home-loader"
      >
        <PLogoDrawLoader />
        {showSlowLoaderCaption && (
          <Text style={loaderStyles.caption} testID="home-loader-caption">
            Taking longer than usual…
          </Text>
        )}
      </View>
    );
  }

  // Cache empty + refresh failed → blocking error. The presenter never
  // tries to render the section tree from a null userName because the
  // container has already collapsed both "no payload" and "payload but
  // null firstName" into this single error branch.
  if (error !== null && viewModel.userName === null) {
    const { title, message } = describeError(error);
    return (
      <View style={{ flex: 1 }} testID="home-error-blocking">
        <ErrorState
          title={title}
          message={message}
          onRetry={onRefresh}
          testID="home-error-state"
        />
      </View>
    );
  }

  const [
    greetingStyle,
    goalsStyle,
    workoutsStyle,
    progressStyle,
    activityStyle,
  ] = animationStyles;

  // Cache present + refresh failed → non-blocking inline banner above
  // the section tree. Modelled on M0's ExerciseListPresenter stale
  // strip so the muscle memory across screens is consistent. Stays
  // visible until the next successful refresh clears `error`.
  const showInlineErrorBanner = error !== null && viewModel.userName !== null;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 20,
          paddingBottom: 32,
          gap: 24,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={colorPalette.primary500}
            colors={[colorPalette.primary500]}
          />
        }
        testID="home-scroll"
      >
        {showInlineErrorBanner && (
          <View style={bannerStyles.container} testID="home-error-banner">
            <View style={bannerStyles.dot} />
            <Text style={bannerStyles.text}>
              {"Couldn't refresh — showing cached data. Pull to retry."}
            </Text>
          </View>
        )}
        <Animated.View style={greetingStyle}>
          <GreetingSection
            userName={viewModel.userName ?? ""}
            subscriptionTier={viewModel.subscriptionTier}
            isFreeTier={viewModel.isFreeTier}
            onUpgradePress={onUpgradePress}
            onManageSubscription={onManageSubscriptionPress}
            avatarInitials={viewModel.avatarInitials}
            onAvatarPress={onOpenProfileDrawer}
          />
        </Animated.View>

        <Animated.View style={goalsStyle}>
          <GoalsSection goals={[...viewModel.goals]} />
        </Animated.View>

        <Animated.View style={workoutsStyle}>
          <YourWorkoutsSection
            workouts={viewModel.workouts}
            currentUserId={viewModel.currentUserId}
            onWorkoutPress={onWorkoutPress}
            onWorkoutStart={onWorkoutStart}
            onWorkoutEdit={onWorkoutEdit}
            onWorkoutDelete={onWorkoutDelete}
            onViewAllPress={onViewAllWorkoutsPress}
          />
        </Animated.View>

        <Animated.View style={progressStyle}>
          <MyProgressSection
            workoutsThisMonth={viewModel.workoutsThisMonth}
            workoutsLastMonth={viewModel.workoutsLastMonth}
            activeEnergy={viewModel.activeEnergy}
            basalEnergy={viewModel.basalEnergy}
            standTime={viewModel.standTime}
            bodyWeight={viewModel.bodyWeight}
            bodyWeightUnit={viewModel.bodyWeightUnit}
            bodyWeightHistory={viewModel.bodyWeightHistory}
            bodyFat={viewModel.bodyFat}
            bodyFatHistory={viewModel.bodyFatHistory}
            stepsToday={viewModel.stepsToday}
            stepsHistory={viewModel.stepsHistory}
            healthIsAvailable={viewModel.healthIsAvailable}
            healthPermissionStatus={viewModel.healthPermissionStatus}
            latestBodyWeight={viewModel.latestBodyWeight}
            onConnectHealthPress={onConnectHealthPress}
            onViewAllPress={onViewAllProgressPress}
          />
        </Animated.View>

        <Animated.View style={activityStyle}>
          <RecentActivitySection
            activities={viewModel.recentActivity}
            onActivityPress={onActivityPress}
          />
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const loaderStyles = StyleSheet.create({
  caption: {
    ...Typography.caption,
    color: Colors.text.secondary,
    marginTop: Spacing.md,
  },
});

const bannerStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.warning.light,
    borderRadius: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.warning.DEFAULT,
  },
  text: {
    ...Typography.caption,
    color: Colors.text.primary,
    flex: 1,
  },
});
