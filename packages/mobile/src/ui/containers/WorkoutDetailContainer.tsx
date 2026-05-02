import { router, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { useWorkout } from "@/ui/hooks/useWorkout";
import { WorkoutDetailPresenter } from "@/ui/presenters/WorkoutDetailPresenter";

/**
 * Workout-detail screen container — replaces the in-list `WorkoutPopover`
 * overlay (PR #41 follow-up). Routed at `/(app)/workouts/[id]` so the
 * detail surface is deep-linkable, presented as a stack-modal (slide-up
 * pageSheet, consistent with the create/edit modals), and back-able to
 * whatever pushed it.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-007
 *       ACs 7.1, 7.2, 7.4
 */
export function WorkoutDetailContainer() {
  const params = useLocalSearchParams<{ id?: string }>();
  const workoutId = params.id ?? null;
  const detail = useWorkout(workoutId);

  const onClose = useCallback(() => {
    router.back();
  }, []);

  // M3 stub — Start CTA navigates to the active-session placeholder.
  // The workout id is preserved in the deeplink so M3 can pick it up.
  const onStartWorkout = useCallback((id: string) => {
    router.push(`/coming-soon?feature=active-session&workoutId=${id}` as never);
  }, []);

  // Push the existing exercise detail route. Stack-pushing it on top of
  // the workout detail screen means the workout stays underneath —
  // back returns to the workout, not the workouts tab. Delivers Brad's
  // ask: "when an exercise is clicked when a workout is open, should
  // show the workout too" (interpretation b: stacked navigation).
  const onExercisePress = useCallback((exerciseId: string) => {
    router.push(`/(app)/exercises/${exerciseId}` as never);
  }, []);

  return (
    <WorkoutDetailPresenter
      workout={detail.workout}
      isLoading={detail.isLoading}
      error={detail.error}
      onClose={onClose}
      onStartWorkout={onStartWorkout}
      onExercisePress={onExercisePress}
    />
  );
}
