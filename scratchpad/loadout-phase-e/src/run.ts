/**
 * Phase E · E2 runner.
 *
 *   bun scratchpad/loadout-phase-e/src/run.ts --stage=candidates
 *   bun scratchpad/loadout-phase-e/src/run.ts --stage=a
 *   AWS_PROFILE=ess-dev AWS_REGION=eu-west-2 \
 *     bun scratchpad/loadout-phase-e/src/run.ts --stage=b --model=haiku
 *     bun scratchpad/loadout-phase-e/src/run.ts --stage=c --model=haiku --perRow=25
 *   AWS_PROFILE=ess-dev AWS_REGION=eu-west-2 \
 *     bun scratchpad/loadout-phase-e/src/run.ts --stage=judge --left=armA --right=armC-haiku
 *   bun scratchpad/loadout-phase-e/src/run.ts --stage=report --model=haiku --judges=<file>,<file>
 *
 * ⚠ `ess-dev` only — Bedrock model grants are per-account, and this must never
 * run against production.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadLibrary, type Library } from "./library.ts";
import {
  CONTEXTS,
  WORKOUTS,
  type FixtureContext,
  type FixtureWorkout,
} from "./fixtures.ts";
import {
  assembleCandidates,
  buildPlan,
  verify,
  type AdaptedPlan,
} from "./pipeline.ts";
import { adaptWithRanker, shortlistCandidates } from "./armA.ts";
import { adaptWithModel, MODELS } from "./armB.ts";
import { judgePlans, JUDGE_MODEL } from "./judge.ts";
import {
  describeContext,
  fnv1a,
  renderPlan,
  scorePlan,
  type PlanMetrics,
} from "./metrics.ts";

const RESULTS_DIR = join(import.meta.dir, "..", "results");

type ArmResult = {
  key: string;
  workout: string;
  context: string;
  metrics: PlanMetrics;
  meta: Record<string, unknown>;
  rendered: string;
  error?: string;
};

function arg(name: string): string | undefined {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function fixtureKey(workout: FixtureWorkout, context: FixtureContext): string {
  return `${workout.key}::${context.key}`;
}

/**
 * Proxy for design § 6.2's "caller has logged it before" (+8) signal. The eval
 * has no session history, so the athlete's own corpus stands in: every exercise
 * appearing in the 20 fixture workouts counts as previously trained. Recorded as
 * an assumption in the verdict — in production this reads `session_exercises`.
 */
function loggedExerciseIds(library: Library): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const workout of WORKOUTS) {
    for (const row of workout.rows) {
      const exercise = library.byName.get(row.exercise);
      if (exercise) ids.add(exercise.id);
    }
  }
  return ids;
}

function prepare(library: Library) {
  return WORKOUTS.flatMap((workout) =>
    CONTEXTS.map((context) => {
      const plan = buildPlan(workout, context, library);
      const pool = assembleCandidates(plan, context, library);
      return {
        workout,
        context,
        plan,
        pool,
        key: fixtureKey(workout, context),
      };
    }),
  );
}

/** Bounded concurrency — Bedrock throttles, and 80 parallel calls would 429. */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await fn(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function write(name: string, data: unknown): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, name), `${JSON.stringify(data, null, 2)}\n`);
  console.log(`wrote results/${name}`);
}

function read<T>(name: string): T {
  return JSON.parse(readFileSync(join(RESULTS_DIR, name), "utf8")) as T;
}

function summarise(results: ArmResult[]): Record<string, number> {
  const ok = results.filter((row) => !row.error);
  const mean = (pick: (row: ArmResult) => number): number =>
    ok.length === 0
      ? 0
      : Number(
          (ok.reduce((sum, row) => sum + pick(row), 0) / ok.length).toFixed(3),
        );
  return {
    plans: results.length,
    errors: results.length - ok.length,
    equipmentLegalPlans: ok.filter((row) => row.metrics.equipmentLegal).length,
    meanMuscleFidelity: mean((row) => row.metrics.muscleFidelity),
    meanCategoryFidelity: mean((row) => row.metrics.categoryFidelity),
    totalUnresolved: ok.reduce((sum, row) => sum + row.metrics.unresolved, 0),
    totalDuplicatePicks: ok.reduce(
      (sum, row) => sum + row.metrics.duplicatePicks,
      0,
    ),
    totalNearDuplicatePairs: ok.reduce(
      (sum, row) => sum + row.metrics.nearDuplicatePairs,
      0,
    ),
    plansWithDroppedMuscles: ok.filter(
      (row) => row.metrics.musclesDropped.length > 0,
    ).length,
    meanLatencyMs: mean((row) => Number(row.meta.latencyMs ?? 0)),
    totalCostUsd: Number(
      ok
        .reduce((sum, row) => sum + Number(row.meta.costUsd ?? 0), 0)
        .toFixed(4),
    ),
  };
}

