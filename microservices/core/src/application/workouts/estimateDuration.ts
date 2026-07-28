/**
 * Estimated workout duration from the exercise plan.
 *
 * A straight port of the legacy heuristic at
 * `persistence-mobile/lib/supabase/queries/workoutMutations.ts:128`
 * (`calculateWorkoutDuration`) — same grouping, same constants, same rounding,
 * so a workout authored in legacy and the same workout authored in V2 estimate
 * identically.
 *
 * V2 dropped the function at port time and kept only its fallback constant, so
 * EVERY workout was stored as 30 minutes regardless of content (the mobile form
 * seeded 30, the create handler defaulted to 30, and the column defaults to 30).
 * This restores the derivation and moves it SERVER-side, so all three authoring
 * paths — athlete create, coach create, and Loadout variations — share it rather
 * than each client re-implementing the heuristic.
 *
 * The model:
 *   • Exercises are grouped by `supersetGroup`; a standalone exercise is its own
 *     group (keyed on its sortOrder, which is unique within a workout).
 *   • Inside a group: every exercise contributes `sets × WORK_PER_SET` of work
 *     plus `(sets − 1) × restSeconds` of intra-exercise rest. Supersets add no
 *     rest between their members — that IS the superset.
 *   • Between groups: a flat REST_BETWEEN_GROUPS, not after the last one.
 *   • Total rounds UP to the nearest 5 minutes.
 */

/** ~1.25 min of work per set. Legacy `DEFAULT_WORK_PER_SET_SECONDS`. */
export const WORK_PER_SET_SECONDS = 75;
/** 2 min between groups/standalone blocks. Legacy `DEFAULT_REST_BETWEEN_GROUPS_SECONDS`. */
export const REST_BETWEEN_GROUPS_SECONDS = 120;

/**
 * Fallbacks for the nullable columns. `targetSets` and `restSeconds` are both
 * nullable in the schema (and omitted by some authoring paths), and treating a
 * null as 0 would silently under-estimate rather than fail — so a row with no
 * declared sets is costed as a single set, and no declared rest as the app's
 * own default rest.
 */
export const FALLBACK_SETS = 1;
export const FALLBACK_REST_SECONDS = 90;

/** The shape the estimator needs. Structural, so every caller's row type fits. */
export interface DurationEstimateExercise {
  sortOrder: number;
  supersetGroup?: number | null;
  targetSets?: number | null;
  restSeconds?: number | null;
}

/**
 * Minutes, rounded up to the nearest 5. Returns 0 for an empty plan — matching
 * legacy, and distinguishable from a real estimate (the smallest of which is 5).
 */
export function estimateWorkoutDurationMinutes(
  exercises: readonly DurationEstimateExercise[],
): number {
  if (exercises.length === 0) return 0;

  // Group by superset; standalone exercises each form their own group.
  const groups = new Map<string, DurationEstimateExercise[]>();
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
  // Rest BETWEEN groups — one gap fewer than there are groups.
  totalSeconds += Math.max(0, groups.size - 1) * REST_BETWEEN_GROUPS_SECONDS;

  return Math.ceil(Math.ceil(totalSeconds / 60) / 5) * 5;
}

/**
 * The value to STORE on a create: an explicit caller-supplied duration always
 * wins (a coach may know better than the heuristic); otherwise derive it from
 * the plan. An absent plan is an empty one, and estimates to 0 — as legacy.
 */
export function resolveEstimatedDurationMinutes(
  explicit: number | undefined,
  exercises: readonly DurationEstimateExercise[] | undefined,
): number {
  if (explicit !== undefined) return explicit;
  return estimateWorkoutDurationMinutes(exercises ?? []);
}
