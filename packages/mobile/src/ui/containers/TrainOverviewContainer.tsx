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

  const onRefresh = useCallback(() => {
    void refreshHome();
  }, [refreshHome]);

  const onOpenWorkout = useCallback(
    (workoutId: string) => {
      router.push(`/(app)/workouts/${workoutId}` as never);
    },
    [router],
  );

  return (
    <TrainOverviewPresenter
      activeProgramme={home.data?.activeProgramme ?? null}
      todaysTraining={home.data?.todaysTraining ?? []}
      isRefreshing={home.isRefreshing}
      onRefresh={onRefresh}
      onOpenWorkout={onOpenWorkout}
    />
  );
}
