import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useGetHome } from "@/ui/hooks/useGetHome";
import { TrainOverviewPresenter } from "@/ui/presenters/TrainOverviewPresenter";

/**
 * <TrainOverviewContainer> — the Train hub's "Training" segment (M16). Wires the
 * cache-first Home payload (active programme + today's training) into
 * <TrainOverviewPresenter>.
 *
 * Reuses `useGetHome` (both Home and Train read the same cached payload) rather
 * than a bespoke endpoint.
 *
 * NOTE: the athlete Goals surface was hidden for launch (goals were an inert,
 * half-shipped feature — decision C). The goal building blocks (GoalSheet,
 * GoalCard, useGoalSheet, goals.command) are parked for the future
 * "make goals real" spec.
 */
export function TrainOverviewContainer() {
  const router = useRouter();

  const home = useGetHome();
  const refreshHome = home.refresh;
  const activeProgramme = home.data?.activeProgramme ?? null;

  const onRefresh = useCallback(() => {
    void refreshHome();
  }, [refreshHome]);

  const onOpenWorkout = useCallback(
    (workoutId: string) => {
      router.push(`/(app)/workouts/${workoutId}` as never);
    },
    [router],
  );

  // Open the athlete programme view (read-only) — a programme is a
  // multi-workout plan, so the athlete can see everything in it and start any
  // workout. Routes to the athlete-scoped screen, NOT the coach editor.
  const programId = activeProgramme?.programId ?? null;
  const onOpenProgramme = useCallback(() => {
    if (!programId) return;
    router.push(`/(app)/programs/view/${programId}` as never);
  }, [router, programId]);

  return (
    <TrainOverviewPresenter
      activeProgramme={activeProgramme}
      todaysTraining={home.data?.todaysTraining ?? []}
      isRefreshing={home.isRefreshing}
      onRefresh={onRefresh}
      onOpenWorkout={onOpenWorkout}
      onOpenProgramme={onOpenProgramme}
    />
  );
}
