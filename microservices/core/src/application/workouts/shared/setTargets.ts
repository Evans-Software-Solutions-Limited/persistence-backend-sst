import { t } from "elysia";

/**
 * Reps per set (PER-111, design G part 1).
 *
 * A workout exercise may carry an ordered list of per-set targets, e.g.
 * 10 / 8 / 8. Set n is `setTargets[n - 1]`. There is no weight: a prescription
 * has none (canvas C5). "Same reps for all" is just equal values.
 *
 * Old readers (1.2.0 bundles) only know `targetSets`, `targetRepsMin` and
 * `targetRepsMax`, so whenever set targets are written those columns hold the
 * DERIVED values: the number of sets and the lowest / highest reps.
 */

export const MAX_SET_TARGETS = 20;
export const MAX_SET_TARGET_REPS = 100;

export interface SetTarget {
  reps: number;
}

/**
 * Wire schema for `setTargets` on a workout exercise. Optional; `null` means
 * "no per-set targets" (drops stored rows on update). Absent on update means
 * "not sent" — an old bundle — and triggers the preservation rule.
 */
export const setTargetsInputSchema = t.Optional(
  t.Union([
    t.Array(
      t.Object({
        reps: t.Integer({ minimum: 1, maximum: MAX_SET_TARGET_REPS }),
      }),
      { minItems: 1, maxItems: MAX_SET_TARGETS },
    ),
    t.Null(),
  ]),
);

export interface DerivedTargets {
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
}

/** The old columns' values for a list of set targets (non-empty). */
export function deriveFromSetTargets(
  setTargets: readonly SetTarget[],
): DerivedTargets {
  const reps = setTargets.map((s) => s.reps);
  return {
    targetSets: reps.length,
    targetRepsMin: Math.min(...reps),
    targetRepsMax: Math.max(...reps),
  };
}

/** True when `setTargets` is a non-empty list (the only shape that writes rows). */
export function hasSetTargets(
  setTargets: readonly SetTarget[] | null | undefined,
): setTargets is readonly SetTarget[] {
  return Array.isArray(setTargets) && setTargets.length > 0;
}

/** Copy, keeping only `reps` (never trusts extra keys into storage or JSON). */
export function cloneSetTargets(setTargets: readonly SetTarget[]): SetTarget[] {
  return setTargets.map((s) => ({ reps: s.reps }));
}

/**
 * The preservation rule's match test: do these old-column values equal the
 * ones worked out from the stored per-set rows? An old bundle that only
 * renamed the workout sends the derived values back unchanged, so this holds;
 * one that changed the prescription doesn't, and the rows are dropped.
 */
export function matchesDerived(
  values: {
    targetSets: number | null;
    targetRepsMin: number;
    targetRepsMax: number;
  },
  setTargets: readonly SetTarget[],
): boolean {
  const derived = deriveFromSetTargets(setTargets);
  return (
    values.targetSets === derived.targetSets &&
    values.targetRepsMin === derived.targetRepsMin &&
    values.targetRepsMax === derived.targetRepsMax
  );
}

/** A stored row as the preservation rule needs it. */
export interface StoredSetTargetRow {
  exerciseId: string;
  sortOrder: number;
  setTargets: SetTarget[];
}

/**
 * Index stored per-set rows by `exercise_id` + `sort_order` (the design's
 * "same exercise and position"). Queued so a workout that repeats an exercise
 * at one sort order keeps each row's targets in order.
 */
export function indexStoredSetTargets(
  rows: readonly StoredSetTargetRow[],
): Map<string, SetTarget[][]> {
  const byPosition = new Map<string, SetTarget[][]>();
  for (const row of rows) {
    if (row.setTargets.length === 0) continue;
    const key = positionKey(row.exerciseId, row.sortOrder);
    const list = byPosition.get(key) ?? [];
    list.push(row.setTargets);
    byPosition.set(key, list);
  }
  return byPosition;
}

export function positionKey(exerciseId: string, sortOrder: number): string {
  return `${exerciseId}:${sortOrder}`;
}

/**
 * Design G's rule for an exercise sent WITHOUT `setTargets` (an old bundle):
 * keep the stored per-set rows when the exercise matches (same exercise and
 * position) and its sets and rep range equal the values derived from those
 * rows. Otherwise the range applies, exactly as today.
 *
 * Consumes the matched entry so a repeated exercise can't reuse it.
 */
export function preservedSetTargets(
  stored: Map<string, SetTarget[][]>,
  incoming: {
    exerciseId: string;
    sortOrder: number;
    targetSets: number | null;
    targetRepsMin: number;
    targetRepsMax: number;
  },
): SetTarget[] | null {
  const queue = stored.get(
    positionKey(incoming.exerciseId, incoming.sortOrder),
  );
  const candidate = queue?.[0];
  if (!queue || !candidate) return null;
  queue.shift();
  return matchesDerived(incoming, candidate) ? candidate : null;
}
