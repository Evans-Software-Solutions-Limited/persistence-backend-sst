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

/** ~1.25 min of work per set. Legacy `DEFAULT_WORK_PER_SET_SECONDS`. */
const WORK_PER_SET_SECONDS = 75;
/** 2 min between groups/standalone blocks. Legacy `DEFAULT_REST_BETWEEN_GROUPS_SECONDS`. */
const REST_BETWEEN_GROUPS_SECONDS = 120;
const FALLBACK_SETS = 1;
const FALLBACK_REST_SECONDS = 90;
/**
 * What an EMPTY plan estimates to. Matches the `workouts` column default, so a
 * workout with no exercises keeps reading "30 min" rather than "0m".
 */
export const EMPTY_PLAN_DURATION_MINUTES = 30;

/**
 * Estimate workout duration from the exercise plan.
 *
 * ⚠ This MUST stay in step with the server's
 * `microservices/core/src/application/workouts/estimateDuration.ts`, which is
 * the authority — this copy exists only so the OPTIMISTIC row written before
 * the create/update round-trips shows the same number the server will store.
 * Divergence shows up as the duration visibly changing after a sync.
 *
 * Specifically it mirrors the server's `resolveEstimatedDurationMinutes`, not
 * its bare `estimateWorkoutDurationMinutes`: an EMPTY plan returns the column
 * default (30), not the estimator's 0. The update path must therefore not call
 * this for an empty plan — the server leaves the stored value untouched there,
 * and `update-workout.command.ts` guards on `length > 0` to match.
 *
 * It previously claimed to mirror the legacy heuristic and did not: 35s of work
 * per set instead of 75, rest charged on every set instead of `sets − 1`, no
 * superset grouping, no inter-group rest, and rounding to the nearest minute
 * rather than up to 5. It also had no callers. This is the real port — group by
 * superset (standalone exercises are their own group), `sets × 75s` work plus
 * `(sets − 1) × rest` inside each group, `120s` between groups but not after
 * the last, rounded up to the nearest 5 minutes.
 */
export function calculateEstimatedDuration(
  exercises: readonly WorkoutExercise[],
): number {
  if (exercises.length === 0) return EMPTY_PLAN_DURATION_MINUTES;

  const groups = new Map<string, WorkoutExercise[]>();
  for (const ex of exercises) {
    const key =
      ex.supersetGroup != null ? `g:${ex.supersetGroup}` : `s:${ex.sortOrder}`;
    const existing = groups.get(key);
    if (existing) existing.push(ex);
    else groups.set(key, [ex]);
  }

  let totalSeconds = 0;
  for (const members of groups.values()) {
    for (const ex of members) {
      const sets = ex.targetSets ?? FALLBACK_SETS;
      const rest = ex.restSeconds ?? FALLBACK_REST_SECONDS;
      totalSeconds += sets * WORK_PER_SET_SECONDS;
      totalSeconds += Math.max(0, sets - 1) * rest;
    }
  }
  totalSeconds += Math.max(0, groups.size - 1) * REST_BETWEEN_GROUPS_SECONDS;

  return Math.ceil(Math.ceil(totalSeconds / 60) / 5) * 5;
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
