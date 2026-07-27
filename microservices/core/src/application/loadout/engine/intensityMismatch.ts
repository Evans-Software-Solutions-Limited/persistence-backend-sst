/**
 * Intensity mismatch (spec-21 AC-3.5b, design § 7.1b, T-1.11).
 *
 * The gap NO swap can close. Raised by Brad — "it's not just about still working
 * the biceps but in the same manner" — and then measured on the E2 dataset:
 * **10 of 171 swaps in the winning arm put a strength-range row (reps ≤ 6) onto
 * equipment that cannot load it**, e.g. `Barbell Deadlift 4×4-6 → Band Good
 * Morning 4×4-6`. All 10 were in the `bands_only` context.
 *
 * **The exercise choice in those rows is CORRECT** — hinge → hinge, press →
 * press — and the prescription is still unusable, because bands cannot express
 * that intensity. So this is not fixable by a better ranker or a better model:
 * the cause is design § 1's rule 2, targets are copied from the parent and never
 * model-authored, which is right for trust and wrong for this 5.8 %.
 *
 * **Phase 1 ships DETECTION ONLY.** No model, no cost, no ceiling. The user is
 * told their bands cannot load a 4-6 rep deadlift and can accept it as accessory
 * volume, swap manually, or drop the row.
 *
 * ⚠ **Changing the target to suit the kit (4×4-6 → 3×12-15) is explicitly NOT in
 * scope.** It relaxes § 1 rule 2 and is a Brad decision with its own slice. Do
 * not do it implicitly here or in the ranker.
 */

import type { AdaptationCandidate } from "../../repositories/exerciseRepository";

/**
 * Equipment that can express a heavy low-rep set, BY NAME.
 *
 * By name and not by `equipment_types.category` because the loadable set cuts
 * across the categories: `free_weights` also holds Kettlebell, Medicine Ball,
 * Bench and Squat Rack, and `bodyweight`/`accessories` hold nothing loadable.
 *
 * ⚠ **Narrower than design § 7.1b's original sketch**, which included
 * `Kettlebell` and `Medicine Ball` — neither can load a 4-6 rep strength row
 * either (a barbell hinge swapped onto a 5 kg med ball would have passed the
 * check). Sensitivity-tested on the E2 dataset when the spec was written:
 * removing both leaves the measured count at 10/171 unchanged, so the published
 * figure is unaffected and the narrower list is strictly better.
 *
 * `Bench` and `Squat Rack` are excluded on the same principle — they hold a load,
 * they are not one. A row needing only a bench is bodyweight-loaded.
 *
 * ⚠ These strings must match `equipment_types.name` in the live catalogue. A
 * rename would silently make this check un-fireable, so
 * `intensityMismatch.test.ts` asserts every name against the seeded catalogue's
 * own migration.
 */
export const LOADABLE_EQUIPMENT_NAMES = [
  "Barbell",
  "Dumbbells",
  "EZ Bar",
  "Smith Machine",
  "Leg Press Machine",
  "Leg Curl Machine",
  "Leg Extension Machine",
  "Cable Machine",
  "Lat Pulldown Machine",
  "Sled",
] as const;

/** Reps at or below this are treated as a strength prescription (AC-3.5b). */
export const STRENGTH_RANGE_MAX_REPS = 6;

export interface IntensityCheckRow {
  targetRepsMax: number;
  targetDurationSeconds: number | null;
}

function intersects(
  ids: readonly string[],
  loadable: ReadonlySet<string>,
): boolean {
  return ids.some((id) => loadable.has(id));
}

/**
 * True when `chosen` is a valid pattern match that still cannot carry the
 * parent row's prescription.
 *
 * Three conditions, all required:
 *
 *   1. the parent row is a strength prescription (reps ≤ 6);
 *   2. the source exercise DID use loadable equipment — otherwise there was no
 *      load to lose, and a bodyweight 5×5 stays a bodyweight 5×5;
 *   3. the replacement uses NONE.
 *
 * ⚠ Duration-prescribed rows are excluded, and that exclusion is load-bearing
 * rather than cosmetic. `findInvalidRepRangeIndex`'s `TARGET_REPS_DEFAULT` is
 * **1**, so a plank prescribed as `3 × 45 s` stores `targetRepsMax = 1` — which
 * satisfies "reps ≤ 6" and would flag every timed row swapped off a machine as a
 * strength mismatch. The E2 corpus was all rep ranges, so this false positive is
 * not in the measured 10/171 and is guarded here instead.
 */
export function hasIntensityMismatch(
  row: IntensityCheckRow,
  source: AdaptationCandidate,
  chosen: AdaptationCandidate,
  loadableEquipmentTypeIds: ReadonlySet<string>,
): boolean {
  if (row.targetDurationSeconds !== null) return false;
  if (row.targetRepsMax > STRENGTH_RANGE_MAX_REPS) return false;
  if (!intersects(source.equipmentRequired, loadableEquipmentTypeIds)) {
    return false;
  }
  return !intersects(chosen.equipmentRequired, loadableEquipmentTypeIds);
}