async function main(): Promise<void> {
  const stage = arg("stage") ?? "candidates";
  const modelKey = (arg("model") ?? "haiku") as keyof typeof MODELS;
  const modelId = MODELS[modelKey];
  const library = loadLibrary();
  const fixtures = prepare(library);
  const logged = loggedExerciseIds(library);

  if (stage === "candidates") {
    const rows = fixtures.map(({ key, plan, pool }) => ({
      key,
      rows: plan.length,
      needsSwap: plan.filter((row) => row.needsSwap).length,
      candidates: pool.candidates.length,
      truncated: pool.truncated,
      muscleUnion: pool.muscleUnion.length,
    }));
    const unmapped = library.exercises.filter(
      (e) => e.equipmentUnmapped.length > 0,
    );
    write("candidates.json", {
      libraryRows: library.exercises.length,
      rowsWithUnmappedEquipment: unmapped.map((e) => ({
        name: e.name,
        dropped: e.equipmentUnmapped,
        resolvedEquipment: e.equipmentRequired,
      })),
      fixtures: rows,
    });
    const totalSwaps = rows.reduce((sum, row) => sum + row.needsSwap, 0);
    console.log(
      `${rows.length} fixtures · ${totalSwaps} rows need a swap · ${rows.filter((r) => r.truncated > 0).length} pools truncated`,
    );
    return;
  }

  if (stage === "a") {
    const results: ArmResult[] = fixtures.map(
      ({ key, workout, context, plan, pool }) => {
        const adapted = adaptWithRanker(plan, pool, context, {
          equipmentTypeIds: context.equipment,
          loggedExerciseIds: logged,
        });
        const violations = verify(plan, adapted.rows, pool, context, library);
        return {
          key,
          workout: workout.name,
          context: context.key,
          metrics: scorePlan(plan, adapted, violations, context, library),
          meta: { ...adapted.meta, pool: describeContext(pool) },
          rendered: renderPlan(plan, adapted, library),
        };
      },
    );
    write("armA.json", { summary: summarise(results), results });
    console.log(summarise(results));
    return;
  }

  // Arm B = model over the full stage-1 pool. Arm C = the hybrid: the same model
  // over a deterministically ranked shortlist (design § 1's third option).
  if (stage === "b" || stage === "c") {
    const perRow = Number(arg("perRow") ?? 25);
    const results = await mapWithLimit(
      fixtures,
      4,
      async ({ key, workout, context, plan, pool: fullPool }) => {
        const pool =
          stage === "c"
            ? shortlistCandidates(
                plan,
                fullPool,
                {
                  equipmentTypeIds: context.equipment,
                  loggedExerciseIds: logged,
                },
                perRow,
              )
            : fullPool;
        try {
          const adapted: AdaptedPlan = await adaptWithModel(
            plan,
            pool,
            context,
            workout.name,
            {
              modelId,
            },
          );
          // Verification still runs against the FULL pool: a shortlist narrows what
          // the model may choose from, it does not widen what counts as legal.
          const violations = verify(
            plan,
            adapted.rows,
            fullPool,
            context,
            library,
          );
          return {
            key,
            workout: workout.name,
            context: context.key,
            metrics: scorePlan(plan, adapted, violations, context, library),
            meta: { ...adapted.meta, pool: describeContext(pool) },
            rendered: renderPlan(plan, adapted, library),
          } satisfies ArmResult;
        } catch (error) {
          console.error(
            `${key}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return {
            key,
            workout: workout.name,
            context: context.key,
            metrics: {
              equipmentLegal: false,
              violations: [],
              kept: 0,
              swapped: 0,
              unresolved: 0,
              muscleFidelity: 0,
              categoryFidelity: 0,
              duplicatePicks: 0,
              nearDuplicatePairs: 0,
              musclesDropped: [],
            },
            meta: { modelId },
            rendered: "",
            error: error instanceof Error ? error.message : String(error),
          } satisfies ArmResult;
        }
      },
    );
    const name = stage === "c" ? `armC-${modelKey}` : `armB-${modelKey}`;
    write(`${name}.json`, {
      modelId,
      shortlistPerRow: stage === "c" ? perRow : null,
      summary: summarise(results),
      results,
    });
    console.log(summarise(results));
    return;
  }

  if (stage === "judge") {
    // `left` and `right` are arm result files; the judge never sees which is which.
    const left = arg("left") ?? "armA";
    const right = arg("right") ?? `armB-${modelKey}`;
    const byKeyA = new Map(
      read<{ results: ArmResult[] }>(`${left}.json`).results.map((row) => [
        row.key,
        row,
      ]),
    );
    const byKeyB = new Map(
      read<{ results: ArmResult[] }>(`${right}.json`).results.map((row) => [
        row.key,
        row,
      ]),
    );

    // Skip fixtures where both arms produced a byte-identical plan — in practice
    // the whole `full_gym` context, where nothing needs swapping and both arms
    // emit the same all-KEPT plan. Judging those would add 20 forced ties and
    // bury the signal from the fixtures that actually differ.
    const identical = fixtures.filter(({ key }) => {
      const a = byKeyA.get(key);
      const b = byKeyB.get(key);
      return a && b && !a.error && !b.error && a.rendered === b.rendered;
    }).length;

    const judgeable = fixtures.filter(({ key }) => {
      const a = byKeyA.get(key);
      const b = byKeyB.get(key);
      return (
        a &&
        b &&
        !a.error &&
        !b.error &&
        a.rendered &&
        b.rendered &&
        a.rendered !== b.rendered
      );
    });
    console.log(
      `judging ${judgeable.length} fixtures · ${identical} identical (skipped)`,
    );

    const verdicts = await mapWithLimit(
      judgeable,
      3,
      async ({ key, workout, context, plan }) => {
        const a = byKeyA.get(key)!;
        const b = byKeyB.get(key)!;
        // Deterministic blind ordering: hash parity decides which arm is "PLAN ONE".
        const aIsFirst = fnv1a(key) % 2 === 0;
        const originalPlan = plan
          .map(
            (row) =>
              `${row.sortOrder}. ${row.source.name} — ${row.sets}×${row.repsMin}-${row.repsMax}${row.supersetGroup ? ` [superset ${row.supersetGroup}]` : ""}`,
          )
          .join("\n");
        try {
          const verdict = await judgePlans({
            workoutName: workout.name,
            equipment: context.equipment,
            originalPlan,
            planOne: aIsFirst ? a.rendered : b.rendered,
            planTwo: aIsFirst ? b.rendered : a.rendered,
          });
          const armAScore = aIsFirst ? verdict.planOne : verdict.planTwo;
          const armBScore = aIsFirst ? verdict.planTwo : verdict.planOne;
          const preferred =
            verdict.preference === "tie"
              ? "tie"
              : (verdict.preference === "one") === aIsFirst
                ? "armA"
                : "armB";
          return {
            key,
            armAFirst: aIsFirst,
            armAScore,
            armBScore,
            preferred,
            rationale: verdict.rationale,
          };
        } catch (error) {
          console.error(
            `judge ${key}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return {
            key,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );

    const ok = verdicts.filter(
      (v): v is Extract<typeof v, { armAScore: unknown }> => "armAScore" in v,
    );
    const mean = (pick: (v: (typeof ok)[number]) => number): number =>
      ok.length === 0
        ? 0
        : Number((ok.reduce((s, v) => s + pick(v), 0) / ok.length).toFixed(2));
    const summary = {
      judged: ok.length,
      failed: verdicts.length - ok.length,
      identicalPlansSkipped: identical,
      left,
      right,
      judgeModel: JUDGE_MODEL,
      [left]: {
        patternFidelity: mean((v) => v.armAScore.patternFidelity),
        coherence: mean((v) => v.armAScore.coherence),
        reasonQuality: mean((v) => v.armAScore.reasonQuality),
      },
      [right]: {
        patternFidelity: mean((v) => v.armBScore.patternFidelity),
        coherence: mean((v) => v.armBScore.coherence),
        reasonQuality: mean((v) => v.armBScore.reasonQuality),
      },
      preferredLeft: ok.filter((v) => v.preferred === "armA").length,
      preferredRight: ok.filter((v) => v.preferred === "armB").length,
      ties: ok.filter((v) => v.preferred === "tie").length,
    };
    write(`judge-${left}-vs-${right}.json`, { summary, verdicts });
    console.log(summary);
    return;
  }

  if (stage === "report") {
    const arms = (
      arg("arms") ?? `armA,armB-${modelKey},armC-${modelKey}`
    ).split(",");
    const judges = (arg("judges") ?? "").split(",").filter(Boolean);
    console.log(
      JSON.stringify(
        {
          objective: Object.fromEntries(
            arms.map((name) => [
              name,
              read<{ summary: unknown }>(`${name}.json`).summary,
            ]),
          ),
          judged: Object.fromEntries(
            judges.map((name) => [
              name,
              read<{ summary: unknown }>(`${name}.json`).summary,
            ]),
          ),
        },
        null,
        2,
      ),
    );
    return;
  }

  throw new Error(`unknown --stage=${stage}`);
}

await main();
