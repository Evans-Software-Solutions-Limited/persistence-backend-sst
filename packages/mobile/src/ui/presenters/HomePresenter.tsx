import { RefreshControl, ScrollView } from "react-native";
import Animated from "react-native-reanimated";
import { View } from "@tamagui/core";
import type {
  DashboardActiveGoal,
  DashboardPROfTheWeek,
  DashboardProgress,
  DashboardRecentActivity,
  DashboardRecentWorkout,
  DashboardSubscription,
} from "@/domain/models/dashboard";
import type {
  HealthPermissionStatus,
  HealthWeight,
} from "@/domain/ports/health.port";
import { GoalsSection } from "@/ui/components/home/GoalsSection";
import { GreetingSection } from "@/ui/components/home/GreetingSection";
import { MyProgressSection } from "@/ui/components/home/MyProgressSection";
import { PROfTheWeekCard } from "@/ui/components/home/PROfTheWeekCard";
import { RecentActivitySection } from "@/ui/components/home/RecentActivitySection";
import { YourWorkoutsSection } from "@/ui/components/home/YourWorkoutsSection";
import { colorPalette } from "@/ui/theme/tokens";

/**
 * Pure Home presenter. Receives the full view-model from
 * `HomeContainer`; renders nothing that needs hooks or context.
 *
 * Section order follows the legacy app (AC 5.12):
 * Greeting → Goals → YourWorkouts → MyProgress → RecentActivity.
 * The optional PR-of-the-week card slots between MyProgress and
 * RecentActivity (AC 5.7).
 *
 * Spec: specs/06-progress-goals/design.md § Dashboard mobile architecture
 *       (M1) > UI structure · requirements.md STORY-005 AC 5.1–5.12
 */

type SectionAnimationStyle = Parameters<typeof Animated.View>[0]["style"];

export type HomePresenterViewModel = {
  firstName: string | null;
  subscription: DashboardSubscription;
  goals: readonly DashboardActiveGoal[];
  workouts: readonly DashboardRecentWorkout[];
  progress: DashboardProgress;
  latestMeasurement: {
    weightKg: number | null;
    bodyFatPercentage: number | null;
  } | null;
  prOfTheWeek: DashboardPROfTheWeek | null;
  recentActivity: readonly DashboardRecentActivity[];
  stepsToday: number | null;
  activeCaloriesToday: number | null;
  latestBodyWeight: HealthWeight | null;
  healthIsAvailable: boolean;
  healthPermissionStatus: HealthPermissionStatus;
  lastHealthReadAt: string | null;
};

export type HomePresenterProps = {
  viewModel: HomePresenterViewModel;
  /** Five per-section animated styles; indices match section order. */
  animationStyles: readonly SectionAnimationStyle[];
  isRefreshing: boolean;
  onRefresh: () => void;
  onUpgradePress: () => void;
  onManageSubscriptionPress?: () => void;
  onWorkoutPress: (workoutId: string) => void;
  onViewAllWorkoutsPress: () => void;
  onViewAllProgressPress: () => void;
  onConnectHealthPress: () => void;
  onActivityPress: (sessionId: string) => void;
  onPROfTheWeekPress?: () => void;
};

export function HomePresenter({
  viewModel,
  animationStyles,
  isRefreshing,
  onRefresh,
  onUpgradePress,
  onManageSubscriptionPress,
  onWorkoutPress,
  onViewAllWorkoutsPress,
  onViewAllProgressPress,
  onConnectHealthPress,
  onActivityPress,
  onPROfTheWeekPress,
}: HomePresenterProps) {
  const [
    greetingStyle,
    goalsStyle,
    workoutsStyle,
    progressStyle,
    activityStyle,
  ] = animationStyles;
  const subscriptionForBadge = {
    tierName: viewModel.subscription.tierName,
    isFreeTier: viewModel.subscription.isFreeTier,
    isTrainerTier: viewModel.subscription.isTrainerTier,
  };

  return (
    <View flex={1} backgroundColor="$background">
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 20,
          paddingBottom: 32,
          gap: 20,
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
            firstName={viewModel.firstName}
            subscription={subscriptionForBadge}
            onUpgradePress={onUpgradePress}
            onManagePress={onManageSubscriptionPress}
          />
        </Animated.View>

        <Animated.View style={goalsStyle}>
          <GoalsSection goals={viewModel.goals} />
        </Animated.View>

        <Animated.View style={workoutsStyle}>
          <YourWorkoutsSection
            workouts={viewModel.workouts}
            onWorkoutPress={onWorkoutPress}
            onViewAllPress={onViewAllWorkoutsPress}
          />
        </Animated.View>

        <Animated.View style={progressStyle}>
          <MyProgressSection
            progress={viewModel.progress}
            latestMeasurement={viewModel.latestMeasurement}
            stepsToday={viewModel.stepsToday}
            activeCaloriesToday={viewModel.activeCaloriesToday}
            latestBodyWeight={viewModel.latestBodyWeight}
            healthIsAvailable={viewModel.healthIsAvailable}
            healthPermissionStatus={viewModel.healthPermissionStatus}
            lastHealthReadAt={viewModel.lastHealthReadAt}
            onConnectHealthPress={onConnectHealthPress}
            onViewAllPress={onViewAllProgressPress}
          />
        </Animated.View>

        {viewModel.prOfTheWeek ? (
          <Animated.View style={progressStyle}>
            <PROfTheWeekCard
              pr={viewModel.prOfTheWeek}
              onPress={onPROfTheWeekPress}
            />
          </Animated.View>
        ) : null}

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
