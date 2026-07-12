import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo } from "react";
import {
  deriveDominantEquipment,
  deriveWorkoutMuscles,
} from "@/domain/services/workoutMeta";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useWorkout } from "@/ui/hooks/useWorkout";
import { useWorkoutHistory } from "@/ui/hooks/useWorkoutHistory";
import { WorkoutDetailPresenter } from "@/ui/presenters/WorkoutDetailPresenter";

/**
 * Workout-detail screen container. Routed at `/(app)/workouts/[id]` so the
 * detail surface is deep-linkable, presented as a stack-modal.
 *
 * v3 additions (Workout Authoring v2):
 *   - `useWorkoutHistory(id)` feeds the hero's completed-session stats block
 *     (independent online-direct fetch; renders only when there's history).
 *   - Muscle pills + the dominant-equipment eyebrow are derived from the
 *     cached exercise library (the same join the Train > Workouts list uses).
 *     No workout DTO change — equipment omitted when nothing resolves.
 *
 * Spec: specs/milestones/WORKOUT-AUTHORING-V2/design.md § 10
 *       (legacy STORY-007 ACs 7.1, 7.2, 7.4 preserved)
 */
export function WorkoutDetailContainer() {
  const params = useLocalSearchParams<{ id?: string }>();
  const workoutId = params.id ?? null;
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const detail = useWorkout(workoutId);
  const history = useWorkoutHistory(workoutId);

  const workout = detail.workout;
  const isOwner =
    workout != null && userId != null && workout.createdBy === userId;

  // Derive muscle pills + the dominant equipment label from the cached
  // exercise library (workout refs carry neither). Recomputes only when the
  // workout identity changes — the cache read is cheap but keyed to the
  // workout so we don't re-scan on unrelated re-renders.
  const { muscles, equipmentLabel } = useMemo(() => {
    if (!workout) return { muscles: [] as string[], equipmentLabel: null };
    const muscleById = new Map<string, readonly string[]>();
    const equipmentById = new Map<string, readonly string[]>();
    for (const ex of storage.getCachedExercises()) {
      muscleById.set(ex.id, ex.primaryMuscleGroupLabels ?? []);
      // `equipment` holds DB UUIDs at runtime; the readable names live in
      // `equipmentLabels` (parallel to muscles). Use labels only — when the
      // library isn't fully cached the eyebrow gracefully drops the token.
      equipmentById.set(ex.id, ex.equipmentLabels ?? []);
    }
    return {
      muscles: deriveWorkoutMuscles(workout, (id) => muscleById.get(id)),
      equipmentLabel: deriveDominantEquipment(workout, (id) =>
        equipmentById.get(id),
      ),
    };
  }, [workout, storage]);

  const onClose = useCallback(() => {
    router.back();
  }, []);

  const onEdit = useCallback(() => {
    if (!workoutId) return;
    router.push(`/(app)/workouts/${workoutId}/edit` as never);
  }, [workoutId]);

  // Start CTA opens the active-session modal seeded from this template.
  const onStartWorkout = useCallback((id: string) => {
    router.push(`/(app)/session?workoutId=${id}` as never);
  }, []);

  // Stack-push the exercise detail on top so the workout stays underneath.
  const onExercisePress = useCallback((exerciseId: string) => {
    router.push(`/(app)/exercises/${exerciseId}` as never);
  }, []);

  return (
    <WorkoutDetailPresenter
      workout={workout}
      history={history.history}
      isHistoryLoading={history.isLoading}
      muscles={muscles}
      equipmentLabel={equipmentLabel}
      isOwner={isOwner}
      isLoading={detail.isLoading}
      error={detail.error}
      onClose={onClose}
      onEdit={onEdit}
      onStartWorkout={onStartWorkout}
      onExercisePress={onExercisePress}
    />
  );
}
