import React from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import Animated from "react-native-reanimated";
import type {
  HealthPermissionStatus,
  HealthWeight,
} from "@/domain/ports/health.port";
import { PLogoDrawLoader } from "@/ui/components";
import { GoalsSection, type Goal } from "@/ui/components/home/GoalsSection";
import { GreetingSection } from "@/ui/components/home/GreetingSection";
import { MyProgressSection } from "@/ui/components/home/MyProgressSection";
import { RecentActivitySection } from "@/ui/components/home/RecentActivitySection";
import { YourWorkoutsSection } from "@/ui/components/home/YourWorkoutsSection";
import type { WorkoutCardWorkout } from "@/ui/components/home/WorkoutCard";
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
  userName: string;
  subscriptionTier: string | null;
  isFreeTier: boolean;
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
};

export function HomePresenter({
  viewModel,
  animationStyles,
  isLoading,
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
}: HomePresenterProps) {
  if (isLoading) {
    return (
      <View
        style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
        testID="home-loader"
      >
        <PLogoDrawLoader />
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
        <Animated.View style={greetingStyle}>
          <GreetingSection
            userName={viewModel.userName}
            subscriptionTier={viewModel.subscriptionTier}
            isFreeTier={viewModel.isFreeTier}
            onUpgradePress={onUpgradePress}
            onManageSubscription={onManageSubscriptionPress}
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
