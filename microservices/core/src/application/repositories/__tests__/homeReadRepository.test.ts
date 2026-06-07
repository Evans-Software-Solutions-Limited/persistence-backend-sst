/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@persistence/db/client";
import { HomeReadRepository } from "../homeReadRepository";

function chain(result: unknown) {
  const c: any = {};
  for (const k of ["from", "innerJoin", "where", "orderBy", "limit"]) {
    c[k] = () => c;
  }
  c.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
  return c;
}

describe("HomeReadRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getTodaySteps sums today's steps, 0 when none", async () => {
    (getDb as any).mockReturnValue({ select: () => chain([{ s: 7420 }]) });
    expect(
      await new HomeReadRepository().getTodaySteps("u1", "2026-06-10"),
    ).toBe(7420);
    (getDb as any).mockReturnValue({ select: () => chain([]) });
    expect(
      await new HomeReadRepository().getTodaySteps("u1", "2026-06-10"),
    ).toBe(0);
  });

  it("getActiveWorkoutStreakCount returns the count or 0", async () => {
    (getDb as any).mockReturnValue({ select: () => chain([{ c: 23 }]) });
    expect(
      await new HomeReadRepository().getActiveWorkoutStreakCount("u1"),
    ).toBe(23);
    (getDb as any).mockReturnValue({ select: () => chain([]) });
    expect(
      await new HomeReadRepository().getActiveWorkoutStreakCount("u1"),
    ).toBe(0);
  });

  it("getRecentPRs maps rows + ISO-formats achievedAt", async () => {
    (getDb as any).mockReturnValue({
      select: () =>
        chain([
          {
            id: "pr1",
            exerciseId: "e1",
            exerciseName: "Bench Press",
            recordType: "1rm",
            value: "100.00",
            achievedAt: new Date("2026-06-07T10:00:00Z"),
          },
        ]),
    });
    const prs = await new HomeReadRepository().getRecentPRs("u1", 5);
    expect(prs[0]).toEqual({
      id: "pr1",
      exerciseId: "e1",
      exerciseName: "Bench Press",
      recordType: "1rm",
      value: 100,
      achievedAt: "2026-06-07T10:00:00.000Z",
    });
  });

  it("getAchievements maps rows + handles null requirements/unlockedAt", async () => {
    (getDb as any).mockReturnValue({
      select: () =>
        chain([
          {
            id: "ua1",
            achievementId: "a1",
            name: "Workout Streak — 4 weeks",
            description: null,
            category: "streak",
            requirements: { streak_type: "workout_streak", threshold: 4 },
            unlockedAt: null,
          },
        ]),
    });
    const rows = await new HomeReadRepository().getAchievements("u1");
    expect(rows[0]).toMatchObject({
      achievementId: "a1",
      category: "streak",
      requirements: { threshold: 4 },
      unlockedAt: null,
    });
  });

  it("getBodyTrend maps series with date + numeric/null fields", async () => {
    (getDb as any).mockReturnValue({
      select: () =>
        chain([
          {
            measuredAt: new Date("2026-06-01T08:00:00Z"),
            weightKg: "82.50",
            bodyFat: null,
          },
        ]),
    });
    const series = await new HomeReadRepository().getBodyTrend("u1", 30);
    expect(series[0]).toEqual({
      date: "2026-06-01",
      weightKg: 82.5,
      bodyFat: null,
    });
  });
});
