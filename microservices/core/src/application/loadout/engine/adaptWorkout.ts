/**
 * The DETERMINISTIC stages of the adaptation pipeline (spec-21 § 1, § 7).
 *
 * Stage 1 (partition + shortlist) and stage 3 (verification) live here; stage 2
 * (`remapModel.ts`) is the only pluggable one. That split is what made the E2
 * bake-off a quality question rather than a safety one: equipment containment,
 * read-visibility and the parent's training targets never moved to the model, so
 * the model changes *which exercise is picked*, never *whether the pick is legal*.
 * Keep it that way — design § 1 says explicitly that this is the property
 * spec-26 must preserve when it mirrors the section.
 *
 * Everything in this module is a pure function. The handler owns the database, the
 * entitlement, the ceiling and the usage log.
 */

import type { AdaptationCandidate } from "../../repositories/exerciseRepository";
import type { WorkoutAdaptationRow } from "../../repositories/workoutRepository";
import { hasIntensityMismatch } from "./intensityMismatch";
import {
  keptReason,
  swappedReason,
  unresolvedReason,
  type RankSignal,
  type SubstitutionFlag,
} from "./reasons";
import {
  rankSubstitutes,
  type RankContext,
  type RankedCandidate,
} from "./rankSubstitutes";
import type { RemapSelection } from "./remapModel";
import type { AdaptedPlan, AdaptedRow, PlanRow } from "./types";

/**
 * How many ranked candidates per row the model chooses from.
 *
 * **25 is the measured value, not a guess.** E2's arm C shortlisted the top 25
 * per row — mean 58 candidates offered against arm B's 314 — and tied arm B
 * 25-25 on blind preference at 28.7 % of the cost. Raising it is the cheap lever
 * if device use ever shows the shortlist excluding a pick users wanted
 * (`tasks.md` Phase 5); removing the shortlist is not.
 */
export const SHORTLIST_PER_ROW = 25;

/**
 * Stage 1a — KEPT vs needs-swap, and what each row is missing.
 *
 * This is the TypeScript mirror of the SQL containment predicate
 * (`equipmentSubsetOf`, § 6.1): a row survives when the context has everything it
 * requires. `x ⊆ ∅` semantics match too — a bodyweight row (empty
 * `equipment_required`) passes every context, which § 6.1 confirms is correct
 * behaviour rather than a bug.
 *
 * ⚠ Two seeded rows (`Leg Press`, `Leg Curl`) carry an EMPTY
 * `equipment_required` because their seeded equipment names have no
 * `equipment_types` row and `seedExercises.ts` drops unmapped names silently — so
 * they are KEPT in a bands-only context. That is a live data bug
 * (`tasks.md` T-E.10, needs a data migration plus a loud seeder guard), not
 * something for this function to special-case.
 */
export function partitionPlan(
  rows: readonly WorkoutAdaptationRow[],
  equipmentTypeIds: readonly string[],
): PlanRow[] {
  const available = new Set(equipmentTypeIds);

  return rows.map((row) => {
    const missingEquipment = row.source.equipmentRequired.filter(
      (id) => !available.has(id),
    );
    return {
      sortOrder: row.sortOrder,
      source: row.source,
      needsSwap: missingEquipment.length > 0,
      missingEquipment,
      supersetGroup: row.supersetGroup,
      targetSets: row.targetSets,
      targetRepsMin: row.targetRepsMin,
      targetRepsMax: row.targetRepsMax,
      targetDurationSeconds: row.targetDurationSeconds,
      restSeconds: row.restSeconds,
      notes: row.notes,
    };
  });
}

/**
 * Stage 1b — the § 6.2 ranker used as the SHORTLISTER: the top `perRow`
 * candidates for each row needing a swap, keyed by `sortOrder`.
 *
 * The per-row lists are also what stage 3 repairs from, so they are returned
 * rather than immediately unioned.
 */
export function shortlistPerRow(
  plan: readonly PlanRow[],
  candidates: readonly AdaptationCandidate[],
  context: RankContext,
  perRow: number = SHORTLIST_PER_ROW,
): Map<number, RankedCandidate[]> {
  const byRow = new Map<number, RankedCandidate[]>();
  for (const row of plan) {
    if (!row.needsSwap) continue;
    byRow.set(
      row.sortOrder,
      rankSubstitutes(row.source, candidates, context).slice(0, perRow),
    );
  }
  return byRow;
}

