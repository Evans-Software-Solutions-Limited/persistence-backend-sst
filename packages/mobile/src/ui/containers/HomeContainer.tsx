import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ScrollView } from "react-native";
import { useScrollToTopOnTabPress } from "@/ui/hooks/useScrollToTopOnTabPress";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetHome } from "@/ui/hooks/useGetHome";
import { useHealthData } from "@/ui/hooks/useHealthData";
import { useHealthSync } from "@/state/health-sync";
import { useGetHabits } from "@/ui/hooks/useGetHabits";
import { useToggleHabitDay } from "@/ui/hooks/useToggleHabitDay";
import { useWorkouts } from "@/ui/hooks/useWorkouts";
import { useTrainSegment } from "@/ui/hooks/useTrainSegment";
import { useStaggeredEntry } from "@/ui/hooks/useStaggeredEntry";
import { useUserMode } from "@/state/user-mode";
import { useDrawer } from "@/state/drawer";
import { initialsOf, timeGreeting } from "@/shared/utils";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { useFuelSheets } from "@/state/fuel-sheets";
import { HomePresenter } from "@/ui/presenters/HomePresenter";
import { WeighInSheetContainer } from "@/ui/containers/WeighInSheetContainer";
import { WaterLogSheetContainer } from "@/ui/containers/WaterLogSheetContainer";

/**
 * V2 Home container (06-progress-goals, STORY-001/002). Wires the cache-first
 * Home aggregate + habits grid + toggle into <HomePresenter>. Replaces the M1
 * dashboard wiring per the migration re-skin.
 *
 * Follow-ups (flagged): user display name (needs profile join). The weigh-in
 * sheet (06.9) and the workout carousel (`useWorkouts` → WorkoutCarousel) are
 * now wired.
 */
