import { useCallback, useEffect, useMemo } from "react";
import { useRouter } from "expo-router";
import { useGetHome } from "@/ui/hooks/useGetHome";
import { useGetHabitConfig } from "@/ui/hooks/useGetHabitConfig";
import { useRefreshOnFocus } from "@/ui/hooks/useRefreshOnFocus";
import { TrainOverviewPresenter } from "@/ui/presenters/TrainOverviewPresenter";
import { useClientRelationships } from "@/ui/hooks/useClientRelationships";
import { isExperiencePolishEnabled } from "@/ui/state/experiencePolish";
import { useAdapters } from "@/ui/hooks/useAdapters";

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
  const experiencePolish = isExperiencePolishEnabled();
  const router = useRouter();
  const { api } = useAdapters();

  const home = useGetHome();
  const refreshHome = home.refresh;
  const activeProgramme = home.data?.activeProgramme ?? null;

  const habitConfig = useGetHabitConfig();
  const relationships = useClientRelationships("active", experiencePolish);
  const activeRelationship = relationships.data[0] ?? null;
  const assignment = experiencePolish
    ? (activeRelationship?.assignment ?? null)
    : null;
  const resolvedActiveProgramme = assignment
    ? assignment.activeProgramme
    : activeProgramme;
  const refreshRelationships = relationships.refresh;
  const enabledHabits = useMemo(
    () => (assignment?.habits ?? habitConfig.configs).filter((c) => c.enabled),
    [assignment?.habits, habitConfig.configs],
  );

  const onRefresh = useCallback(() => {
    void Promise.all([refreshHome(), refreshRelationships()]);
  }, [refreshHome, refreshRelationships]);

  // Kept-alive tab — refresh the active programme / today's training on
  // re-entry (skips the mount focus). Silent → no spinner flash.
  const onFocusRefresh = useCallback(() => {
    void Promise.all([
      refreshHome({ silent: true }),
      refreshRelationships({ silent: true }),
    ]);
  }, [refreshHome, refreshRelationships]);
  useRefreshOnFocus(onFocusRefresh);

  useEffect(() => {
    if (!experiencePolish) return;
    void api.trackAnalyticsEvent({ name: "coaching_overview_opened" });
  }, [api, experiencePolish]);

  const onOpenWorkout = useCallback(
    (workoutId: string) => {
      router.push(`/(app)/workouts/${workoutId}` as never);
    },
    [router],
  );

  // Open the athlete programme view (read-only) — a programme is a
  // multi-workout plan, so the athlete can see everything in it and start any
  // workout. Routes to the athlete-scoped screen, NOT the coach editor.
  const programId = resolvedActiveProgramme?.programId ?? null;
  const onOpenProgramme = useCallback(() => {
    if (!programId) return;
    router.push(`/(app)/programs/view/${programId}` as never);
  }, [router, programId]);

  return (
    <TrainOverviewPresenter
      activeProgramme={resolvedActiveProgramme}
      todaysTraining={
        assignment?.upcomingWorkouts ?? home.data?.todaysTraining ?? []
      }
      habits={enabledHabits}
      coaching={
        experiencePolish && activeRelationship
          ? {
              coachName: activeRelationship.trainerName,
              coachRole: activeRelationship.trainerRole,
              nutritionTarget: assignment?.nutritionTarget ?? null,
              activeGoal: assignment?.activeGoal ?? null,
              visibleBriefs: assignment?.visibleBriefs ?? [],
              assignmentLoaded: assignment != null,
            }
          : null
      }
      isRefreshing={home.isRefreshing || relationships.isRefreshing}
      onRefresh={onRefresh}
      onOpenWorkout={onOpenWorkout}
      onOpenProgramme={onOpenProgramme}
    />
  );
}
