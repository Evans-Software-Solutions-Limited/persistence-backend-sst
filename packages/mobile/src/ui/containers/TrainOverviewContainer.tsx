import { useCallback, useMemo } from "react";
import { useRouter } from "expo-router";
import { useGetHome } from "@/ui/hooks/useGetHome";
import { useGetHabitConfig } from "@/ui/hooks/useGetHabitConfig";
import { useRefreshOnFocus } from "@/ui/hooks/useRefreshOnFocus";
import { TrainOverviewPresenter } from "@/ui/presenters/TrainOverviewPresenter";

/**
 * <TrainOverviewContainer> — the Train hub's "Training" segment (M16). Wires the
 * cache-first Home payload (active programme + today's training) into
 * <TrainOverviewPresenter>.
 *
 * Reuses `useGetHome` (both Home and Train read the same cached payload) rather
 * than a bespoke endpoint.
 *
 * Also surfaces the athlete's habit configs via `useGetHabitConfig` so the
 * Training tab acts as an informative "what should I aim for" sheet — showing
 * the targets/habits the coach has set alongside the training programme.
 */
export function TrainOverviewContainer() {
  const router = useRouter();

  const home = useGetHome();
  const refreshHome = home.refresh;
  const activeProgramme = home.data?.activeProgramme ?? null;

  const habitConfig = useGetHabitConfig();
  const enabledHabits = useMemo(
    () => habitConfig.configs.filter((c) => c.enabled),
    [habitConfig.configs],
  );

  const onRefresh = useCallback(() => {
    void refreshHome();
  }, [refreshHome]);

  // Kept-alive tab — refresh the active programme / today's training on
  // re-entry (skips the mount focus). Silent → no spinner flash.
  const onFocusRefresh = useCallback(() => {
    void refreshHome({ silent: true });
  }, [refreshHome]);
  useRefreshOnFocus(onFocusRefresh);

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
      habits={enabledHabits}
      isRefreshing={home.isRefreshing}
      onRefresh={onRefresh}
      onOpenWorkout={onOpenWorkout}
      onOpenProgramme={onOpenProgramme}
    />
  );
}
