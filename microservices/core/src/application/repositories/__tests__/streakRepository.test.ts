/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserStreak } from "@persistence/db";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";
import { StreakRepository } from "../streakRepository";

// Chain builders matching each method's Drizzle call depth.
const selectWhere = (val: unknown) => ({
  from: () => ({ where: () => Promise.resolve(val) }),
});
const selectWhereLimit = (val: unknown) => ({
  from: () => ({ where: () => ({ limit: () => Promise.resolve(val) }) }),
});
const updateChain = (val: unknown) => ({
  set: () => ({ where: () => ({ returning: () => Promise.resolve(val) }) }),
});
const insertConflict = (val: unknown) => ({
  values: () => ({
    onConflictDoNothing: () => ({ returning: () => Promise.resolve(val) }),
  }),
});

function streak(overrides: Partial<UserStreak> = {}): UserStreak {
  return {
    id: "s1",
    userId: "u1",
    streakType: "habit_streak",
    sourceGoalId: "g1",
    period: "daily",
    currentCount: 1,
    longestCount: 1,
    lastPeriodEnd: "2026-06-06",
    freezeTokens: 0,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as UserStreak;
}

describe("StreakRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getUserTimezone returns the profile tz, defaulting to Europe/London", async () => {
    (getDb as any).mockReturnValue({
      select: () => selectWhereLimit([{ tz: "America/Los_Angeles" }]),
    });
    expect(await new StreakRepository().getUserTimezone("u1")).toBe(
      "America/Los_Angeles",
    );

    (getDb as any).mockReturnValue({ select: () => selectWhereLimit([]) });
    expect(await new StreakRepository().getUserTimezone("u1")).toBe(
      "Europe/London",
    );
  });

  it("getActiveStreaksByType / getActiveStreaks return rows", async () => {
    const rows = [streak()];
    (getDb as any).mockReturnValue({ select: () => selectWhere(rows) });
    expect(
      await new StreakRepository().getActiveStreaksByType("u1", "habit_streak"),
    ).toBe(rows);
    expect(await new StreakRepository().getActiveStreaks()).toBe(rows);
  });

  describe("isPeriodSatisfied", () => {
    it("workout: ≥ N completed sessions where N = goal target_value", async () => {
      const select = vi
        .fn()
        .mockReturnValueOnce(selectWhereLimit([{ tv: "3" }])) // threshold = 3
        .mockReturnValueOnce(selectWhere([{ c: 3 }])); // 3 sessions
      (getDb as any).mockReturnValue({ select });
      const ok = await new StreakRepository().isPeriodSatisfied(
        streak({ streakType: "workout_streak" }),
        "2026-06-01",
        "2026-06-07",
        "Europe/London",
      );
      expect(ok).toBe(true);
    });

    it("workout: unmet when sessions < threshold", async () => {
      const select = vi
        .fn()
        .mockReturnValueOnce(selectWhereLimit([{ tv: "3" }]))
        .mockReturnValueOnce(selectWhere([{ c: 2 }]));
      (getDb as any).mockReturnValue({ select });
      expect(
        await new StreakRepository().isPeriodSatisfied(
          streak({ streakType: "workout_streak" }),
          "2026-06-01",
          "2026-06-07",
          "Europe/London",
        ),
      ).toBe(false);
    });

    it("workout: defaults threshold to 1 for an ad-hoc streak (no goal)", async () => {
      (getDb as any).mockReturnValue({
        select: () => selectWhere([{ c: 1 }]),
      });
      expect(
        await new StreakRepository().isPeriodSatisfied(
          streak({ streakType: "workout_streak", sourceGoalId: null }),
          "2026-06-01",
          "2026-06-07",
          "Europe/London",
        ),
      ).toBe(true);
    });

    it("habit: satisfied when ≥ 1 completion exists", async () => {
      (getDb as any).mockReturnValue({
        select: () => selectWhere([{ c: 1 }]),
      });
      expect(
        await new StreakRepository().isPeriodSatisfied(
          streak({ streakType: "habit_streak" }),
          "2026-06-07",
          "2026-06-07",
          "Europe/London",
        ),
      ).toBe(true);
    });

    it("habit: handles a null source goal", async () => {
      (getDb as any).mockReturnValue({
        select: () => selectWhere([{ c: 0 }]),
      });
      expect(
        await new StreakRepository().isPeriodSatisfied(
          streak({ streakType: "habit_streak", sourceGoalId: null }),
          "2026-06-07",
          "2026-06-07",
          "Europe/London",
        ),
      ).toBe(false);
    });

    it("measurement: satisfied when ≥ 1 measurement exists", async () => {
      (getDb as any).mockReturnValue({
        select: () => selectWhere([{ c: 2 }]),
      });
      expect(
        await new StreakRepository().isPeriodSatisfied(
          streak({ streakType: "measurement_streak", sourceGoalId: null }),
          "2026-06-01",
          "2026-06-07",
          "Europe/London",
        ),
      ).toBe(true);
    });

    it("nutrition: never satisfied (M9-gated, no data source)", async () => {
      (getDb as any).mockReturnValue({ select: vi.fn() });
      expect(
        await new StreakRepository().isPeriodSatisfied(
          streak({ streakType: "nutrition_streak", sourceGoalId: null }),
          "2026-06-07",
          "2026-06-07",
          "Europe/London",
        ),
      ).toBe(false);
    });
  });

  it("persistAdvance updates and returns the row", async () => {
    const updated = streak({ currentCount: 2 });
    (getDb as any).mockReturnValue({ update: () => updateChain([updated]) });
    const result = await new StreakRepository().persistAdvance("s1", {
      currentCount: 2,
      longestCount: 2,
      lastPeriodEnd: "2026-06-07",
      freezeTokens: 0,
    });
    expect(result).toBe(updated);
  });

  describe("unlockAchievement", () => {
    it("inserts a new user_achievement and reports newlyUnlocked=true", async () => {
      (getDb as any).mockReturnValue({
        select: () => selectWhereLimit([{ id: "a1" }]),
        insert: () => insertConflict([{ id: "ua1" }]),
      });
      expect(
        await new StreakRepository().unlockAchievement(
          "u1",
          "workout_streak",
          4,
        ),
      ).toEqual({ achievementId: "a1", newlyUnlocked: true });
    });

    it("reports newlyUnlocked=false on a conflict (already earned)", async () => {
      (getDb as any).mockReturnValue({
        select: () => selectWhereLimit([{ id: "a1" }]),
        insert: () => insertConflict([]),
      });
      expect(
        await new StreakRepository().unlockAchievement(
          "u1",
          "workout_streak",
          4,
        ),
      ).toEqual({ achievementId: "a1", newlyUnlocked: false });
    });

    it("returns null when no achievement is seeded for the tier", async () => {
      (getDb as any).mockReturnValue({
        select: () => selectWhereLimit([]),
      });
      expect(
        await new StreakRepository().unlockAchievement(
          "u1",
          "workout_streak",
          99,
        ),
      ).toBeNull();
    });
  });

  it("persistFreezeSpend / persistBreak update and return the row", async () => {
    const frozen = streak({ freezeTokens: 0 });
    (getDb as any).mockReturnValue({ update: () => updateChain([frozen]) });
    expect(
      await new StreakRepository().persistFreezeSpend("s1", {
        freezeTokens: 0,
        lastPeriodEnd: "2026-06-09",
      }),
    ).toBe(frozen);

    const broken = streak({ status: "broken", currentCount: 0 });
    (getDb as any).mockReturnValue({ update: () => updateChain([broken]) });
    expect(
      await new StreakRepository().persistBreak("s1", {
        lastPeriodEnd: "2026-06-09",
      }),
    ).toBe(broken);
  });
});
