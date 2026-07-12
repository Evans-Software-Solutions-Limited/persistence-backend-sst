/**
 * Workout domain services — pure functions used by the form reducer
 * and the command layer (M2).
 *
 * No I/O, no React, no platform calls. Reads `Workout` / `WorkoutExercise`
 * shapes from the domain model and returns transformed copies.
 *
 * Spec: specs/04-workout-management/design.md § Domain Services
 *       specs/04-workout-management/requirements.md STORY-002, STORY-003
 */

import type {
  CreateWorkoutInput,
  WorkoutExercise,
  WorkoutExerciseInput,
} from "@/domain/models/workout";
import { fail, ok, type Result, type ValidationError } from "@/shared/errors";

/**
 * Validate a `CreateWorkoutInput` for shape + business rules. Mirrors
 * `validateExerciseInput` (M0): returns `ok(input)` on success or a
 * `ValidationError` whose `fields` map carries one message per failing
 * key (synthetic keys for nested array entries, e.g.
 * `exercises[0].targetSets`).
 *
 * Rules:
 * - `name` required, non-empty after trim (STORY-002 AC 2.2)
 * - `exercises` array required with at least 1 entry (AC 2.9)
 * - `targetSets` ≥ 1 when set
 * - `targetRepsMin` ≤ `targetRepsMax` when both set (AC 2.9)
 */
export function validateWorkoutInput(
  input: CreateWorkoutInput,
): Result<CreateWorkoutInput, ValidationError> {
  const fields: Record<string, string> = {};

  if (!input.name || input.name.trim().length === 0) {
    fields.name = "Workout name is required";
  }

  if (!input.exercises || input.exercises.length === 0) {
    fields.exercises = "Add at least one exercise";
  } else {
    input.exercises.forEach((ex, idx) => {
      if (
        ex.targetSets !== undefined &&
        ex.targetSets !== null &&
        ex.targetSets < 1
      ) {
        fields[`exercises[${idx}].targetSets`] = "Sets must be at least 1";
      }
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
  return ok(input);
}

/**
 * Sanitize trimmed strings + drop empty optional fields. Used by the
 * command layer before enqueueing a sync mutation; ensures the payload
 * stored in the queue matches what the backend expects.
 */
export function sanitizeCreateWorkoutInput(
  input: CreateWorkoutInput,
): CreateWorkoutInput {
  const description =
    input.description !== undefined && input.description !== null
      ? input.description.trim() || null
      : input.description;

  return {
    name: input.name.trim(),
    description,
    visibility: input.visibility,
    estimatedDurationMinutes: input.estimatedDurationMinutes,
    showInOwnerLibrary: input.showInOwnerLibrary,
    exercises: input.exercises.map(sanitizeExerciseInput),
  };
}

function sanitizeExerciseInput(ex: WorkoutExerciseInput): WorkoutExerciseInput {
  const notes =
    ex.notes !== undefined && ex.notes !== null
      ? ex.notes.trim() || null
      : ex.notes;
  return { ...ex, notes };
}

/**
 * Estimate workout duration from exercises. Mirrors the legacy
 * heuristic: `targetSets * (avg work seconds + restSeconds)` summed
 * across exercises, bumped to the nearest minute.
 *
 * Used as a fallback when the user hasn't entered an explicit
 * `estimatedDurationMinutes` on the form.
 */
export function calculateEstimatedDuration(
  exercises: readonly WorkoutExercise[],
): number {
  const WORK_SECONDS_PER_SET = 35; // legacy heuristic
  let total = 0;
  for (const ex of exercises) {
    const sets = ex.targetSets ?? 3;
    const rest = ex.restSeconds ?? 90;
    total += sets * (WORK_SECONDS_PER_SET + rest);
  }
  return Math.max(1, Math.round(total / 60));
}

/**
 * Reorder exercises by moving `fromIndex` to `toIndex`. Returns a new
 * array with `sortOrder` re-stamped 0..n-1 to match the array index.
 */
export function reorderExercises(
  exercises: readonly WorkoutExercise[],
  fromIndex: number,
  toIndex: number,
): WorkoutExercise[] {
  if (fromIndex < 0 || fromIndex >= exercises.length) {
    return [...exercises];
  }
  if (toIndex < 0 || toIndex >= exercises.length) {
    return [...exercises];
  }
  const next = [...exercises];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next.map((ex, idx) => ({ ...ex, sortOrder: idx }));
}

/**
 * Group exercises identified by id into a new superset. Assigns a fresh
 * `supersetGroup` integer (max+1 across the workout) to every selected
 * exercise. Standalone exercises keep their existing index ordering.
 *
 * Spec: STORY-003 AC 3.1
 */
export function groupAsSuperSet(
  exercises: readonly WorkoutExercise[],
  exerciseIds: readonly string[],
): WorkoutExercise[] {
  if (exerciseIds.length === 0) return [...exercises];
  const newGroup = nextSupersetGroup(exercises);
  const idSet = new Set(exerciseIds);
  return exercises.map((ex) =>
    idSet.has(ex.id) ? { ...ex, supersetGroup: newGroup } : ex,
  );
}

/** Ungroup all exercises in `supersetGroup`, setting their group to null. */
export function ungroupSuperSet(
  exercises: readonly WorkoutExercise[],
  supersetGroup: number,
): WorkoutExercise[] {
  return exercises.map((ex) =>
    ex.supersetGroup === supersetGroup ? { ...ex, supersetGroup: null } : ex,
  );
}

/**
 * Propagate shared fields (`targetSets`, `restSeconds`) from the lead
 * peer of a superset to all peers. The form layer calls this whenever
 * the user edits a shared field on the lead row, ensuring peers stay in
 * sync visually and on submit.
 *
 * Spec: STORY-002 AC 2.6, STORY-003 AC 3.2
 */
export function propagateSupersetSharedFields(
  exercises: readonly WorkoutExercise[],
  supersetGroup: number,
  shared: Pick<WorkoutExercise, "targetSets" | "restSeconds">,
): WorkoutExercise[] {
  return exercises.map((ex) =>
    ex.supersetGroup === supersetGroup
      ? {
          ...ex,
          targetSets: shared.targetSets,
          restSeconds: shared.restSeconds,
        }
      : ex,
  );
}

function nextSupersetGroup(exercises: readonly WorkoutExercise[]): number {
  let max = 0;
  for (const ex of exercises) {
    if (ex.supersetGroup !== null && ex.supersetGroup > max) {
      max = ex.supersetGroup;
    }
  }
  return max + 1;
}
