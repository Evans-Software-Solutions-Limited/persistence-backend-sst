/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
import { getDb } from "@persistence/db/client";
import {
  estimateOneRepMax,
  estimateTenRepMax,
  ExercisePerformanceRepository,
  isClearlyAssistedExerciseName,
} from "../exercisePerformanceRepository";

describe("performance estimators", () => {
  it("uses actual load for one rep and Epley for 2-10", () => {
    expect(estimateOneRepMax(120, 1)).toBe(120);
    expect(estimateOneRepMax(120, 6)).toBe(144);
  });

  it("projects ten reps by reversing Epley", () => {
    expect(estimateTenRepMax(160)).toBe(120);
    expect(estimateTenRepMax(0)).toBeNull();
    expect(estimateTenRepMax(Number.NaN)).toBeNull();
  });

  it.each([
    [0, 5],
    [-1, 5],
    [100, 0],
    [100, 11],
    [100, 2.5],
  ])("rejects non-qualifying 1RM input %s x %s", (weight, reps) =>
    expect(estimateOneRepMax(weight, reps)).toBeNull(),
  );
});

describe("isClearlyAssistedExerciseName", () => {
  it.each(["Banded Dip", "Band-Assisted Chin-Up", "Assisted Chin-Up"])(
    "excludes assisted seed exercise %s",
    (name) => expect(isClearlyAssistedExerciseName(name)).toBe(true),
  );

  it.each(["Banded Crunch", "Banded Split Jerk", "Single-Arm Banded Press"])(
    "keeps resistance-band exercise %s eligible",
    (name) => expect(isClearlyAssistedExerciseName(name)).toBe(false),
  );
});

function mockAggregateRow(row: Record<string, unknown>) {
  let where: unknown;
  let selection: Record<string, unknown> | undefined;
  const chain: any = {};
  for (const key of ["from", "innerJoin", "where"])
    chain[key] = vi.fn((value) => {
      if (key === "where") where = value;
      return chain;
    });
  chain.limit = vi.fn(async () => [row]);
  (getDb as any).mockReturnValue({
    select: vi.fn((value) => {
      selection = value;
      return chain;
    }),
  });
  return {
    getWhere: () => where,
    getSelection: () => selection,
  };
}

describe("ExercisePerformanceRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns all initial summary metrics from one user/exercise-scoped query", async () => {
    const query = mockAggregateRow({
      qualifyingSetCount: "4",
      estimatedOneRepMaxKg: "160.00",
      oneRepSourceWeightKg: "120.00",
      oneRepSourceReps: 10,
      oneRepSourceCompletedAt: new Date("2026-08-01T10:00:00Z"),
      tenRepMaxKg: "120.00",
      tenRepMaxCompletedAt: new Date("2026-08-01T10:00:00Z"),
      heaviestSetWeightKg: "180.00",
      heaviestSetSourceReps: 4,
      heaviestSetSourceCompletedAt: new Date("2026-08-03T10:00:00Z"),
      bestSetVolumeKg: "1200.00",
      bestVolumeSourceWeightKg: "120.00",
      bestVolumeSourceReps: 10,
      bestVolumeSourceCompletedAt: new Date("2026-08-01T10:00:00Z"),
      lifetimeVolumeKg: "3650.00",
    });

    const out = await new ExercisePerformanceRepository().getSummary(
      "user-a",
      "exercise-a",
    );

    const source = {
      weightKg: 120,
      reps: 10,
      completedAt: "2026-08-01T10:00:00.000Z",
    };
    expect(out).toEqual({
      estimatedOneRepMax: { estimateKg: 160, source },
      estimatedTenRepMax: { estimateKg: 120, source },
      tenRepMax: { weightKg: 120, source },
      heaviestSet: {
        weightKg: 180,
        source: {
          weightKg: 180,
          reps: 4,
          completedAt: "2026-08-03T10:00:00.000Z",
        },
      },
      bestSetVolume: { volumeKg: 1200, source },
      lifetimeVolumeKg: 3650,
    });

    const whereSql = new PgDialect().sqlToQuery(query.getWhere() as never);
    expect(whereSql.params).toContain("user-a");
    expect(whereSql.params).toContain("exercise-a");
    expect(whereSql.sql).toContain("is_completed");
    expect(whereSql.sql).toContain('"weight_kg" > $');
    expect(whereSql.sql).toContain("assisted");
    expect(whereSql.sql).toContain("banded dip");

    const selectionSql = Object.values(query.getSelection() ?? {})
      .map((value) => new PgDialect().sqlToQuery(value as never).sql)
      .join(" ");
    expect(selectionSql).toContain("between 1 and 10");
    expect(selectionSql).toContain("sum(");
    expect(selectionSql).toContain("array_agg");
  });

  it("keeps volume stats when only sets above ten reps exist", async () => {
    mockAggregateRow({
      qualifyingSetCount: 1,
      estimatedOneRepMaxKg: null,
      oneRepSourceWeightKg: null,
      oneRepSourceReps: null,
      oneRepSourceCompletedAt: null,
      tenRepMaxKg: null,
      tenRepMaxCompletedAt: null,
      heaviestSetWeightKg: "50",
      heaviestSetSourceReps: 20,
      heaviestSetSourceCompletedAt: "2026-08-02T10:00:00.000Z",
      bestSetVolumeKg: "1000",
      bestVolumeSourceWeightKg: "50",
      bestVolumeSourceReps: 20,
      bestVolumeSourceCompletedAt: "2026-08-02T10:00:00.000Z",
      lifetimeVolumeKg: "1000",
    });

    expect(
      await new ExercisePerformanceRepository().getSummary("user-a", "ex-a"),
    ).toEqual({
      estimatedOneRepMax: null,
      estimatedTenRepMax: null,
      tenRepMax: null,
      heaviestSet: {
        weightKg: 50,
        source: {
          weightKg: 50,
          reps: 20,
          completedAt: "2026-08-02T10:00:00.000Z",
        },
      },
      bestSetVolume: {
        volumeKg: 1000,
        source: {
          weightKg: 50,
          reps: 20,
          completedAt: "2026-08-02T10:00:00.000Z",
        },
      },
      lifetimeVolumeKg: 1000,
    });
  });

  it("returns null with no qualifying set", async () => {
    mockAggregateRow({ qualifyingSetCount: "0" });
    expect(
      await new ExercisePerformanceRepository().getSummary("user-a", "ex-a"),
    ).toBeNull();
  });

  it("fails closed when required aggregate provenance is malformed", async () => {
    mockAggregateRow({
      qualifyingSetCount: 1,
      bestSetVolumeKg: "500",
      bestVolumeSourceWeightKg: null,
      bestVolumeSourceReps: 5,
      bestVolumeSourceCompletedAt: new Date(),
      lifetimeVolumeKg: "500",
    });
    expect(
      await new ExercisePerformanceRepository().getSummary("user-a", "ex-a"),
    ).toBeNull();
  });
});
