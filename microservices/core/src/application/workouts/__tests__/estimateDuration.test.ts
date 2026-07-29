import { describe, it, expect } from "vitest";
import {
  estimateWorkoutDurationMinutes,
  resolveEstimatedDurationMinutes,
  EMPTY_PLAN_DURATION_MINUTES,
  WORK_PER_SET_SECONDS,
  REST_BETWEEN_GROUPS_SECONDS,
  FALLBACK_SETS,
  FALLBACK_REST_SECONDS,
} from "../estimateDuration";

/**
 * Spreads `over` LAST rather than using `??` per field — an explicit `null` is
 * a case under test (the schema's nullable columns), and `?? 3` would silently
 * turn it back into a number.
 */
const ex = (
  sortOrder: number,
  over: {
    supersetGroup?: number | null;
    targetSets?: number | null;
    restSeconds?: number | null;
  } = {},
) => ({
  sortOrder,
  supersetGroup: null,
  targetSets: 3 as number | null,
  restSeconds: 60 as number | null,
  ...over,
});

describe("estimateWorkoutDurationMinutes", () => {
  it("returns 0 for an empty plan", () => {
    expect(estimateWorkoutDurationMinutes([])).toBe(0);
  });

  it("costs one standalone exercise as work + intra-set rest, rounded up to 5", () => {
    // 3 sets × 75s = 225s work, 2 gaps × 60s = 120s rest → 345s = 5.75min → 10
    expect(estimateWorkoutDurationMinutes([ex(0)])).toBe(10);
  });

  it("adds rest BETWEEN groups but not after the last one", () => {
    const one = estimateWorkoutDurationMinutes([ex(0)]);
    const two = estimateWorkoutDurationMinutes([ex(0), ex(1)]);
    // Two standalone blocks = 2× the work/rest plus exactly ONE inter-group gap.
    // 2×345 + 120 = 810s = 13.5min → 15
    expect(two).toBe(15);
    expect(one).toBe(10);
  });

  it("charges no inter-group rest between members of the same superset", () => {
    const superset = estimateWorkoutDurationMinutes([
      ex(0, { supersetGroup: 1 }),
      ex(1, { supersetGroup: 1 }),
    ]);
    const standalone = estimateWorkoutDurationMinutes([ex(0), ex(1)]);
    // Same work, one fewer 120s gap → 690s = 11.5min → 15 vs 15. Compare the
    // raw relationship instead of the rounded value, which hides the gap here.
    expect(superset).toBeLessThanOrEqual(standalone);
    // Three supersetted rows stay ONE group: 3×345 = 1035s = 17.25min → 20,
    // whereas three standalone rows add two gaps (1035 + 240 = 1275s → 25).
    expect(
      estimateWorkoutDurationMinutes([
        ex(0, { supersetGroup: 1 }),
        ex(1, { supersetGroup: 1 }),
        ex(2, { supersetGroup: 1 }),
      ]),
    ).toBe(20);
    expect(estimateWorkoutDurationMinutes([ex(0), ex(1), ex(2)])).toBe(25);
  });

  it("estimates a realistic 7-exercise session well above the old flat 30", () => {
    // The reported bug: 7 exercises, 4 sets, 90s rest — stored as "30 min".
    const plan = Array.from({ length: 7 }, (_, i) =>
      ex(i, { targetSets: 4, restSeconds: 90 }),
    );
    // per exercise: 4×75 + 3×90 = 570s; ×7 = 3990s; + 6×120 = 4710s
    // = 78.5min → 80
    expect(estimateWorkoutDurationMinutes(plan)).toBe(80);
  });

  it("falls back for null sets/rest instead of costing them as zero", () => {
    const [row] = [ex(0, { targetSets: null, restSeconds: null })];
    // 1 set × 75s, no intra-set gaps → 75s → 2min → 5
    expect(estimateWorkoutDurationMinutes([row])).toBe(5);
    expect(FALLBACK_SETS).toBe(1);
    expect(FALLBACK_REST_SECONDS).toBe(90);
  });

  it("never charges negative rest for a single-set exercise", () => {
    // 1 set → max(0, 1-1) = 0 intra-set gaps, so a huge rest value is unused.
    expect(
      estimateWorkoutDurationMinutes([
        ex(0, { targetSets: 1, restSeconds: 600 }),
      ]),
    ).toBe(5);
  });

  it("keeps the legacy heuristic's constants", () => {
    expect(WORK_PER_SET_SECONDS).toBe(75);
    expect(REST_BETWEEN_GROUPS_SECONDS).toBe(120);
  });

  it("groups standalone rows by sortOrder so identical configs stay separate", () => {
    // Two rows with the same shape but different sortOrder are two groups, so
    // they must cost MORE than one row (a Map keyed on the wrong field would
    // collapse them).
    expect(estimateWorkoutDurationMinutes([ex(0), ex(1)])).toBeGreaterThan(
      estimateWorkoutDurationMinutes([ex(0)]),
    );
  });
});

describe("resolveEstimatedDurationMinutes", () => {
  it("prefers an explicit caller-supplied duration over the estimate", () => {
    expect(resolveEstimatedDurationMinutes(45, [ex(0), ex(1), ex(2)])).toBe(45);
  });

  it("honours an explicit 0 rather than treating it as absent", () => {
    expect(resolveEstimatedDurationMinutes(0, [ex(0)])).toBe(0);
  });

  it("derives from the plan when no duration is supplied", () => {
    expect(resolveEstimatedDurationMinutes(undefined, [ex(0)])).toBe(10);
  });

  it("stores the column default when there is no plan to estimate from", () => {
    // NOT the estimator's 0 — `POST /workouts` accepts a workout with no
    // exercises, and "0m" in the card is a worse lie than the old flat 30 when
    // we genuinely have nothing to measure.
    expect(resolveEstimatedDurationMinutes(undefined, undefined)).toBe(
      EMPTY_PLAN_DURATION_MINUTES,
    );
    expect(resolveEstimatedDurationMinutes(undefined, [])).toBe(
      EMPTY_PLAN_DURATION_MINUTES,
    );
    expect(EMPTY_PLAN_DURATION_MINUTES).toBe(30);
  });
});
