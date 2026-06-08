import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetHome } from "@/ui/hooks/useGetHome";
import { useGetHabits } from "@/ui/hooks/useGetHabits";
import { useToggleHabitDay } from "@/ui/hooks/useToggleHabitDay";
import { useStaggeredEntry } from "@/ui/hooks/useStaggeredEntry";
import { useUserMode } from "@/state/user-mode";
import { useDrawer } from "@/state/drawer";
import { initialsOf } from "@/shared/utils";
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
 * Follow-ups (flagged): user display name (needs profile join), the weigh-in
 * sheet mount (06.9), and the workout-carousel data (useGetMyWorkouts).
 */
export function HomeContainer() {
  const router = useRouter();
  const { session } = useAuth();
  const openDrawer = useDrawer((s) => s.openDrawer);
  const mode = useUserMode((s) => s.mode);

  const home = useGetHome();
  const habitsState = useGetHabits();
  const toggle = useToggleHabitDay();
  const [weighInOpen, setWeighInOpen] = useState(false);

  const weekDates = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return Array.from({ length: 7 }, (_, i) => addDaysISO(today, i - 6));
  }, []);

  const user = useMemo(
    () => ({
      name: null as string | null,
      initials: initialsOf(session?.email ?? "") || "?",
    }),
    [session?.email],
  );

  // Per-section staggered entry (hero, habits, quicklog, volume, prs, coach).
  const s0 = useStaggeredEntry(0);
  const s1 = useStaggeredEntry(1);
  const s2 = useStaggeredEntry(2);
  const s3 = useStaggeredEntry(3);
  const s4 = useStaggeredEntry(4);
  const s5 = useStaggeredEntry(5);
  const animationStyles = useMemo(
    () => [s0, s1, s2, s3, s4, s5],
    [s0, s1, s2, s3, s4, s5],
  );

  const onRefresh = useCallback(() => {
    void Promise.all([home.refresh(), habitsState.refresh()]);
  }, [home, habitsState]);

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

  const noop = useCallback(() => {}, []);
  const openWeighIn = useCallback(() => setWeighInOpen(true), []);
  const closeWeighIn = useCallback(() => setWeighInOpen(false), []);

  return (
    <>
      <HomePresenter
        user={user}
        home={home.data}
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
