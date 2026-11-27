import { Type } from "@sinclair/typebox";
import { SET_TARGET_LIMITS } from "@persistence/form-limits";
import { Value } from "@sinclair/typebox/value";
import { schemaResolver } from "@/shared/form";
import type { WorkoutFormState } from "@/ui/hooks/useWorkoutForm";

/**
 * The workout builder's Save on react-hook-form (PER-139, the PER-147
 * pattern). Create and Edit workout keep the plan in `useWorkoutForm`'s
 * reducer (supersets, ordering, the set editor); that state is this form's
 * `context`, as the meal plan builder's Save does. The set limits come from
 * `@persistence/form-limits`, the same values the API enforces.
 *
 * The set editor's steppers already stay inside the limits; the schema is
 * what Save checks, and the server keeps the final say.
 */

const { maxSets, maxReps } = SET_TARGET_LIMITS;

export const WORKOUT_NAME_REQUIRED = "Workout name is required";
export const WORKOUT_EXERCISES_REQUIRED = "Please add at least one exercise";
export const SETS_OUT_OF_RANGE = `Use 1 to ${maxSets} sets.`;
export const REPS_OUT_OF_RANGE = `Reps go from 1 to ${maxReps}.`;

export const workoutSaveSchema = Type.Object({
  name: Type.String({ minLength: 1, errorMessage: WORKOUT_NAME_REQUIRED }),
  exercises: Type.Array(
    Type.Object({
      /** Only for exercises with per-set reps; old-range ones are left as saved. */
      sets: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: maxSets,
          errorMessage: SETS_OUT_OF_RANGE,
        }),
      ),
      reps: Type.Array(
        Type.Integer({
          minimum: 1,
          maximum: maxReps,
          errorMessage: REPS_OUT_OF_RANGE,
        }),
      ),
    }),
    { minItems: 1, errorMessage: WORKOUT_EXERCISES_REQUIRED },
  ),
});

export type WorkoutSavePrepared = {
  name: string;
  exercises: { sets?: number; reps: number[] }[];
};

/** What Save checks: the trimmed name and each exercise's per-set reps. */
export function prepareWorkoutSave(
  _values: unknown,
  context?: unknown,
): WorkoutSavePrepared {
  const state = context as WorkoutFormState;
  return {
    name: state.name.trim(),
    exercises: state.exercises.map((ex) =>
      ex.set_reps
        ? { sets: ex.set_reps.length, reps: ex.set_reps }
        : { reps: [] },
    ),
  };
}

export const workoutSaveResolver = schemaResolver<Record<string, never>>(
  workoutSaveSchema,
  { prepare: prepareWorkoutSave },
);

export type WorkoutSaveErrors = {
  name?: string;
  exercises?: string;
  /** Keyed by the exercise's index in the form. */
  byExercise: Record<number, string>;
};

/**
 * The same schema's messages for the current state, read during render so
 * the builder's inline errors clear as soon as they're fixed (Save itself
 * goes through `workoutSaveResolver` with `handleSubmit`).
 */
export function workoutSaveErrors(state: WorkoutFormState): WorkoutSaveErrors {
  const out: WorkoutSaveErrors = { byExercise: {} };
  const prepared = prepareWorkoutSave({}, state);
  for (const error of Value.Errors(workoutSaveSchema, prepared)) {
    const [field, index] = error.path.split("/").filter(Boolean);
    if (field === "name") out.name ??= error.message;
    else if (field === "exercises" && index === undefined) {
      out.exercises ??= error.message;
    } else if (field === "exercises") {
      out.byExercise[Number(index)] ??= error.message;
    }
  }
  return out;
}

export function workoutSaveAccepts(state: WorkoutFormState): boolean {
  return Value.Check(workoutSaveSchema, prepareWorkoutSave({}, state));
}
