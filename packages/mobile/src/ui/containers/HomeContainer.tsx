import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetHome } from "@/ui/hooks/useGetHome";
import { useGetHabits } from "@/ui/hooks/useGetHabits";
import { useToggleHabitDay } from "@/ui/hooks/useToggleHabitDay";
import { useWorkouts } from "@/ui/hooks/useWorkouts";
import { useStaggeredEntry } from "@/ui/hooks/useStaggeredEntry";
import { useUserMode } from "@/state/user-mode";
import { useDrawer } from "@/state/drawer";
import { initialsOf, localDayISO } from "@/shared/utils";
import { HomePresenter } from "@/ui/presenters/HomePresenter";
import { WeighInSheetContainer } from "@/ui/containers/WeighInSheetContainer";

function addDaysISO(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

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

  const home = useGetHome();
  const habitsState = useGetHabits();
  const toggle = useToggleHabitDay();
  const workoutsState = useWorkouts();
  const [weighInOpen, setWeighInOpen] = useState(false);

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
  const workoutsLoading =
    workoutsState.mine.isStale && workoutsState.mine.workouts.length === 0;

  const weekDates = useMemo(() => {
    const today = localDayISO();
    return Array.from({ length: 7 }, (_, i) => addDaysISO(today, i - 6));
  }, []);

  const user = useMemo(
    () => ({
      name: null as string | null,
      initials: initialsOf(session?.email ?? "") || "?",
    }),
    [session?.email],
  );

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

  const onRefresh = useCallback(() => {
    void Promise.all([
      home.refresh(),
      habitsState.refresh(),
      workoutsState.refresh(),
    ]);
  }, [home, habitsState, workoutsState]);

  const onOpenWorkout = useCallback(
    (workoutId: string) => {
      router.push(`/(app)/workouts/${workoutId}` as never);
    },
    [router],
  );

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

  return (
    <>
      <HomePresenter
        user={user}
        home={home.data}
        workouts={workoutItems}
        workoutsLoading={workoutsLoading}
        habits={habitsState.habits}
        weekDates={weekDates}
        recentPRs={home.data?.recentPRs ?? []}
        showCoachPeek={mode === "coach"}
        coachPeek={undefined}
        isLoading={home.isStale && home.data === null}
        isRefreshing={home.isRefreshing}
        error={home.error}
        animationStyles={animationStyles}
        onRefresh={onRefresh}
        onOpenDrawer={openDrawer}
        onOpenNotifications={onOpenNotifications}
        onOpenWorkout={onOpenWorkout}
        onOpenTab={onOpenTab}
        onOpenWeighIn={openWeighIn}
        onOpenMealLog={noop}
        onLogWater={noop}
        onLogMood={noop}
        onToggleHabitDay={onToggleHabitDay}
        onOpenCoach={noop}
      />
      <WeighInSheetContainer visible={weighInOpen} onClose={closeWeighIn} />
    </>
  );
}
