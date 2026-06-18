import { RefreshControl, ScrollView } from "react-native";
import Animated from "react-native-reanimated";
import { Text, View } from "@tamagui/core";
import { Avatar, HeaderBar, IconBtn, Pill } from "@/ui/components/foundation";
import { Section } from "@/ui/components/composite";
import { ErrorState, PLogoDrawLoader } from "@/ui/components";
import { IconBell } from "@/ui/components/icons";
import type { ApiError } from "@/shared/errors";
import type { HomePayload } from "@/domain/models/progress";
import type { PersonalRecord } from "@/domain/models/record";
import { TodayHeroPresenter } from "./TodayHeroPresenter";
import { HabitsGridPresenter, type HabitVM } from "./HabitsGridPresenter";
import { QuickLogStripPresenter } from "./QuickLogStripPresenter";
import { WeeklyVolumePresenter } from "./WeeklyVolumePresenter";
import { PRCarouselPresenter } from "./PRCarouselPresenter";
import { CoachQuickPeekPresenter } from "./CoachQuickPeekPresenter";
import {
  WorkoutCarouselPresenter,
  type WorkoutCarouselItem,
} from "./WorkoutCarouselPresenter";

/**
 * <HomePresenter> — V2 Home re-skin (06-progress-goals, STORY-001/002;
 * home.jsx:21–63). Status-first dashboard: TodayHero rings → workouts carousel
 * → habits grid → quick-log strip → weekly volume → recent-PR carousel →
 * optional CoachQuickPeek. Pure presentational; the container wires the hooks.
 *
 * Cache-first: renders whatever `home` is present immediately; a background
 * refresh updates in place. Blocking loader/error only when there's no cache.
 *
 * (Replaces the M1 Greeting/Goals/Workouts/Progress/Activity composition per
 * the migration re-skin.)
 */

export type HomePresenterProps = {
  user: { name: string | null; initials: string };
  /** Time-of-day greeting, e.g. "Good morning" (container-computed). */
  greeting: string;
  home: HomePayload | null;
  workouts: WorkoutCarouselItem[];
  workoutsLoading: boolean;
  habits: HabitVM[];
  weekDates: string[];
  recentPRs: PersonalRecord[];
  showCoachPeek: boolean;
  coachPeek?: { clientCount: number; needAttention: number; newPRs: number };

  isLoading: boolean;
  isRefreshing: boolean;
  error?: ApiError | null;
  /** Per-section staggered entry styles (container-computed). */
  animationStyles?: readonly object[];

  onRefresh: () => void;
  onOpenDrawer: () => void;
  onOpenNotifications: () => void;
  onOpenWorkout: (workoutId: string) => void;
  /** Open the Train tab pinned to the Workouts segment (workouts "View all"). */
  onOpenWorkoutsList: () => void;
  onOpenTab: (tab: "train" | "fuel" | "you") => void;
  onOpenWeighIn: () => void;
  onOpenMealLog: () => void;
  onLogWater: () => void;
  onLogMood: () => void;
  onToggleHabitDay: (goalId: string, day: string, done: boolean) => void;
  onOpenCoach: () => void;
};

