/**
 * Phase E · T-E2.2 — ARM A: the deterministic ranker.
 *
 * A THROWAWAY prototype of `design.md` § 6.2's scoring, written to be measured,
 * not shipped. Phase 1 builds the real `rankSubstitutes` (T-1.2) against the
 * repository and its own tests; nothing here should be copied wholesale.
 *
 * Two interpretation choices § 6.2 leaves open, made explicitly so the verdict
 * can be read against them:
 *
 *  1. **Overlap is proportional, not binary.** § 6.2 gives primary-muscle
 *     overlap "hard filter + 50". A binary +50 makes every candidate sharing one
 *     muscle with a multi-muscle source score identically, which throws away the
 *     signal the table is trying to encode. Scored as
 *     `50 × |∩| / |source.primary|` (and `20 × ratio` for secondary), so a full
 *     match beats a partial one.
 *  2. **`movement_type` has no data.** The signal is "same `movement_type` /
 *     `category` → 10". `movement_type` is NULL for all 2281 seeded rows — it is
 *     only ever written by `exercisesCreateHandler`/`exercisesUpdateHandler` for
 *     USER-created exercises — so it degrades to `category`, which is
 *     `strength` for 1976/2281 rows. Scored on category and recorded as
 *     near-inert; see `VERDICT-E2.md` § Why arm A lost.
 */

import type { Exercise } from "./library.ts";
import type {
  AdaptedPlan,
  AdaptedRow,
  CandidatePool,
  PlanRow,
} from "./pipeline.ts";
import type { FixtureContext } from "./fixtures.ts";

const DIFFICULTY_ORDER = ["beginner", "intermediate", "advanced"] as const;

export type RankContext = {
  equipmentTypeIds: string[];
  loggedExerciseIds: ReadonlySet<string>;
};

export type RankedCandidate = {
  exercise: Exercise;
  score: number;
  matchedOn: string[];
};

function ratio(source: string[], candidate: string[]): number {
  if (source.length === 0) return 0;
  const set = new Set(candidate);
  const hits = source.filter((m) => set.has(m)).length;
  return hits / source.length;
}

/** design § 6.3's pure-function signature, prototyped. */
export function rankSubstitutes(
  source: Exercise,
  candidates: Exercise[],
  context: RankContext,
): RankedCandidate[] {
  const ranked: RankedCandidate[] = [];

  for (const candidate of candidates) {
    // Hard filter: primary-muscle overlap. Equipment containment is already a
    // hard filter upstream (stage 1) — § 6.2 diverges from the orphaned SQL
    // function's −30 demotion on purpose.
    const primaryRatio = ratio(source.primaryMuscles, candidate.primaryMuscles);
    if (primaryRatio === 0) continue;

    const matchedOn: string[] = [];
    let score = 50 * primaryRatio;
    matchedOn.push("primary_muscles");

    const secondaryRatio = ratio(
      source.secondaryMuscles,
      candidate.secondaryMuscles,
    );
    if (secondaryRatio > 0) {
      score += 20 * secondaryRatio;
      matchedOn.push("secondary_muscles");
    }

    const sourceLevel = DIFFICULTY_ORDER.indexOf(source.difficulty);
    const candidateLevel = DIFFICULTY_ORDER.indexOf(candidate.difficulty);
    const levelGap = Math.abs(sourceLevel - candidateLevel);
    if (levelGap === 0) {
      score += 15;
      matchedOn.push("difficulty");
    } else if (levelGap === 1) {
      score += 7;
    }

    if (candidate.category === source.category) {
      score += 10;
      matchedOn.push("category");
    }

    if (context.loggedExerciseIds.has(candidate.id)) {
      score += 8;
      matchedOn.push("logged_before");
    }

    ranked.push({ exercise: candidate, score, matchedOn });
  }

  // `name ASC` tiebreak (§ 6.2), so the ranking is fully deterministic.
  return ranked.sort(
    (a, b) =>
      b.score - a.score || a.exercise.name.localeCompare(b.exercise.name),
  );
}

