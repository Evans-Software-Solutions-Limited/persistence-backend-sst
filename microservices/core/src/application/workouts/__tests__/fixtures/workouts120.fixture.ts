/**
 * 1.2.0 contract fixtures for workouts (PER-111, design G part 1).
 *
 * Recorded from the app that shipped as 1.2.0 (main at c1bf892, app.json
 * 1.2.0): the store JavaScript that phones run until they update, and so the
 * backend's most important client.
 *
 * - request bodies: `toCreateWorkoutInput` (WorkoutCreatorContainer.tsx) and
 *   `toUpdateWorkoutInput` (WorkoutEditorContainer.tsx), queued verbatim by
 *   create-workout.command.ts / update-workout.command.ts. A rename sends NO
 *   `exercises`; a plan edit sends the whole list with exactly these seven
 *   fields per exercise.
 * - response shapes: `Workout`, `WorkoutExercise` and `WorkoutExerciseRef` in
 *   packages/mobile/src/domain/models/workout.ts.
 *
 * ⚠ Don't edit these to make a failing test pass. A failure here means a 1.2.0
 * phone would break. Only additive changes are allowed (no `/v2`).
 */

export type JsonType = "string" | "number" | "boolean" | "object" | "array";
export type FieldSpec = { type: JsonType; nullable: boolean };

/** `Workout` as 1.2.0 reads it (required fields only). */
export const WORKOUT_FIELDS_120: Record<string, FieldSpec> = {
  id: { type: "string", nullable: false },
  name: { type: "string", nullable: false },
  description: { type: "string", nullable: true },
  createdBy: { type: "string", nullable: false },
  visibility: { type: "string", nullable: false },
  estimatedDurationMinutes: { type: "number", nullable: false },
  showInOwnerLibrary: { type: "boolean", nullable: false },
  exercises: { type: "array", nullable: false },
  createdAt: { type: "string", nullable: false },
  updatedAt: { type: "string", nullable: false },
};

/** `WorkoutExercise` as 1.2.0 reads it. */
export const WORKOUT_EXERCISE_FIELDS_120: Record<string, FieldSpec> = {
  id: { type: "string", nullable: false },
  exerciseId: { type: "string", nullable: false },
  sortOrder: { type: "number", nullable: false },
  supersetGroup: { type: "number", nullable: true },
  targetSets: { type: "number", nullable: true },
  targetRepsMin: { type: "number", nullable: false },
  targetRepsMax: { type: "number", nullable: false },
  targetDurationSeconds: { type: "number", nullable: true },
  restSeconds: { type: "number", nullable: true },
  notes: { type: "string", nullable: true },
  exercise: { type: "object", nullable: true },
};

/** `WorkoutExerciseRef` as 1.2.0 reads it. */
export const EXERCISE_REF_FIELDS_120: Record<string, FieldSpec> = {
  id: { type: "string", nullable: false },
  name: { type: "string", nullable: false },
  category: { type: "string", nullable: false },
  difficultyLevel: { type: "string", nullable: false },
  videoUrl: { type: "string", nullable: true },
  thumbnailUrl: { type: "string", nullable: true },
};

/** One exercise as 1.2.0's create and plan-edit bodies send it. */
export function exercise120(
  exerciseId: string,
  sortOrder: number,
  targetSets: number,
  targetRepsMin: number,
  targetRepsMax: number,
) {
  return {
    exerciseId,
    sortOrder,
    supersetGroup: null,
    targetSets,
    targetRepsMin,
    targetRepsMax,
    restSeconds: 90,
  };
}

/** POST /workouts as 1.2.0 sends it. */
export function createBody120(exerciseIds: readonly string[]) {
  return {
    name: "Push day",
    description: null,
    visibility: "private",
    showInOwnerLibrary: true,
    exercises: exerciseIds.map((id, i) => exercise120(id, i, 3, 8, 12)),
  };
}

/** PATCH /workouts/:id for a rename: 1.2.0 omits `exercises` entirely. */
export const RENAME_BODY_120 = {
  name: "Push day (renamed)",
  description: null,
  visibility: "private",
};
