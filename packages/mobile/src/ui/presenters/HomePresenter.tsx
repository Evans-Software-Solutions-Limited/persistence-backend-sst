import { type RefObject } from "react";
import { RefreshControl, ScrollView } from "react-native";
import Animated from "react-native-reanimated";
import { Text, View } from "@tamagui/core";
import {
  Avatar,
  Card,
  HeaderBar,
  IconBtn,
  Pill,
} from "@/ui/components/foundation";
import { ProgrammeCard, Section } from "@/ui/components/composite";
import { ErrorState, PLogoDrawLoader } from "@/ui/components";
import { IconBell, IconChevronR } from "@/ui/components/icons";
import type { ApiError } from "@/shared/errors";
import type {
  ActiveProgramme,
  HomePayload,
  TodaysTrainingItem,
} from "@/domain/models/progress";
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
  /**
   * The athlete's live programme for the "Your programme" card (19-programs
   * STORY-005). Null/absent → the card is hidden. Rendered above the workouts.
   */
  activeProgramme?: ActiveProgramme | null;
  /**
   * Schedule-aware assigned occurrences (due-ordered, plan-visible) for the
   * "Today's training" section. Empty/absent → the section is hidden.
   */
  todaysTraining?: TodaysTrainingItem[];
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
  /** Unread-notification count for the header bell badge. 0/undefined hides it. */
  notificationCount?: number;
  onOpenWorkout: (workoutId: string) => void;
  /** Open the Train tab pinned to the Workouts segment (workouts "View all"). */
  onOpenWorkoutsList: () => void;
  onOpenTab: (tab: "train" | "fuel" | "you") => void;
  onOpenWeighIn: () => void;
  onOpenMealLog: () => void;
  onLogWater: () => void;
  onToggleHabitDay: (
    goalId: string,
    day: string,
    done: boolean,
    value?: number | null,
  ) => void;
  /** Open the habit-setup screen (18-habit-setup STORY-007). */
  onManageHabits: () => void;
  /** Calories grid row (non-toggleable) → deep-links to Fuel instead. */
  onOpenCaloriesFromGrid: () => void;
  onOpenCoach: () => void;
  /** Forwarded by the container for tab-press scroll-to-top. */
  scrollRef?: RefObject<ScrollView | null>;
  /** Injected today (YYYY-MM-DD) for deterministic due-label tests. */
  todayISO?: string;
};

/**
 * Trainer attribution for a "Today's training" row — mirrors the assigned-
 * workout badge copy used elsewhere (specs/19-programs 5.2 / cross-cuts § 1.5).
 */
function attributionLabel(
  assignedByType: TodaysTrainingItem["assignedByType"],
): string | null {
  if (assignedByType === "personal_trainer") return "Set by coach";
  if (assignedByType === "physiotherapist") return "From physio";
  return null;
}

/** Short due label: Today / Overdue / the ISO date. Null due → no label. */
function dueLabel(dueDate: string | null, todayISO: string): string | null {
  if (!dueDate) return null;
  if (dueDate === todayISO) return "Today";
  if (dueDate < todayISO) return "Overdue";
  return dueDate;
}

export function HomePresenter(props: HomePresenterProps) {
  const {
    user,
    greeting,
    home,
    activeProgramme = null,
    todaysTraining = [],
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
    notificationCount,
    onOpenWorkout,
    onOpenWorkoutsList,
    onOpenTab,
    onOpenWeighIn,
    onOpenMealLog,
    onLogWater,
    onToggleHabitDay,
    onManageHabits,
    onOpenCaloriesFromGrid,
    onOpenCoach,
    scrollRef,
    todayISO = new Date().toISOString().slice(0, 10),
  } = props;

  const style = (i: number) => animationStyles[i] ?? {};

  if (isLoading && !home) {
    return (
      <View
        flex={1}
        alignItems="center"
        justifyContent="center"
        testID="home-loader"
      >
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
      ref={scrollRef}
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
            badgeCount={notificationCount}
            accessibilityLabel="Notifications"
            testID="home-bell"
          />
        }
      />

      <View paddingHorizontal={16} gap={16}>
        {home && (
          <Animated.View style={style(0)} testID="home-hero">
            <TodayHeroPresenter rings={home.rings} micro={home.micro} />
          </Animated.View>
        )}

        {/* "Your programme" card — hidden when the athlete has no live plan
            (specs/19-programs STORY-005 AC 5.1). Above the training section. */}
        {activeProgramme ? (
          <View testID="home-active-programme">
            <ProgrammeCard
              programName={activeProgramme.name}
              week={activeProgramme.week}
              totalWeeks={activeProgramme.totalWeeks}
              accent="primary"
              testID="home-programme-card"
            />
          </View>
        ) : null}

        {/* "Today's training" — schedule-aware assigned occurrences, due-order
            (specs/19-programs STORY-005 AC 5.2). Hidden when empty. */}
        {todaysTraining.length > 0 ? (
          <View testID="home-todays-training">
            <Section eyebrow="TODAY" title="Today's training">
              <View gap={8}>
                {todaysTraining.map((item) => {
                  const badge = attributionLabel(item.assignedByType);
                  const due = dueLabel(item.dueDate, todayISO);
                  const meta = [
                    item.estimatedDurationMinutes != null
                      ? `${item.estimatedDurationMinutes} min`
                      : null,
                    due,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <Card
                      key={item.assignmentId ?? item.workoutId}
                      pad={12}
                      radius={12}
                      onPress={() => onOpenWorkout(item.workoutId)}
                      testID={`todays-training-${item.workoutId}`}
                      accessibilityLabel={`Today's training: ${item.name ?? "Workout"}`}
                    >
                      <View flexDirection="row" alignItems="center" gap={12}>
                        <View flex={1} minWidth={0}>
                          <View
                            flexDirection="row"
                            alignItems="center"
                            gap={6}
                            marginBottom={meta ? 2 : 0}
                          >
                            <Text
                              fontFamily="$display"
                              fontWeight="600"
                              fontSize={14}
                              color="$text"
                              numberOfLines={1}
                            >
                              {item.name ?? "Workout"}
                            </Text>
                            {badge ? (
                              <Pill tone="trainer" size="xs">
                                {badge}
                              </Pill>
                            ) : null}
                          </View>
                          {meta ? (
                            <Text
                              fontFamily="$body"
                              fontSize={11}
                              color="$text3"
                            >
                              {meta}
                            </Text>
                          ) : null}
                        </View>
                        <IconChevronR size={14} color="#8A8A98" />
                      </View>
                    </Card>
                  );
                })}
              </View>
            </Section>
          </View>
        ) : null}

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
              onManageHabits={onManageHabits}
              onOpenNonToggleable={onOpenCaloriesFromGrid}
            />
          </Section>
        </Animated.View>

        <Animated.View style={style(3)} testID="home-quicklog">
          <Section eyebrow="LOG" title="Quick capture" hideHr>
            <QuickLogStripPresenter
              onWeighIn={onOpenWeighIn}
              onLogMeal={onOpenMealLog}
              onLogWater={onLogWater}
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
