/**
 * Recompute every headline figure the verdict quotes, from the committed
 * `results/` dataset, with the corrected metric definitions.
 *
 *   bun scratchpad/loadout-phase-e/src/resummarise.ts
 *
 * Why this exists: the first pass hand-derived the latency/cost/token table and
 * averaged fidelity over all 80 fixtures including the 22 that need no swap (a
 * fiat 1.0 that cannot fail). Both were wrong in the published tables — Inspector
 * Brad caught it. This makes the numbers a command rather than arithmetic in a
 * document, and it does so **without re-calling Bedrock**: the per-fixture data
 * needed is already in `results/`.
 *
 * `nearDuplicatePairs` is recomputed here rather than read, because the stored
 * value was produced by the asymmetric subset test that has since been fixed. It
 * is derived from the picks parsed back out of each plan's rendered text.
 *
 * Every figure printed here is reproducible offline and free.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loadLibrary, type Exercise } from "./library.ts";

const RESULTS_DIR = join(import.meta.dir, "..", "results");

type StoredMetrics = {
  equipmentLegal: boolean;
  kept: number;
  swapped: number;
  unresolved: number;
  muscleFidelity: number | null;
  categoryFidelity: number | null;
  duplicatePicks: number;
  nearDuplicatePairs: number;
  musclesDropped: string[];
};

type StoredResult = {
  key: string;
  context: string;
  metrics: StoredMetrics;
  meta: Record<string, unknown>;
  rendered: string;
  error?: string;
};

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

/** Pull the chosen exercise of every SWAPPED row back out of a rendered plan. */
function parsePicks(
  rendered: string,
  byName: Map<string, Exercise>,
): Exercise[] {
  const picks: Exercise[] = [];
  for (const line of rendered.split("\n")) {
    const head = line.split(" — ")[0];
    if (!head.includes("SWAPPED")) continue;
    const arrow = head.split(" → ");
    if (arrow.length !== 2) continue;
    const chosen = byName.get(arrow[1].trim());
    if (chosen) picks.push(chosen);
  }
  return picks;
}

function symmetricNearDuplicatePairs(picks: Exercise[]): number {
  let pairs = 0;
  for (let i = 0; i < picks.length; i += 1) {
    for (let j = i + 1; j < picks.length; j += 1) {
      const a = picks[i];
      const b = picks[j];
      let shared = 0;
      const tokensB = nameTokens(b.name);
      for (const token of nameTokens(a.name))
        if (tokensB.has(token)) shared += 1;
      const subset =
        (a.primaryMuscles.length > 0 &&
          a.primaryMuscles.every((m) => b.primaryMuscles.includes(m))) ||
        (b.primaryMuscles.length > 0 &&
          b.primaryMuscles.every((m) => a.primaryMuscles.includes(m)));
      if (shared >= 2 && subset) pairs += 1;
    }
  }
  return pairs;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ];
}

function round(value: number, places: number): number {
  return Number(value.toFixed(places));
}

function summariseArm(file: string, byName: Map<string, Exercise>) {
  const data = JSON.parse(readFileSync(join(RESULTS_DIR, file), "utf8")) as {
    results: StoredResult[];
  };
  const all = data.results;
  const ok = all.filter((row) => !row.error);
  const swapBearing = ok.filter((row) => row.metrics.swapped > 0);
  const n = swapBearing.length;

  const mean = (pick: (row: StoredResult) => number): number =>
    n === 0 ? 0 : swapBearing.reduce((sum, row) => sum + pick(row), 0) / n;
  const num = (row: StoredResult, key: string): number =>
    Number(row.meta[key] ?? 0);

  const latency = swapBearing
    .map((row) => num(row, "latencyMs"))
    .sort((a, b) => a - b);
  const costs = swapBearing.map((row) => num(row, "costUsd"));
  const picksByFixture = ok.map((row) => parsePicks(row.rendered, byName));

  return {
    file,
    plans: all.length,
    errors: all.length - ok.length,
    // Structurally guaranteed by stages 1 and 3 — see VERDICT-E2 § Limitations.
    equipmentLegalPlans: all.filter((row) => row.metrics.equipmentLegal).length,
    swapBearingPlans: n,
    swappedRows: ok.reduce((sum, row) => sum + row.metrics.swapped, 0),
    // Over swap-bearing plans only: a plan with no swaps has no fidelity to report.
    meanMuscleFidelity: round(
      mean((row) => row.metrics.muscleFidelity ?? 0),
      3,
    ),
    meanCategoryFidelity: round(
      mean((row) => row.metrics.categoryFidelity ?? 0),
      3,
    ),
    totalUnresolved: ok.reduce((sum, row) => sum + row.metrics.unresolved, 0),
    totalDuplicatePicks: ok.reduce(
      (sum, row) => sum + row.metrics.duplicatePicks,
      0,
    ),
    // Recomputed symmetrically; the stored value used the fixed asymmetric test.
    nearDuplicatePairsSymmetric: picksByFixture.reduce(
      (sum, picks) => sum + symmetricNearDuplicatePairs(picks),
      0,
    ),
    plansWithDroppedMuscles: ok.filter(
      (row) => row.metrics.musclesDropped.length > 0,
    ).length,
    // Runs that actually selected at least one id — the honest denominator for
    // the "zero non-member ids" claim.
    runsThatSelectedIds: picksByFixture.filter((picks) => picks.length > 0)
      .length,
    idsSelected: picksByFixture.reduce((sum, picks) => sum + picks.length, 0),
    latencyP50Ms: percentile(latency, 0.5),
    latencyP90Ms: percentile(latency, 0.9),
    latencyMaxMs: latency.length === 0 ? 0 : latency[latency.length - 1],
    meanInputTokens: Math.round(mean((row) => num(row, "inputTokens"))),
    meanOutputTokens: Math.round(mean((row) => num(row, "outputTokens"))),
    meanCandidateCount: Math.round(mean((row) => num(row, "candidateCount"))),
    costPerAdaptationUsd: round(
      mean((row) => num(row, "costUsd")),
      5,
    ),
    maxCostUsd: costs.length === 0 ? 0 : round(Math.max(...costs), 5),
    totalCostUsd: round(
      ok.reduce((sum, row) => sum + num(row, "costUsd"), 0),
      4,
    ),
  };
}

const library = loadLibrary();
const arms = ["armA.json", "armB-haiku.json", "armC-haiku.json"].map((file) =>
  summariseArm(file, library.byName),
);
console.log(JSON.stringify(arms, null, 2));
