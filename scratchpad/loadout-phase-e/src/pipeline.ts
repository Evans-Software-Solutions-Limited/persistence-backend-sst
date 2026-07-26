/**
 * Phase E eval — the DETERMINISTIC stages, shared by both arms.
 *
 * `design.md` § 1: stage 1 (candidate assembly) and stage 3 (verification) are
 * deterministic whichever arm ships, and the KEPT/needs-swap partition is a
 * database property. Both arms therefore see the identical partition and the
 * identical candidate set, and only stage 2 (SELECTION) differs — which is what
 * makes the bake-off a comparison of selection quality rather than of two
 * different pipelines.
 */

import { isLegal, type Exercise, type Library } from "./library.ts";
import type { FixtureContext, FixtureRow, FixtureWorkout } from "./fixtures.ts";

/** design § 6.3 — one query, capped. */
export const CANDIDATE_CAP = 400;

export type PlanRow = {
  sortOrder: number;
  source: Exercise;
  needsSwap: boolean;
  sets: number;
  repsMin: number;
  repsMax: number;
  rest: number;
  supersetGroup?: string;
};

export type CandidatePool = {
  candidates: Exercise[];
  /** How many rows the LIMIT 400 discarded. design § 6.3: log, never truncate silently. */
  truncated: number;
  /** Union of primary muscles across the rows needing a swap. */
  muscleUnion: string[];
};

export type AdaptedRow = {
  sortOrder: number;
  status: "kept" | "swapped" | "unresolved";
  exerciseId: string | null;
  fromExerciseId: string;
  reason: string;
  sets: number;
  repsMin: number;
  repsMax: number;
  rest: number;
  supersetGroup?: string;
};

export type AdaptedPlan = {
  rows: AdaptedRow[];
  /** Arm-specific diagnostics (latency, tokens, parse failures). */
  meta: Record<string, unknown>;
};

export function buildPlan(
  workout: FixtureWorkout,
  context: FixtureContext,
  library: Library,
): PlanRow[] {
  const equipment = new Set(context.equipment);
  return workout.rows.map((row: FixtureRow, index: number) => {
    const source = library.byName.get(row.exercise);
    if (!source) {
      // Hard failure, not a skip: a fixture that silently shrinks proves nothing.
      throw new Error(
        `fixture ${workout.key} references an exercise absent from the seeded catalogue: ${row.exercise}`,
      );
    }
    return {
      sortOrder: index,
      source,
      needsSwap: !isLegal(source, equipment),
      sets: row.sets,
      repsMin: row.repsMin,
      repsMax: row.repsMax,
      rest: row.rest,
      supersetGroup: row.supersetGroup,
    };
  });
}

/**
 * Stage 1 (design § 6.3): union the primary muscles of every row needing a
 * swap, then ONE pass over the library with containment + primary-muscle
 * overlap + (in production) `buildVisibilityCondition`. `name ASC` ordering
 * matches the repository's FTS precedent, so the cap truncates deterministically.
 */
export function assembleCandidates(
  plan: PlanRow[],
  context: FixtureContext,
  library: Library,
): CandidatePool {
  const equipment = new Set(context.equipment);
  const muscleUnion = new Set<string>();
  for (const row of plan) {
    if (!row.needsSwap) continue;
    for (const muscle of row.source.primaryMuscles) muscleUnion.add(muscle);
  }

  const sourceIds = new Set(plan.map((row) => row.source.id));
  const matched = library.exercises
    .filter(
      (exercise) =>
        !sourceIds.has(exercise.id) &&
        isLegal(exercise, equipment) &&
        exercise.primaryMuscles.some((muscle) => muscleUnion.has(muscle)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    candidates: matched.slice(0, CANDIDATE_CAP),
    truncated: Math.max(0, matched.length - CANDIDATE_CAP),
    muscleUnion: [...muscleUnion].sort(),
  };
}

export type Violation = {
  sortOrder: number;
  kind:
    | "unknown_id"
    | "illegal_equipment"
    | "kept_row_changed"
    | "missing_row"
    | "extra_row"
    | "targets_mutated";
  detail: string;
};

/**
 * Stage 3 (design § 1): re-resolve every chosen id against the candidate set,
 * re-assert containment, and confirm the parent's targets were carried
 * unchanged. In production a violation is a 422 — here it is recorded, because
 * the RATE is one of the things the bake-off is measuring.
 */
export function verify(
  plan: PlanRow[],
  adapted: AdaptedRow[],
  pool: CandidatePool,
  context: FixtureContext,
  library: Library,
): Violation[] {
  const equipment = new Set(context.equipment);
  const poolIds = new Set(pool.candidates.map((c) => c.id));
  const violations: Violation[] = [];

  const bySortOrder = new Map(adapted.map((row) => [row.sortOrder, row]));
  for (const row of plan) {
    const out = bySortOrder.get(row.sortOrder);
    if (!out) {
      violations.push({
        sortOrder: row.sortOrder,
        kind: "missing_row",
        detail: `${row.source.name} dropped from the adapted plan`,
      });
      continue;
    }

    if (
      out.sets !== row.sets ||
      out.repsMin !== row.repsMin ||
      out.repsMax !== row.repsMax ||
      out.rest !== row.rest ||
      out.supersetGroup !== row.supersetGroup
    ) {
      violations.push({
        sortOrder: row.sortOrder,
        kind: "targets_mutated",
        detail: "sets/reps/rest/superset differ from the parent row",
      });
    }

    if (out.status === "kept") {
      if (out.exerciseId !== row.source.id) {
        violations.push({
          sortOrder: row.sortOrder,
          kind: "kept_row_changed",
          detail: `kept row reports ${out.exerciseId ?? "null"} but parent is ${row.source.id}`,
        });
      }
      continue;
    }

    if (out.status === "unresolved") continue;

    const chosen = out.exerciseId
      ? library.byId.get(out.exerciseId)
      : undefined;
    if (!chosen || !poolIds.has(chosen.id)) {
      violations.push({
        sortOrder: row.sortOrder,
        kind: "unknown_id",
        detail: `${out.exerciseId ?? "null"} is not a member of the candidate set`,
      });
      continue;
    }
    if (!isLegal(chosen, equipment)) {
      violations.push({
        sortOrder: row.sortOrder,
        kind: "illegal_equipment",
        detail: `${chosen.name} needs ${chosen.equipmentRequired.join(" + ")}`,
      });
    }
  }

  for (const out of adapted) {
    if (!plan.some((row) => row.sortOrder === out.sortOrder)) {
      violations.push({
        sortOrder: out.sortOrder,
        kind: "extra_row",
        detail: "adapted plan invented a row the parent does not have",
      });
    }
  }

  return violations;
}