export function HomePresenter(props: HomePresenterProps) {
  const {
    user,
    greeting,
    home,
    workouts,
    workoutsLoading,
    habits,
    weekDates,
    recentPRs,
    showCoachPeek,
    coachPeek,
    isLoading,
    isRefreshing,
    error,
    animationStyles = [],
    onRefresh,
    onOpenDrawer,
    onOpenNotifications,
    onOpenWorkout,
    onOpenWorkoutsList,
    onOpenTab,
    onOpenWeighIn,
    onOpenMealLog,
    onLogWater,
    onLogMood,
    onToggleHabitDay,
    onOpenCoach,
  } = props;

  const style = (i: number) => animationStyles[i] ?? {};

  if (isLoading && !home) {
    return (
      <View flex={1} testID="home-loader">
        <PLogoDrawLoader />
      </View>
    );
  }
  if (error && !home) {
    return (
      <View flex={1} testID="home-error-state">
        <ErrorState message="Couldn't load your home." onRetry={onRefresh} />
      </View>
    );
  }

  return (
    <ScrollView
      testID="home-scroll"
      contentContainerStyle={{ paddingBottom: 140 }}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
      }
    >
      <HeaderBar
        large
        eyebrow="TODAY"
        title={
          user.name ? (
            <>
              {`${greeting}, `}
              <Text color="$primary">{user.name}</Text>
            </>
          ) : (
            greeting
          )
        }
        leading={<Avatar initials={user.initials} onPress={onOpenDrawer} />}
        trailing={
          <IconBtn
            icon={<IconBell size={18} />}
            tone="ghost"
            onPress={onOpenNotifications}
            accessibilityLabel="Notifications"
            testID="home-bell"
          />
        }
      />

      <View paddingHorizontal={16} gap={16}>
        {home && (
          <Animated.View style={style(0)} testID="home-hero">
            <TodayHeroPresenter
              rings={home.rings}
              micro={home.micro}
              onOpenMove={() => onOpenTab("you")}
              onOpenTrain={() => onOpenTab("train")}
              onOpenFuel={() => onOpenTab("fuel")}
            />
          </Animated.View>
        )}

        <Animated.View style={style(1)} testID="home-workouts">
          <Section
            eyebrow="TODAY"
            title="Your workouts"
            action={
              <Text fontSize={12} color="$primary" onPress={onOpenWorkoutsList}>
                View all
              </Text>
            }
          >
            <WorkoutCarouselPresenter
              workouts={workouts}
              isLoading={workoutsLoading}
              onOpenWorkout={onOpenWorkout}
            />
          </Section>
        </Animated.View>

        <Animated.View style={style(2)} testID="home-habits">
          <Section
            eyebrow="STREAK"
            title="This week"
            action={
              <Pill tone="ember" size="xs">
                🔥 {home?.micro.streak ?? 0}
              </Pill>
            }
          >
            <HabitsGridPresenter
              habits={habits}
              weekDates={weekDates}
              onToggle={onToggleHabitDay}
            />
          </Section>
        </Animated.View>

        <Animated.View style={style(3)} testID="home-quicklog">
          <Section eyebrow="LOG" title="Quick capture" hideHr>
            <QuickLogStripPresenter
              onWeighIn={onOpenWeighIn}
              onLogMeal={onOpenMealLog}
              onLogWater={onLogWater}
              onLogMood={onLogMood}
            />
          </Section>
        </Animated.View>

        {home && (
          <Animated.View style={style(4)} testID="home-volume">
            <Section
              eyebrow="THIS WEEK"
              title="Volume"
              action={
                <Text
                  fontSize={12}
                  color="$primary"
                  onPress={() => onOpenTab("you")}
                >
                  Details
                </Text>
              }
            >
              <WeeklyVolumePresenter weeklyVolume={home.weeklyVolume} />
            </Section>
          </Animated.View>
        )}

        <Animated.View style={style(5)} testID="home-prs">
          <Section
            eyebrow="ACHIEVEMENTS"
            title="Recent PRs"
            action={
              <Text
                fontSize={12}
                color="$primary"
                onPress={() => onOpenTab("you")}
              >
                All
              </Text>
            }
          >
            {recentPRs.length > 0 ? (
              <PRCarouselPresenter prs={recentPRs} />
            ) : (
              <View
                paddingVertical={18}
                alignItems="center"
                testID="home-prs-empty"
              >
                <Text fontFamily="$body" fontSize={13} color="$text3">
                  No PRs yet — finish a session to set your first.
                </Text>
              </View>
            )}
          </Section>
        </Animated.View>

        {showCoachPeek && coachPeek && (
          <Animated.View style={style(6)} testID="home-coach-peek">
            <CoachQuickPeekPresenter
              clientCount={coachPeek.clientCount}
              needAttention={coachPeek.needAttention}
              newPRs={coachPeek.newPRs}
              onOpenCoach={onOpenCoach}
            />
          </Animated.View>
        )}
      </View>
    </ScrollView>
  );
}
