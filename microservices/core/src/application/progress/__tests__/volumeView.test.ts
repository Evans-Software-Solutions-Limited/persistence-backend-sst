import { describe, it, expect } from "vitest";
import {
  fillWeekDays,
  computeDeltaPct,
  withMusclePct,
  adherencePct,
  daysBetweenInclusive,
} from "../volumeView";

describe("fillWeekDays", () => {
  it("densifies a sparse list, flags today + rest days", () => {
    const days = fillWeekDays(
      [
        { date: "2026-06-08", volumeKg: 600 },
        { date: "2026-06-10", volumeKg: 900 },
      ],
      "2026-06-08",
      "2026-06-10",
    );
    expect(days).toEqual([
      { date: "2026-06-08", volumeKg: 600, isToday: false, isRest: false },
      { date: "2026-06-09", volumeKg: 0, isToday: false, isRest: true },
      { date: "2026-06-10", volumeKg: 900, isToday: true, isRest: false },
    ]);
  });

  it("a zero-volume today is not marked as rest", () => {
    const days = fillWeekDays([], "2026-06-10", "2026-06-10");
    expect(days).toEqual([
      { date: "2026-06-10", volumeKg: 0, isToday: true, isRest: false },
    ]);
  });
});

describe("computeDeltaPct", () => {
  it("computes rounded percentage change", () => {
    expect(computeDeltaPct(112, 100)).toBe(12);
    expect(computeDeltaPct(80, 100)).toBe(-20);
  });
  it("returns null with no prior baseline", () => {
    expect(computeDeltaPct(100, 0)).toBeNull();
  });
});

describe("withMusclePct", () => {
  it("normalises each muscle to the largest", () => {
    expect(
      withMusclePct([
        { muscle: "legs", kg: 14460 },
        { muscle: "chest", kg: 7230 },
      ]),
    ).toEqual([
      { muscle: "legs", kg: 14460, pct: 1 },
      { muscle: "chest", kg: 7230, pct: 0.5 },
    ]);
  });
  it("handles an empty / all-zero set", () => {
    expect(withMusclePct([])).toEqual([]);
    expect(withMusclePct([{ muscle: "x", kg: 0 }])).toEqual([
      { muscle: "x", kg: 0, pct: 0 },
    ]);
  });
});

describe("adherencePct", () => {
  it("completed / planned, capped at 100", () => {
    // 18 done, target 4/wk over 30 days ≈ 17.1 plan → ~100%
    expect(adherencePct(18, 4, 30)).toBe(100);
    expect(adherencePct(4, 4, 7)).toBe(100);
    expect(adherencePct(2, 4, 7)).toBe(50);
  });
  it("returns null for a non-positive plan", () => {
    expect(adherencePct(5, 0, 30)).toBeNull();
    expect(adherencePct(5, 4, 0)).toBeNull();
  });
});

describe("daysBetweenInclusive", () => {
  it("counts inclusive days", () => {
    expect(daysBetweenInclusive("2026-06-01", "2026-06-30")).toBe(30);
    expect(daysBetweenInclusive("2026-06-10", "2026-06-10")).toBe(1);
  });
});