/**
 * The union of every row's shortlist — the exact list the model is offered, and
 * therefore the set its selections are validated for membership against.
 *
 * `name ASC` so the prompt is byte-stable for a given input, which keeps the
 * measurement reproducible and makes prompt-caching viable later.
 */
export function unionShortlist(
  byRow: ReadonlyMap<number, RankedCandidate[]>,
): AdaptationCandidate[] {
  const unique = new Map<string, AdaptationCandidate>();
  for (const ranked of byRow.values()) {
    for (const entry of ranked) unique.set(entry.candidate.id, entry.candidate);
  }
  return Array.from(unique.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

/**
 * The display slice of a candidate, shared by the preview's rows and the
 * substitute picker so the two surfaces cannot drift into different shapes.
 */
export function toExerciseDisplay(
  candidate: AdaptationCandidate,
): NonNullable<AdaptedRow["exercise"]> {
  return {
    id: candidate.id,
    name: candidate.name,
    category: candidate.category,
    difficultyLevel: candidate.difficultyLevel,
    thumbnailUrl: candidate.thumbnailUrl,
    equipmentRequired: candidate.equipmentRequired,
  };
}

function targetsOf(row: PlanRow) {
  return {
    supersetGroup: row.supersetGroup,
    targetSets: row.targetSets,
    targetRepsMin: row.targetRepsMin,
    targetRepsMax: row.targetRepsMax,
    targetDurationSeconds: row.targetDurationSeconds,
    restSeconds: row.restSeconds,
    notes: row.notes,
  };
}

/**
 * Why the chosen candidate suits THIS row.
 *
 * A candidate can be legal for the plan but absent from this row's own shortlist
 * — the model is offered the union, so it may reasonably pick something ranked
 * for a neighbouring row. Ranking the single candidate covers that case with the
 * same code path rather than returning an empty `matchedOn` that would read as
 * "no reason at all".
 */
function matchSignals(
  row: PlanRow,
  chosen: AdaptationCandidate,
  rowShortlist: readonly RankedCandidate[],
  context: RankContext,
): RankSignal[] {
  const fromShortlist = rowShortlist.find(
    (entry) => entry.candidate.id === chosen.id,
  );
  if (fromShortlist) return fromShortlist.matchedOn;
  return rankSubstitutes(row.source, [chosen], context)[0]?.matchedOn ?? [];
}

/**
 * Stage 3 — verification and assembly. The preview response is built HERE, from
 * the parent's rows plus validated selections; the model's payload never reaches
 * it directly.
 *
 * What this stage enforces, in order of consequence:
 *
 *  1. **Targets are copied from the parent, byte-for-byte** (§ 1 rule 2). There is
 *     no code path by which a model value reaches sets/reps/rest/order/superset.
 *  2. **KEPT rows are a database property.** A selection for a row that did not
 *     need a swap is ignored outright (E2 saw the model answer for a fixed row
 *     once in 80 runs).
 *  3. **Equipment containment is re-asserted on every chosen candidate.**
 *     Structurally true — the pool came from a containment-filtered query — which
 *     is exactly why it is worth re-checking: if stage 1 ever leaks, this is the
 *     net, and the row degrades to a repair rather than shipping an illegal pick.
 *  4. **No duplicate picks within a plan** (T-1.4). A plan with the same exercise
 *     twice is worse than a slightly lower-ranked distinct pick, so a duplicate is
 *     REPAIRED from the row's shortlist rather than rejected.
 *  5. **A missing row is repaired the same way.** A model that skips a row is a
 *     protocol failure, and one mechanism for both failures beats two.
 *     ⚠ An explicit `exerciseId: null` is NOT a protocol failure — it is the model
 *     exercising AC-3.4 ("nothing here fits"), and it is honoured, not overridden.
 *     Every repair is recorded as `selectedBy: "ranker"` so the rate is visible;
 *     E2 measured zero duplicates across 116 runs, so it should stay near zero.
 */
export function assembleAdaptedPlan(input: {
  plan: readonly PlanRow[];
  shortlistByRow: ReadonlyMap<number, RankedCandidate[]>;
  selections: ReadonlyMap<number, RemapSelection>;
  rankContext: RankContext;
  equipmentTypeIds: readonly string[];
  loadableEquipmentTypeIds: ReadonlySet<string>;
  candidateCount: number;
  candidatePoolTruncated: boolean;
  modelId: string | null;
}): AdaptedPlan {
  const available = new Set(input.equipmentTypeIds);
  const offered = new Map<string, AdaptationCandidate>();
  for (const ranked of input.shortlistByRow.values()) {
    for (const entry of ranked)
      offered.set(entry.candidate.id, entry.candidate);
  }

  // Seeded with the KEPT rows: a swap must not duplicate an exercise the plan
  // already retains, not just one another swap already took.
  const used = new Set(
    input.plan.filter((row) => !row.needsSwap).map((row) => row.source.id),
  );

  const isLegal = (candidate: AdaptationCandidate): boolean =>
    candidate.equipmentRequired.every((id) => available.has(id));

  const rows: AdaptedRow[] = [];
  let intensityMismatchCount = 0;

  for (const row of input.plan) {
    const targets = targetsOf(row);

    if (!row.needsSwap) {
      rows.push({
        sortOrder: row.sortOrder,
        ...targets,
        status: "kept",
        exerciseId: row.source.id,
        substitutedFromExerciseId: null,
        reason: keptReason(),
        exercise: toExerciseDisplay(row.source),
      });
      continue;
    }

    const rowShortlist = input.shortlistByRow.get(row.sortOrder) ?? [];
    const selection = input.selections.get(row.sortOrder);
    const note = selection?.reason.trim() ? selection.reason.trim() : null;

    const unresolved = (): void => {
      rows.push({
        sortOrder: row.sortOrder,
        ...targets,
        status: "unresolved",
        exerciseId: null,
        substitutedFromExerciseId: row.source.id,
        reason: unresolvedReason({
          missingEquipment: row.missingEquipment,
          note,
        }),
        exercise: null,
      });
    };

    // The model explicitly declined this row (AC-3.4). Honoured as-is.
    if (selection && selection.exerciseId === null) {
      unresolved();
      continue;
    }

    let chosen = selection?.exerciseId
      ? offered.get(selection.exerciseId)
      : undefined;
    let selectedBy: "model" | "ranker" = chosen ? "model" : "ranker";

    if (chosen && (used.has(chosen.id) || !isLegal(chosen))) {
      // Duplicate, or an illegal pick that stage 1 should never have offered.
      chosen = undefined;
      selectedBy = "ranker";
    }

    if (!chosen) {
      chosen = rowShortlist.find(
        (entry) => !used.has(entry.candidate.id) && isLegal(entry.candidate),
      )?.candidate;
      selectedBy = "ranker";
    }

    if (!chosen) {
      unresolved();
      continue;
    }

    used.add(chosen.id);

    const flags: SubstitutionFlag[] = [];
    if (
      hasIntensityMismatch(
        row,
        row.source,
        chosen,
        input.loadableEquipmentTypeIds,
      )
    ) {
      flags.push("intensity_mismatch");
      intensityMismatchCount += 1;
    }

    rows.push({
      sortOrder: row.sortOrder,
      ...targets,
      status: "swapped",
      exerciseId: chosen.id,
      substitutedFromExerciseId: row.source.id,
      reason: swappedReason({
        missingEquipment: row.missingEquipment,
        matchedOn: matchSignals(row, chosen, rowShortlist, input.rankContext),
        flags,
        // Only the model's own pick carries the model's sentence. A repaired row
        // would otherwise attribute prose about a DIFFERENT exercise to this one.
        note: selectedBy === "model" ? note : null,
        selectedBy,
      }),
      exercise: toExerciseDisplay(chosen),
    });
  }

  return {
    rows,
    meta: {
      keptCount: rows.filter((row) => row.status === "kept").length,
      swappedCount: rows.filter((row) => row.status === "swapped").length,
      unresolvedCount: rows.filter((row) => row.status === "unresolved").length,
      intensityMismatchCount,
      candidateCount: input.candidateCount,
      candidatePoolTruncated: input.candidatePoolTruncated,
      modelId: input.modelId,
    },
  };
}
