import { RefreshControl, ScrollView } from "react-native";
import Animated from "react-native-reanimated";
import { Text, View } from "@tamagui/core";
import { Avatar, HeaderBar, Pill } from "@/ui/components/foundation";
import { Section } from "@/ui/components/composite";
import { ErrorState, PLogoDrawLoader } from "@/ui/components";
import type { ApiError } from "@/shared/errors";
import type { HomePayload } from "@/domain/models/progress";
import type { PersonalRecord } from "@/domain/models/record";
import { TodayHeroPresenter } from "./TodayHeroPresenter";
import { HabitsGridPresenter, type HabitVM } from "./HabitsGridPresenter";
import { QuickLogStripPresenter } from "./QuickLogStripPresenter";
import { WeeklyVolumePresenter } from "./WeeklyVolumePresenter";
import { PRCarouselPresenter } from "./PRCarouselPresenter";
import { CoachQuickPeekPresenter } from "./CoachQuickPeekPresenter";

/**
 * <HomePresenter> — V2 Home re-skin (06-progress-goals, STORY-001/002;
 * home.jsx:21–63). Status-first dashboard: TodayHero rings → habits grid →
 * quick-log strip → weekly volume → recent-PR carousel → optional
 * CoachQuickPeek. Pure presentational; the container wires the hooks.
 *
 * Cache-first: renders whatever `home` is present immediately; a background
 * refresh updates in place. Blocking loader/error only when there's no cache.
 *
 * (Replaces the M1 Greeting/Goals/Workouts/Progress/Activity composition per
 * the migration re-skin. The workout carousel data (useGetMyWorkouts) is wired
 * in a follow-up — the aggregate's todayWorkout slot is reserved.)
 */

export type HomePresenterProps = {
  user: { name: string | null; initials: string };
  home: HomePayload | null;
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
    home,
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
        title={user.name ? `Hi, ${user.name}` : "Home"}
        leading={<Avatar initials={user.initials} onPress={onOpenDrawer} />}
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

        <Animated.View style={style(1)} testID="home-habits">
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

        <Animated.View style={style(2)} testID="home-quicklog">
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
          <Animated.View style={style(3)} testID="home-volume">
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

        {recentPRs.length > 0 && (
          <Animated.View style={style(4)} testID="home-prs">
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
              <PRCarouselPresenter prs={recentPRs} />
            </Section>
          </Animated.View>
        )}

        {showCoachPeek && coachPeek && (
          <Animated.View style={style(5)} testID="home-coach-peek">
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
