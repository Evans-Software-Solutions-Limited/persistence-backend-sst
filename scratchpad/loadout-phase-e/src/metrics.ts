/**
 * Phase E · T-E2.4 (objective half) — programmatic rubric.
 *
 * Everything that can be decided without judgment is decided here, so the blind
 * judge only scores what actually needs a reader: pattern fidelity, whole-plan
 * coherence and reason quality.
 *
 * `equipmentLegal` is the HARD pass/fail: one illegal row fails the whole plan.
 */

import { isLegal, type Exercise, type Library } from "./library.ts";
import type {
  AdaptedPlan,
  CandidatePool,
  PlanRow,
  Violation,
} from "./pipeline.ts";
import type { FixtureContext } from "./fixtures.ts";

const NAME_STOPWORDS = new Set([
  "the",
  "and",
  "with",
  "to",
  "a",
  "of",
  "on",
  "single",
  "one",
  "arm",
  "leg",
  "double",
]);

function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((token) => token.length > 2 && !NAME_STOPWORDS.has(token)),
  );
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let hits = 0;
  for (const token of a) if (b.has(token)) hits += 1;
  return hits;
}

export type PlanMetrics = {
  /** HARD gate. False if any row is illegal, unknown, mutated or missing. */
  equipmentLegal: boolean;
  violations: Violation[];
  kept: number;
  swapped: number;
  unresolved: number;
  /**
   * Mean over swapped rows of |∩ primary| / |source primary| (0–1), or **null**
   * when the plan has no swapped rows. Deliberately not `1`: 22 of the 80
   * fixtures need no swap at all, and a fiat 1.0 there is a value that cannot
   * fail — averaging it in compressed every arm's gap toward zero and misstated
   * three published figures (IB sweep 1, 2026-07-26).
   */
  muscleFidelity: number | null;
  /** Fraction of swapped rows whose `category` matches the source's; null when none. */
  categoryFidelity: number | null;
  /** Exercise ids appearing more than once in the adapted plan. */
  duplicatePicks: number;
  /**
   * Pairs of swapped picks sharing ≥2 significant name tokens — the
   * "five dumbbell presses in a row" failure the rubric asks about, detectable
   * without a reader.
   */
  nearDuplicatePairs: number;
  /** Primary muscles the parent plan covered and the adapted plan does not. */
  musclesDropped: string[];
};

export function scorePlan(
  plan: PlanRow[],
  adapted: AdaptedPlan,
  violations: Violation[],
  context: FixtureContext,
  library: Library,
): PlanMetrics {
  const equipment = new Set(context.equipment);
  const bySortOrder = new Map(plan.map((row) => [row.sortOrder, row]));

  let kept = 0;
  let swapped = 0;
  let unresolved = 0;
  let muscleSum = 0;
  let categoryHits = 0;
  const picks: Exercise[] = [];
  const idCounts = new Map<string, number>();
  const coveredMuscles = new Set<string>();

  for (const row of adapted.rows) {
    if (row.exerciseId) {
      idCounts.set(row.exerciseId, (idCounts.get(row.exerciseId) ?? 0) + 1);
      const exercise = library.byId.get(row.exerciseId);
      if (exercise)
        for (const muscle of exercise.primaryMuscles)
          coveredMuscles.add(muscle);
    }

    if (row.status === "kept") {
      kept += 1;
      continue;
    }
    if (row.status === "unresolved") {
      unresolved += 1;
      continue;
    }

    swapped += 1;
    const source = bySortOrder.get(row.sortOrder)?.source;
    const chosen = row.exerciseId
      ? library.byId.get(row.exerciseId)
      : undefined;
    if (!source || !chosen) continue;

    picks.push(chosen);
    const sourcePrimary = source.primaryMuscles;
    if (sourcePrimary.length > 0) {
      const chosenSet = new Set(chosen.primaryMuscles);
      muscleSum +=
        sourcePrimary.filter((m) => chosenSet.has(m)).length /
        sourcePrimary.length;
    }
    if (chosen.category === source.category) categoryHits += 1;
  }

  let nearDuplicatePairs = 0;
  for (let i = 0; i < picks.length; i += 1) {
    for (let j = i + 1; j < picks.length; j += 1) {
      const shared = overlapCount(
        nameTokens(picks[i].name),
        nameTokens(picks[j].name),
      );
      // Symmetric on purpose: either primary set being a subset of the other
      // counts. An i ⊆ j test alone made detection depend on which row each pick
      // landed on, undercounting arm B by 2 (IB sweep 1, 2026-07-26).
      const samePrimary =
        (picks[i].primaryMuscles.length > 0 &&
          picks[i].primaryMuscles.every((m) =>
            picks[j].primaryMuscles.includes(m),
          )) ||
        (picks[j].primaryMuscles.length > 0 &&
          picks[j].primaryMuscles.every((m) =>
            picks[i].primaryMuscles.includes(m),
          ));
      if (shared >= 2 && samePrimary) nearDuplicatePairs += 1;
    }
  }

  const parentMuscles = new Set<string>();
  for (const row of plan)
    for (const muscle of row.source.primaryMuscles) parentMuscles.add(muscle);
  const musclesDropped = [...parentMuscles]
    .filter((m) => !coveredMuscles.has(m))
    .sort();

  const illegalRows = adapted.rows.filter((row) => {
    if (row.status !== "swapped" || !row.exerciseId) return false;
    const chosen = library.byId.get(row.exerciseId);
    return !chosen || !isLegal(chosen, equipment);
  });

  return {
    equipmentLegal: violations.length === 0 && illegalRows.length === 0,
    violations,
    kept,
    swapped,
    unresolved,
    muscleFidelity: swapped > 0 ? muscleSum / swapped : null,
    categoryFidelity: swapped > 0 ? categoryHits / swapped : null,
    duplicatePicks: [...idCounts.values()].filter((count) => count > 1).length,
    nearDuplicatePairs,
    musclesDropped,
  };
}

/** Human-readable plan rendering — the artefact the blind judge scores. */
export function renderPlan(
  plan: PlanRow[],
  adapted: AdaptedPlan,
  library: Library,
): string {
  const bySortOrder = new Map(plan.map((row) => [row.sortOrder, row]));
  return adapted.rows
    .map((row) => {
      const source = bySortOrder.get(row.sortOrder)?.source;
      const chosen = row.exerciseId
        ? library.byId.get(row.exerciseId)
        : undefined;
      const target = `${row.sets}×${row.repsMin}-${row.repsMax}`;
      const superset = row.supersetGroup
        ? ` [superset ${row.supersetGroup}]`
        : "";
      if (row.status === "kept") {
        return `${row.sortOrder}. KEPT      ${chosen?.name ?? "?"} — ${target}${superset} — ${row.reason}`;
      }
      if (row.status === "unresolved") {
        return `${row.sortOrder}. UNRESOLVED (was ${source?.name ?? "?"}) — ${target}${superset} — ${row.reason}`;
      }
      return `${row.sortOrder}. SWAPPED   ${source?.name ?? "?"} → ${chosen?.name ?? "?"} — ${target}${superset} — ${row.reason}`;
    })
    .join("\n");
}

/** Deterministic blind ordering — no Math.random, so a re-run is reproducible. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function describeContext(pool: CandidatePool): string {
  return `${pool.candidates.length} candidates${pool.truncated > 0 ? ` (+${pool.truncated} truncated by the LIMIT 400 cap)` : ""}`;
}
