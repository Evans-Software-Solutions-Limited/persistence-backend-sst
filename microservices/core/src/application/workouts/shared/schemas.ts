import { t } from "elysia";
import { resolveWorkoutRepRange } from "./repRange";

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
  // Zero, null and omitted bounds are normalized before persistence.
  targetRepsMin: t.Optional(
    t.Union([t.Integer({ minimum: 0, maximum: 2147483647 }), t.Null()]),
  ),
  targetRepsMax: t.Optional(
    t.Union([t.Integer({ minimum: 0, maximum: 2147483647 }), t.Null()]),
  ),
  targetDurationSeconds: t.Optional(t.Union([t.Number(), t.Null()])),
  restSeconds: t.Optional(t.Union([t.Number(), t.Null()])),
  notes: t.Optional(t.Union([t.String(), t.Null()])),
});

export type WorkoutExerciseInputBody = {
  exerciseId: string;
  sortOrder: number;
  supersetGroup?: number | null;
  targetSets?: number | null;
  targetRepsMin?: number | null;
  targetRepsMax?: number | null;
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
    const { targetRepsMin: min, targetRepsMax: max } =
      resolveWorkoutRepRange(ex);
    if (min > max) return i;
  }
  return null;
}
