/**
 * The § 6.2 substitute ranker (spec-21 T-1.2) — pure, database-free, and
 * exhaustively unit-testable.
 *
 * ## What this is FOR, which changed on 2026-07-26
 *
 * **It is the SHORTLISTER, not the chooser.** The Phase E2 bake-off
 * (`scratchpad/loadout-phase-e/VERDICT-E2.md`, design § 6.0) measured this
 * scoring as a standalone engine and it lost 4-50 on blind preference — it is
 * dominated by primary-muscle overlap and effectively pattern-blind, producing
 * equipment-legal but unshippable swaps (Barbell Deadlift → **Atlas Stones** in a
 * bands-only context). What it IS good at is narrowing 314 candidates to ~25 per
 * row with no measured quality cost, which removes 71 % of the model arm's token
 * spend.
 *
 * ⚠ **Do not "improve" this by leaning harder on `movement_type`.** It is NULL
 * for all 2281 seeded rows — only `exercisesCreateHandler` /
 * `exercisesUpdateHandler` ever write it, for user-created exercises — so the
 * 10-point pattern signal degrades to `category`, which is `strength` for
 * 1976/2281 rows. That absence is *why* the deterministic arm lost, and closing
 * it is a catalogue-backfill workstream (`tasks.md` T-E.11), not a weighting
 * tweak.
 *
 * The orphaned Postgres function `get_alternative_exercises`
 * (`002_functions_and_triggers.sql:432`) is NOT called: it is dead, untested,
 * references columns this repo never verified, and cannot be unit-tested from
 * TypeScript. Its formula is inherited; its implementation is not. The one
 * deliberate divergence is equipment — the SQL function *demotes* incompatible
 * exercises by 30 points but still returns them, whereas an exercise you cannot
 * perform is not a candidate at all (containment is a hard filter in stage 1).
 */

import type { AdaptationCandidate } from "../../repositories/exerciseRepository";
import type { RankSignal } from "./reasons";

/**
 * § 6.2's weights, named so a test can assert the ORDERING they imply rather
 * than re-deriving arithmetic that would then drift from the table.
 */
export const RANK_WEIGHTS = {
  primaryMuscles: 50,
  secondaryMuscles: 20,
  sameDifficulty: 15,
  adjacentDifficulty: 7,
  samePattern: 10,
  loggedBefore: 8,
} as const;

const DIFFICULTY_ORDER = ["beginner", "intermediate", "advanced"] as const;

export interface RankContext {
  loggedExerciseIds: ReadonlySet<string>;
}

export interface RankedCandidate {
  candidate: AdaptationCandidate;
  score: number;
  matchedOn: RankSignal[];
}

/**
 * Proportional, not binary, overlap.
 *
 * § 6.2 says "primary-muscle overlap → hard filter + 50". A flat +50 scores every
 * candidate sharing ONE muscle with a multi-muscle source identically, which
 * throws away the signal the row is trying to encode — a chest+triceps press and
 * a triceps isolation would tie for a bench press. Scored as
 * `weight × |source ∩ candidate| / |source|` so a full match outranks a partial
 * one. Recorded here because the eval's prototype made the same call and the
 * verdict is read against it.
 */
function overlapRatio(
  source: readonly string[],
  candidate: readonly string[],
): number {
  if (source.length === 0) return 0;
  const candidateSet = new Set(candidate);
  const hits = source.filter((id) => candidateSet.has(id)).length;
  return hits / source.length;
}

function difficultyIndex(level: string | null): number {
  return level === null
    ? -1
    : DIFFICULTY_ORDER.indexOf(level as (typeof DIFFICULTY_ORDER)[number]);
}

/**
 * Rank `candidates` as replacements for `source`, best first.
 *
 * Candidates sharing NO primary muscle with the source are dropped, not demoted
 * — § 6.2's "hard filter + 50". Equipment containment is assumed to have been
 * applied upstream (stage 1); this function never re-checks it, so it is equally
 * usable for the picker's deliberately-incompatible "others" list (§ 6.4).
 *
 * Ties break on `name ASC`, matching the repository's FTS precedent, so the
 * ordering is total and the shortlist is reproducible across runs.
 */
export function rankSubstitutes(
  source: AdaptationCandidate,
  candidates: readonly AdaptationCandidate[],
  context: RankContext,
): RankedCandidate[] {
  const ranked: RankedCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.id === source.id) continue;

    const primaryRatio = overlapRatio(
      source.primaryMuscles,
      candidate.primaryMuscles,
    );
    if (primaryRatio === 0) continue;

    const matchedOn: RankSignal[] = ["primary_muscles"];
    let score = RANK_WEIGHTS.primaryMuscles * primaryRatio;

    // NULL-safe by construction: the repository normalises both array columns to
    // `[]`, and `overlapRatio` returns 0 for an empty source rather than NaN.
    const secondaryRatio = overlapRatio(
      source.secondaryMuscles,
      candidate.secondaryMuscles,
    );
    if (secondaryRatio > 0) {
      score += RANK_WEIGHTS.secondaryMuscles * secondaryRatio;
      matchedOn.push("secondary_muscles");
    }

    const sourceLevel = difficultyIndex(source.difficultyLevel);
    const candidateLevel = difficultyIndex(candidate.difficultyLevel);
    // A null difficulty on either side scores nothing rather than matching:
    // `difficultyIndex` returns -1, so the gap is never 0 and only lands on the
    // adjacent tier when the other side is `beginner`.
    if (sourceLevel >= 0 && candidateLevel >= 0) {
      const gap = Math.abs(sourceLevel - candidateLevel);
      if (gap === 0) {
        score += RANK_WEIGHTS.sameDifficulty;
        matchedOn.push("difficulty");
      } else if (gap === 1) {
        // No `matchedOn` entry — "close enough on difficulty" is not something
        // worth telling the user, it only nudges the ordering (§ 6.2: "avoids
        // cliff-edge ranking").
        score += RANK_WEIGHTS.adjacentDifficulty;
      }
    }

    // ONE pattern signal, preferring `movement_type` and falling back to
    // `category` — never both, or a press-vs-press would score the 10 points
    // twice. See the file header: `movement_type` is null library-wide today, so
    // in practice this is the category branch.
    if (
      source.movementType !== null &&
      candidate.movementType === source.movementType
    ) {
      score += RANK_WEIGHTS.samePattern;
      matchedOn.push("movement_type");
    } else if (
      source.category !== null &&
      candidate.category === source.category
    ) {
      score += RANK_WEIGHTS.samePattern;
      matchedOn.push("category");
    }

    if (context.loggedExerciseIds.has(candidate.id)) {
      score += RANK_WEIGHTS.loggedBefore;
      matchedOn.push("logged_before");
    }

    ranked.push({ candidate, score, matchedOn });
  }

  return ranked.sort(
    (a, b) =>
      b.score - a.score || a.candidate.name.localeCompare(b.candidate.name),
  );
}
