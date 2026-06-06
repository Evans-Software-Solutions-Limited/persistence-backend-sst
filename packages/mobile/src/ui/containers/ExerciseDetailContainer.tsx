import { router, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";

import { ExerciseDetailPresenter } from "@/ui/presenters/ExerciseDetailPresenter";
import { useAuth } from "@/ui/hooks/useAuth";
import { useExercise } from "@/ui/hooks/useExercise";

/**
 * <ExerciseDetailContainer> — wires the `/(app)/exercises/[id]` route to the
 * cache-first `useExercise` read. Pushed from the Train > Exercises list
 * (and stacked under a workout when an exercise is opened from a workout's
 * detail), so Back returns to whatever pushed it.
 *
 * Ownership = `exercise.createdBy === session.userId`; only owners see the Edit
 * affordance (AC 7.3) and only owners can open the editor route.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-007
 */
export function ExerciseDetailContainer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const exerciseId = id ?? null;
  const { exercise, isLoading, error, refresh } = useExercise(exerciseId);
  const { session } = useAuth();

  const isOwner =
    exercise !== null &&
    exercise.createdBy !== null &&
    exercise.createdBy === session?.userId;

  const onClose = useCallback(() => router.back(), []);
  // Only rendered behind the owner+exercise gate (`isOwner` requires a loaded
  // exercise, which requires a non-null id), so `exerciseId` is always set here.
  const onEdit = useCallback(() => {
    router.push(`/(app)/exercises/${exerciseId}/edit` as never);
  }, [exerciseId]);
  const onRetry = useCallback(() => {
    void refresh();
  }, [refresh]);

  return (
    <ExerciseDetailPresenter
      exercise={exercise}
      isLoading={isLoading}
      error={error}
      isOwner={isOwner}
      onClose={onClose}
      onEdit={onEdit}
      onRetry={onRetry}
    />
  );
}