/**
 * ARM C support — the hybrid of design § 1 ("deterministic filtering + model
 * selection + model reasons"). Narrows stage 1's pool to the top `perRow`
 * ranked candidates for each row needing a swap, then hands the union to the
 * model. This is deliberately NOT the same candidate set arms A and B share:
 * arm C's whole hypothesis is that the deterministic ranker is a better
 * *shortlister* than it is a *chooser*.
 */
export function shortlistCandidates(
  plan: PlanRow[],
  pool: CandidatePool,
  rankContext: RankContext,
  perRow: number,
): CandidatePool {
  const keep = new Map<string, Exercise>();
  for (const row of plan) {
    if (!row.needsSwap) continue;
    for (const candidate of rankSubstitutes(
      row.source,
      pool.candidates,
      rankContext,
    ).slice(0, perRow)) {
      keep.set(candidate.exercise.id, candidate.exercise);
    }
  }
  return {
    candidates: [...keep.values()].sort((a, b) => a.name.localeCompare(b.name)),
    truncated: pool.truncated,
    muscleUnion: pool.muscleUnion,
  };
}

function keptReason(row: PlanRow): string {
  const kit = row.source.equipmentRequired.filter((e) => e !== "Bodyweight");
  return kit.length > 0
    ? `Kept · your kit has ${kit.join(" + ").toLowerCase()}`
    : "Kept · needs no equipment";
}

function swapReason(
  row: PlanRow,
  chosen: RankedCandidate,
  context: FixtureContext,
): string {
  const missing = row.source.equipmentRequired.filter(
    (e) => !context.equipment.includes(e),
  );
  const kit = chosen.exercise.equipmentRequired.filter(
    (e) => e !== "Bodyweight",
  );
  const muscles = row.source.primaryMuscles.filter((m) =>
    chosen.exercise.primaryMuscles.includes(m),
  );
  const head =
    missing.length > 0
      ? `No ${missing.join(" or ").toLowerCase()}`
      : "Not available with this kit";
  const body =
    muscles.length > 0 ? ` · same muscles (${muscles.join(", ")})` : "";
  const tail =
    kit.length > 0
      ? `, uses your ${kit.join(" + ").toLowerCase()}`
      : ", bodyweight only";
  return `${head}${body}${tail}`;
}

/**
 * design § 7 step 4: take the top candidate not already used elsewhere in the
 * plan — "a plan with the same exercise twice is a worse plan than a slightly
 * lower-ranked distinct pick".
 */
export function adaptWithRanker(
  plan: PlanRow[],
  pool: CandidatePool,
  context: FixtureContext,
  rankContext: RankContext,
): AdaptedPlan {
  const used = new Set(
    plan.filter((row) => !row.needsSwap).map((row) => row.source.id),
  );
  const rows: AdaptedRow[] = [];
  const startedAt = performance.now();

  for (const row of plan) {
    const targets = {
      sortOrder: row.sortOrder,
      fromExerciseId: row.source.id,
      sets: row.sets,
      repsMin: row.repsMin,
      repsMax: row.repsMax,
      rest: row.rest,
      supersetGroup: row.supersetGroup,
    };

    if (!row.needsSwap) {
      rows.push({
        ...targets,
        status: "kept",
        exerciseId: row.source.id,
        reason: keptReason(row),
      });
      continue;
    }

    const ranked = rankSubstitutes(row.source, pool.candidates, rankContext);
    const pick = ranked.find((candidate) => !used.has(candidate.exercise.id));
    if (!pick) {
      rows.push({
        ...targets,
        status: "unresolved",
        exerciseId: null,
        reason: `No compatible alternative for ${row.source.name} with this kit`,
      });
      continue;
    }

    used.add(pick.exercise.id);
    rows.push({
      ...targets,
      status: "swapped",
      exerciseId: pick.exercise.id,
      reason: swapReason(row, pick, context),
    });
  }

  return {
    rows,
    meta: { latencyMs: Math.round(performance.now() - startedAt), costUsd: 0 },
  };
}
