import { t } from "elysia";

/**
 * Wire-format schema for a nested `WorkoutExercise` body entry. Shared
 * between POST `/workouts` and PATCH `/workouts/:id` so the create + edit
 * surfaces stay structurally identical.
 *
 * Spec: specs/04-workout-management/design.md § API Contract
 */
export const workoutExerciseInputSchema = t.Object({
  exerciseId: t.String(),
  sortOrder: t.Number(),
  supersetGroup: t.Optional(t.Union([t.Number(), t.Null()])),
  targetSets: t.Optional(t.Union([t.Number(), t.Null()])),
  targetRepsMin: t.Optional(t.Number()),
  targetRepsMax: t.Optional(t.Number()),
  targetDurationSeconds: t.Optional(t.Union([t.Number(), t.Null()])),
  restSeconds: t.Optional(t.Union([t.Number(), t.Null()])),
  notes: t.Optional(t.Union([t.String(), t.Null()])),
});

/**
 * Defaults applied by `WorkoutRepository.toWorkoutExerciseInsert` when a
 * client omits a rep bound. Validation must compare against these
 * resolved values, otherwise a payload like `{ targetRepsMin: 5 }`
 * (without a max) would store min=5 / max=1 in the database — violating
 * the min ≤ max invariant.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-002 AC 2.9
 */
export const TARGET_REPS_DEFAULT = 1;

export type WorkoutExerciseInputBody = {
  exerciseId: string;
  sortOrder: number;
  supersetGroup?: number | null;
  targetSets?: number | null;
  targetRepsMin?: number;
  targetRepsMax?: number;
  targetDurationSeconds?: number | null;
  restSeconds?: number | null;
  notes?: string | null;
};

/**
 * Validate the rep-range invariant against the values that will actually
 * be stored — i.e. with the same defaults the repository applies on
 * insert. Returns `null` when valid, or a 0-based index of the first
 * exercise that violates the invariant.
 */
export function findInvalidRepRangeIndex(
  exercises: readonly WorkoutExerciseInputBody[],
): number | null {
  for (let i = 0; i < exercises.length; i++) {
    const ex = exercises[i];
    const min = ex.targetRepsMin ?? TARGET_REPS_DEFAULT;
    const max = ex.targetRepsMax ?? TARGET_REPS_DEFAULT;
    if (min > max) return i;
  }
  return null;
}
