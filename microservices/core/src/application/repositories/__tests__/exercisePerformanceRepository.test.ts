/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
import { getDb } from "@persistence/db/client";
import {
  estimateOneRepMax,
  ExercisePerformanceRepository,
  isClearlyAssistedExerciseName,
} from "../exercisePerformanceRepository";

describe("estimateOneRepMax", () => {
  it("uses actual load for one rep and Epley for 2-10", () => {
    expect(estimateOneRepMax(120, 1)).toBe(120);
    expect(estimateOneRepMax(120, 6)).toBe(144);
  });
  it.each([
    [0, 5],
    [-1, 5],
    [100, 0],
    [100, 11],
    [100, 2.5],
  ])("rejects non-qualifying input %s x %s", (weight, reps) =>
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

describe("ExercisePerformanceRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a compact best-set payload and scopes SQL by user/exercise", async () => {
    let where: unknown;
    const chain: any = {};
    for (const key of ["from", "innerJoin", "orderBy"])
      chain[key] = vi.fn(() => chain);
    chain.where = vi.fn((value) => {
      where = value;
      return chain;
    });
    chain.limit = vi.fn(async () => [
      {
        weightKg: "120.00",
        reps: 6,
        estimateKg: "144.00",
        completedAt: new Date("2026-08-01T10:00:00Z"),
      },
    ]);
    (getDb as any).mockReturnValue({ select: vi.fn(() => chain) });
    const out =
      await new ExercisePerformanceRepository().getBestEstimatedOneRepMax(
        "user-a",
        "exercise-a",
      );
    expect(out).toEqual({
      estimateKg: 144,
      source: {
        weightKg: 120,
        reps: 6,
        completedAt: "2026-08-01T10:00:00.000Z",
      },
    });
    const query = new PgDialect().sqlToQuery(where as never);
    expect(query.params).toContain("user-a");
    expect(query.params).toContain("exercise-a");
    expect(query.sql).toContain("is_completed");
    expect(query.sql).toContain('"weight_kg" > $');
    expect(query.sql).toContain("assisted");
    expect(query.sql).toContain("banded dip");
  });

  it("returns null with no qualifying set", async () => {
    const chain: any = {};
    for (const key of ["from", "innerJoin", "where", "orderBy"])
      chain[key] = vi.fn(() => chain);
    chain.limit = vi.fn(async () => []);
    (getDb as any).mockReturnValue({ select: vi.fn(() => chain) });
    expect(
      await new ExercisePerformanceRepository().getBestEstimatedOneRepMax(
        "user-a",
        "exercise-a",
      ),
    ).toBeNull();
  });

  it("accepts a string completion timestamp from the driver", async () => {
    const chain: any = {};
    for (const key of ["from", "innerJoin", "where", "orderBy"])
      chain[key] = vi.fn(() => chain);
    chain.limit = vi.fn(async () => [
      {
        weightKg: "80",
        reps: 1,
        estimateKg: "80",
        completedAt: "2026-08-02T10:00:00.000Z",
      },
    ]);
    (getDb as any).mockReturnValue({ select: vi.fn(() => chain) });
    expect(
      await new ExercisePerformanceRepository().getBestEstimatedOneRepMax(
        "user-a",
        "exercise-a",
      ),
    ).toMatchObject({ source: { completedAt: "2026-08-02T10:00:00.000Z" } });
  });

  it("fails closed on a malformed selected row", async () => {
    const chain: any = {};
    for (const key of ["from", "innerJoin", "where", "orderBy"])
      chain[key] = vi.fn(() => chain);
    chain.limit = vi.fn(async () => [
      { weightKg: null, reps: 5, estimateKg: "100", completedAt: new Date() },
    ]);
    (getDb as any).mockReturnValue({ select: vi.fn(() => chain) });
    expect(
      await new ExercisePerformanceRepository().getBestEstimatedOneRepMax(
        "user-a",
        "exercise-a",
      ),
    ).toBeNull();
  });
});
