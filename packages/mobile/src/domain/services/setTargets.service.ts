/**
 * Reps per set (PER-139, design G part 1) — pure helpers shared by the set
 * editor, the workout page and the active workout.
 *
 * A workout exercise either carries `setTargets` (10 / 8 / 8) or only the
 * old prescription (`targetSets` × `targetRepsMin`–`targetRepsMax`). Every
 * reader falls back to the old prescription when `setTargets` is missing, so
 * existing workouts look exactly as they did.
 */

import { SET_TARGET_LIMITS } from "@persistence/form-limits";
import type {
  SetTarget,
  WorkoutExercise,
  WorkoutExerciseInput,
} from "@/domain/models/workout";
import { weightInUnit, type WeightUnit } from "@/shared/utils";

/** Sets and reps the API accepts (`@persistence/form-limits`). */
export const MAX_SETS = SET_TARGET_LIMITS.maxSets;
export const MAX_SET_REPS = SET_TARGET_LIMITS.maxReps;

/** What a newly added exercise starts with: 3 sets of 10. */
export const DEFAULT_SET_COUNT = 3;
export const DEFAULT_SET_REPS = 10;

/** The per-set reps, or null when the exercise only has the old range. */
export function setRepsOf(ex: {
  setTargets?: readonly SetTarget[] | null;
}): number[] | null {
  const list = ex.setTargets;
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.map((s) => s.reps);
}

export type DerivedPrescription = {
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
};

/**
 * The old columns' values for a list of per-set reps (count, lowest,
 * highest) — what the server writes too, so 1.2.0 phones read "3 × 8–10".
 */
export function deriveFromSetReps(
  reps: readonly number[],
): DerivedPrescription {
  return {
    targetSets: reps.length,
    targetRepsMin: Math.min(...reps),
    targetRepsMax: Math.max(...reps),
  };
}

/** Keep a value inside 1…max. */
export function clampReps(reps: number): number {
  return Math.min(MAX_SET_REPS, Math.max(1, Math.round(reps)));
}

/** "3 sets" / "1 set". */
export function setCountLabel(count: number): string {
  return `${count} ${count === 1 ? "set" : "sets"}`;
}

/** "8–12" or "10" — the old range as a reps value. */
export function rangeLabel(min: number, max: number): string {
  return min === max ? `${min}` : `${min}–${max}`;
}

/**
 * The collapsed exercise line (canvas C5f): "3 sets · 12, 10, 10". An
 * exercise with only the old range reads "3 sets · 8–12 reps".
 */
export function prescriptionSummary(p: {
  setReps: readonly number[] | null;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
}): string {
  if (p.setReps && p.setReps.length > 0) {
    return `${setCountLabel(p.setReps.length)} · ${p.setReps.join(", ")}`;
  }
  return `${setCountLabel(p.targetSets)} · ${rangeLabel(
    p.targetRepsMin,
    p.targetRepsMax,
  )} reps`;
}

/**
 * Optimistic mirror of the server's rule for an update whose exercise has no
 * `setTargets` (the field wasn't sent): keep the stored per-set reps when the
 * same exercise sits at the same position and the old columns still equal
 * the values derived from them. `null` drops them; a list replaces them.
 *
 * Returns the per-set targets the cached copy should show, or undefined.
 */
export function setTargetsAfterUpdate(
  input: readonly WorkoutExerciseInput[],
  cached: readonly WorkoutExercise[],
): (SetTarget[] | undefined)[] {
  const queues = new Map<string, SetTarget[][]>();
  for (const ex of cached) {
    if (!ex.setTargets || ex.setTargets.length === 0) continue;
    const key = `${ex.exerciseId}:${ex.sortOrder}`;
    const list = queues.get(key) ?? [];
    list.push(ex.setTargets);
    queues.set(key, list);
  }
  return input.map((ex) => {
    if (ex.setTargets === null) return undefined;
    if (ex.setTargets !== undefined) {
      return ex.setTargets.length > 0
        ? ex.setTargets.map((s) => ({ reps: s.reps }))
        : undefined;
    }
    const candidate = queues.get(`${ex.exerciseId}:${ex.sortOrder}`)?.shift();
    if (!candidate) return undefined;
    const derived = deriveFromSetReps(candidate.map((s) => s.reps));
    return ex.targetSets === derived.targetSets &&
      ex.targetRepsMin === derived.targetRepsMin &&
      ex.targetRepsMax === derived.targetRepsMax
      ? candidate.map((s) => ({ reps: s.reps }))
      : undefined;
  });
}

/** Weight shown in the user's unit, without trailing zeros: "92.5 kg". */
function weightText(kg: number, unit: WeightUnit): string {
  const value = weightInUnit(kg, unit);
  return `${Number(value.toFixed(1))} ${unit}`;
}

/**
 * Last time's weights, as a hint under the exercise in the set editor:
 * "Last time 92.5 kg × 8, 6, 6, 5". A hint only — the prescription never
 * carries a weight. Null when the exercise has never been logged.
 */
export function lastTimeHint(
  recent: Readonly<Record<number, { weightKg: number; reps: number }>>,
  unit: WeightUnit,
): string | null {
  const sets = Object.keys(recent)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
    .map((n) => recent[n]!);
  if (sets.length === 0) return null;
  const reps = sets.map((s) => s.reps);
  const weights = sets.map((s) => s.weightKg);
  if (weights.every((w) => w <= 0)) {
    return `Last time ${reps.join(", ")} reps`;
  }
  if (weights.every((w) => w === weights[0])) {
    return `Last time ${weightText(weights[0]!, unit)} × ${reps.join(", ")}`;
  }
  return `Last time ${sets
    .map((s) => `${weightText(s.weightKg, unit)} × ${s.reps}`)
    .join(", ")}`;
}
