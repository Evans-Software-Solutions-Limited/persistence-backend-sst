/**
 * Update-workout command — offline-capable. PATCH semantics mirror the
 * backend: when `exercises` is present in the input it's a full
 * replacement of the workout's exercise list.
 *
 * Spec: specs/04-workout-management/design.md § API Contract > PATCH
 *       specs/04-workout-management/requirements.md STORY-004 AC 4.5
 *       STORY-008 AC 8.3
 */

import type {
  UpdateWorkoutInput,
  Workout,
  WorkoutExercise,
} from "@/domain/models/workout";
import type { StoragePort } from "@/domain/ports/storage.port";
import { fail, ok, type Result, type ValidationError } from "@/shared/errors";

export type UpdateWorkoutCommandDeps = {
  storage: StoragePort;
  userId: string;
  generateId: () => string;
  now?: () => Date;
};

export function updateWorkoutCommand(
  deps: UpdateWorkoutCommandDeps,
  workoutId: string,
  input: UpdateWorkoutInput,
): Result<Workout, ValidationError> {
  // Lightweight validation — name non-empty when set, reps min ≤ max.
  // Full validateWorkoutInput is only used for create where the entire
  // input must be present; update is partial by design.
  const fields: Record<string, string> = {};
  if (input.name !== undefined && input.name.trim().length === 0) {
    fields.name = "Workout name cannot be empty";
  }
  if (input.exercises) {
    input.exercises.forEach((ex, idx) => {
      if (
        ex.targetRepsMin !== undefined &&
        ex.targetRepsMax !== undefined &&
        ex.targetRepsMin > ex.targetRepsMax
      ) {
        fields[`exercises[${idx}].targetRepsMin`] =
          "Min reps cannot exceed max reps";
      }
    });
  }
  if (Object.keys(fields).length > 0) {
    return fail({ kind: "validation", fields });
  }

  const cached = deps.storage.getCachedWorkoutDetail(deps.userId, workoutId);
  if (!cached) {
    // Without a cached source we can't form a valid optimistic merge.
    return fail({
      kind: "validation",
      fields: { workout: "Workout is not cached locally" },
    });
  }

  const nowDate = (deps.now?.() ?? new Date()).toISOString();
  const sanitizedName =
    input.name !== undefined ? input.name.trim() : cached.workout.name;
  const sanitizedDescription =
    input.description !== undefined
      ? input.description?.trim() || null
      : cached.workout.description;

  // Hydrate `exercise` from the local exercise library cache — same
  // reasoning as create-workout.command. Without this, a session
  // started right after an edit renders the exercise UUID in the name
  // column.
  const exercises: WorkoutExercise[] = input.exercises
    ? input.exercises.map((ex, idx) => {
        const cachedExercise = deps.storage.getCachedExercise(ex.exerciseId);
        return {
          id: `local-${deps.generateId()}-${idx}`,
          exerciseId: ex.exerciseId,
          sortOrder: ex.sortOrder,
          supersetGroup: ex.supersetGroup ?? null,
          targetSets: ex.targetSets ?? null,
          targetRepsMin: ex.targetRepsMin ?? 1,
          targetRepsMax: ex.targetRepsMax ?? 1,
          targetDurationSeconds: ex.targetDurationSeconds ?? null,
          restSeconds: ex.restSeconds ?? 90,
          notes: ex.notes ?? null,
          exercise: cachedExercise
            ? {
                id: cachedExercise.id,
                name: cachedExercise.name,
                category: cachedExercise.category,
                difficultyLevel: cachedExercise.difficulty,
                videoUrl: cachedExercise.videoUrl,
                thumbnailUrl: cachedExercise.thumbnailUrl,
              }
            : null,
        };
      })
    : cached.workout.exercises;

  const updated: Workout = {
    ...cached.workout,
    name: sanitizedName,
    description: sanitizedDescription,
    visibility: input.visibility ?? cached.workout.visibility,
    estimatedDurationMinutes:
      input.estimatedDurationMinutes ?? cached.workout.estimatedDurationMinutes,
    showInOwnerLibrary:
      input.showInOwnerLibrary ?? cached.workout.showInOwnerLibrary,
    exercises,
    updatedAt: nowDate,
  };

  // Optimistic cache update.
  deps.storage.cacheWorkoutDetail(deps.userId, updated);
  // Splatter into the mine list slice if present.
  const existingMine = deps.storage.getCachedWorkoutsList(deps.userId, "mine");
  if (existingMine) {
    const replaced = existingMine.workouts.map((w) =>
      w.id === workoutId ? updated : w,
    );
    deps.storage.cacheWorkoutsList(
      deps.userId,
      "mine",
      replaced,
      existingMine.quota,
    );
  }

  deps.storage.enqueueMutation({
    entityType: "workout",
    entityId: workoutId,
    operation: "update",
    payload: {
      name: input.name,
      description: input.description,
      visibility: input.visibility,
      estimatedDurationMinutes: input.estimatedDurationMinutes,
      showInOwnerLibrary: input.showInOwnerLibrary,
      exercises: input.exercises,
    },
    endpoint: `/workouts/${workoutId}`,
    method: "PATCH",
  });

  // Dashboard depends on the workout list — drop its cache so the
  // next home-tab focus refetches with the edited row instead of
  // serving the pre-edit snapshot until the dashboard TTL elapses.
  deps.storage.invalidateDashboard(deps.userId);

  return ok(updated);
}