export function HomeContainer() {
  const router = useRouter();
  const { session } = useAuth();
  const openDrawer = useDrawer((s) => s.openDrawer);
  const mode = useUserMode((s) => s.mode);

  const scrollRef = useRef<ScrollView>(null);
  useScrollToTopOnTabPress(scrollRef);

  const home = useGetHome();
  const health = useHealthData();
  const habitsState = useGetHabits();
  const toggle = useToggleHabitDay();
  const workoutsState = useWorkouts();
  const profile = useProfilePage();
  const [weighInOpen, setWeighInOpen] = useState(false);
  const [waterOpen, setWaterOpen] = useState(false);
  const openQuickAdd = useFuelSheets((s) => s.openQuickAdd);

  // Map the user's own workouts → carousel items (home.jsx WorkoutCarousel).
  const workoutItems = useMemo(
    () =>
      workoutsState.mine.workouts.slice(0, 8).map((w) => ({
        id: w.id,
        title: w.name,
        mins: w.estimatedDurationMinutes,
        sub: w.description ?? "",
        chips: [] as string[],
      })),
    [workoutsState.mine.workouts],
  );
  // Loading posture: actively fetching, OR stale with no error yet (cold
  // start). Crucially NOT "stale && empty" — useWorkouts leaves `isStale: true`
  // when a fetch FAILS (it only clears on success), so that would spin the
  // carousel skeleton forever on a failing GET. Gating on `isRefreshing` /
  // `error` means a resolved fetch (success OR failure) falls back to the
  // empty state instead. (The presenter only shows the skeleton when also
  // empty, so a refresh with cached workouts still renders them.)
  const workoutsLoading =
    workoutsState.isRefreshing ||
    (workoutsState.mine.isStale && workoutsState.error === null);

  // Overlay HealthKit steps onto the MOVE ring. The backend derives `move`
  // from `daily_activity_data` (empty unless something writes steps), so the
  // device's HealthKit reading is the live source. When health steps aren't
  // available (not granted / simulator / Android stub) we keep the backend
  // value untouched. Recompute pct here; TodayHero recomputes the centre %
  // from the ring pcts, so the dial follows automatically.
  // Spec: 07-health-integration/design.md § "Values merge into the presenter
  // view-model beside the backend payload".
  const healthSteps = health.stepsToday;
  const homeData = useMemo(() => {
    const data = home.data;
    if (!data || healthSteps == null) return data;
    const move = data.rings.move;
    const target = move.target > 0 ? move.target : 10000;
    const pct = Math.min(1, Math.max(0, healthSteps / target));
    return {
      ...data,
      rings: { ...data.rings, move: { ...move, current: healthSteps, pct } },
    };
  }, [home.data, healthSteps]);

  // Re-read HealthKit on focus so the rings stay current. Two guards keep this
  // from defeating the hook's 5-min rate limit (AC 7.6):
  //   • The first focus (= mount) is skipped — useHealthData's own mount
  //     effect already does the initial read, so firing here too would double
  //     it (~16 native calls + racing setState pairs).
  //   • Ordinary tab returns use the rate-limited `read()`; only a focus that
  //     follows a fresh permission grant (signalled via useHealthSync.revision)
  //     forces the bypassing `refresh()`, so the just-connected rings light up
  //     immediately without otherwise burning the window on every return.
  const readHealth = health.read;
  const refreshHealth = health.refresh;
  const healthRevision = useHealthSync((s) => s.revision);
  const firstFocusRef = useRef(true);
  const seenHealthRevisionRef = useRef(healthRevision);
  useFocusEffect(
    useCallback(() => {
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
        return;
      }
      if (seenHealthRevisionRef.current !== healthRevision) {
        seenHealthRevisionRef.current = healthRevision;
        void refreshHealth();
      } else {
        void readHealth();
      }
    }, [healthRevision, readHealth, refreshHealth]),
  );

  // First name + initials from the cached profile (offline-first via
  // useProfilePage); null until it resolves, so the header shows just the
  // greeting meanwhile. Initials prefer the profile name (legacy parity) and
  // only fall back to the email until the profile lands.
  const fullName = profile.payload?.profile.fullName ?? null;
  const firstName = fullName?.trim().split(/\s+/)[0] ?? null;
  const user = useMemo(
    () => ({
      name: firstName,
      initials: initialsOf(fullName ?? session?.email ?? "") || "?",
    }),
    [firstName, fullName, session?.email],
  );
  const greeting = timeGreeting();

  // Per-section staggered entry (hero, workouts, habits, quicklog, volume,
  // prs, coach).
  const s0 = useStaggeredEntry(0);
  const s1 = useStaggeredEntry(1);
  const s2 = useStaggeredEntry(2);
  const s3 = useStaggeredEntry(3);
  const s4 = useStaggeredEntry(4);
  const s5 = useStaggeredEntry(5);
  const s6 = useStaggeredEntry(6);
  const animationStyles = useMemo(
    () => [s0, s1, s2, s3, s4, s5, s6],
    [s0, s1, s2, s3, s4, s5, s6],
  );

  // Pull out the stable refresh callbacks so onRefresh memoises on THOSE, not
  // the hook-result objects (fresh literals each render, which would defeat the
  // useCallback — bugbot regression on PR #37). exhaustive-deps can't see that
  // `home.refresh` is stable, so destructuring is what keeps it both correct
  // and lint-clean.
  const refreshHome = home.refresh;
  const refreshHabits = habitsState.refresh;
  const refreshWorkouts = workoutsState.refresh;
  const onRefresh = useCallback(() => {
    void Promise.all([refreshHome(), refreshHabits(), refreshWorkouts()]);
  }, [refreshHome, refreshHabits, refreshWorkouts]);

  const onOpenWorkout = useCallback(
    (workoutId: string) => {
      router.push(`/(app)/workouts/${workoutId}` as never);
    },
    [router],
  );

  // Workouts "View all" → Train tab, pinned to the Workouts segment. The Train
  // hub persists its last segment (useTrainSegment), so without forcing it the
  // tab can open on Exercises if that was last viewed. Set a one-shot
  // pendingSegment that the hub consumes in a focus effect AND write the
  // segment now: the immediate write covers a still-live hub, the pending
  // value re-asserts "Workouts" when react-native-screens has frozen the
  // backgrounded hub on its last-rendered (Exercises) frame. (Not a route
  // param — tab params are sticky and would fight a later manual toggle.)
  const onOpenWorkoutsList = useCallback(() => {
    const train = useTrainSegment.getState();
    train.setPendingSegment("Workouts");
    train.setSegment("Workouts");
    router.push("/(app)/(tabs)/train" as never);
  }, [router]);

  const onOpenTab = useCallback(
    (tab: "train" | "fuel" | "you") => {
      // `fuel` has no dedicated tab until M9 — route to train for now.
      const path = tab === "you" ? "you" : "train";
      router.push(`/(app)/(tabs)/${path}` as never);
    },
    [router],
  );

  const onToggleHabitDay = useCallback(
    (goalId: string, day: string, done: boolean) => {
      void toggle.mutate({ goalId, day, done });
    },
    [toggle],
  );

  // Home bell → notifications list (home.jsx HomeHeader; the 09.5-intended
  // entry point — the route docstring at app/(app)/notifications.tsx names the
  // Home bell as its pusher). Pushes over the tab bar.
  const onOpenNotifications = useCallback(() => {
    router.push("/(app)/notifications" as never);
  }, [router]);

  const noop = useCallback(() => {}, []);
  const openWeighIn = useCallback(() => setWeighInOpen(true), []);
  const closeWeighIn = useCallback(() => setWeighInOpen(false), []);

  // Quick-log: "Log meal" jumps to the Fuel tab and opens the add-food sheet;
  // "Water" opens the water-log sheet (logs to the M9 water log).
  const onOpenMealLog = useCallback(() => {
    router.push("/(app)/(tabs)/fuel" as never);
    openQuickAdd("breakfast");
  }, [router, openQuickAdd]);
  const openWater = useCallback(() => setWaterOpen(true), []);
  const closeWater = useCallback(() => setWaterOpen(false), []);

  return (
    <>
      <HomePresenter
        scrollRef={scrollRef}
        user={user}
        greeting={greeting}
        home={homeData}
        workouts={workoutItems}
        workoutsLoading={workoutsLoading}
        habits={habitsState.habits}
        weekDates={habitsState.weekDates}
        recentPRs={home.data?.recentPRs ?? []}
        showCoachPeek={mode === "coach"}
        coachPeek={undefined}
        isLoading={
          (home.isRefreshing || (home.isStale && home.error === null)) &&
          home.data === null
        }
        isRefreshing={home.isRefreshing}
        error={home.error}
        animationStyles={animationStyles}
        onRefresh={onRefresh}
        onOpenDrawer={openDrawer}
        onOpenNotifications={onOpenNotifications}
        onOpenWorkout={onOpenWorkout}
        onOpenWorkoutsList={onOpenWorkoutsList}
        onOpenTab={onOpenTab}
        onOpenWeighIn={openWeighIn}
        onOpenMealLog={onOpenMealLog}
        onLogWater={openWater}
        onLogMood={noop}
        onToggleHabitDay={onToggleHabitDay}
        onOpenCoach={noop}
      />
      <WeighInSheetContainer visible={weighInOpen} onClose={closeWeighIn} />
      <WaterLogSheetContainer visible={waterOpen} onClose={closeWater} />
    </>
  );
}
