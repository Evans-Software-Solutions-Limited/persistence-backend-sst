/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
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
    const result = await new StreakRepository().persistAdvance(
      "s1",
      {
        currentCount: 2,
        longestCount: 2,
        lastPeriodEnd: "2026-06-07",
        freezeTokens: 0,
      },
      "2026-06-06", // snapshot lpe
    );
    expect(result).toBe(updated);
  });

  it("persistAdvance returns null when the conditional WHERE misses (lost race)", async () => {
    // A concurrent writer (cron spend/break, manual spend, or a tap-untap
    // rollback) moved last_period_end off our snapshot — the
    // `last_period_end = snapshot` pin matches no row.
    (getDb as any).mockReturnValue({ update: () => updateChain([]) });
    expect(
      await new StreakRepository().persistAdvance(
        "s1",
        {
          currentCount: 2,
          longestCount: 2,
          lastPeriodEnd: "2026-06-07",
          freezeTokens: 0,
        },
        "2026-06-06",
      ),
    ).toBeNull();
  });

  it("persistAdvance pins the WHERE to the snapshot last_period_end (not `< target`)", async () => {
    // A concurrent rollback regresses lpe BELOW the snapshot; a `< target`
    // guard would still match and clobber it with the stale absolute count.
    // The exact pin makes any off-snapshot row a clean no-op (Inspector finding).
    let updateWhere: unknown;
    (getDb as any).mockReturnValue({
      update: () => ({
        set: () => ({
          where: (w: unknown) => {
            updateWhere = w;
            return { returning: () => Promise.resolve([streak()]) };
          },
        }),
      }),
    });
    await new StreakRepository().persistAdvance(
      "s1",
      {
        currentCount: 2,
        longestCount: 2,
        lastPeriodEnd: "2026-06-07",
        freezeTokens: 0,
      },
      "2026-06-06", // snapshot lpe
    );
    const { sql, params } = new PgDialect().sqlToQuery(updateWhere as never);
    expect(sql).toContain('"last_period_end" = ');
    expect(sql).not.toContain('"last_period_end" < ');
    expect(params).toContain("2026-06-06"); // the snapshot, not the new target
    expect(params).not.toContain("2026-06-07");
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

  describe("spendTokenManually", () => {
    const now = new Date("2026-06-20T12:00:00Z"); // daily last-completed = 06-19

    it("advances last_period_end + decrements when behind one period", async () => {
      const behind = streak({
        period: "daily",
        freezeTokens: 1,
        lastPeriodEnd: "2026-06-18", // 1 period behind (last completed 06-19)
      });
      const updated = streak({ freezeTokens: 0, lastPeriodEnd: "2026-06-19" });
      const select = vi
        .fn()
        .mockReturnValueOnce(selectWhereLimit([behind])) // load streak
        .mockReturnValueOnce(selectWhereLimit([{ tz: "Europe/London" }])); // tz
      (getDb as any).mockReturnValue({
        select,
        update: () => updateChain([updated]),
      });
      expect(
        await new StreakRepository().spendTokenManually("u1", "s1", now),
      ).toBe(updated);
    });

    it("spends one token PER missed period when it has enough", async () => {
      const behind = streak({
        period: "daily",
        freezeTokens: 3,
        lastPeriodEnd: "2026-06-16", // 3 periods behind
      });
      const updated = streak({ freezeTokens: 0 });
      const select = vi
        .fn()
        .mockReturnValueOnce(selectWhereLimit([behind]))
        .mockReturnValueOnce(selectWhereLimit([{ tz: "Europe/London" }]));
      (getDb as any).mockReturnValue({
        select,
        update: () => updateChain([updated]),
      });
      expect(
        await new StreakRepository().spendTokenManually("u1", "s1", now),
      ).toBe(updated);
    });

    it("returns null when there aren't enough tokens to cover every missed period", async () => {
      const behind = streak({
        period: "daily",
        freezeTokens: 2,
        lastPeriodEnd: "2026-06-16", // 3 periods behind, only 2 tokens
      });
      const select = vi
        .fn()
        .mockReturnValueOnce(selectWhereLimit([behind]))
        .mockReturnValueOnce(selectWhereLimit([{ tz: "Europe/London" }]));
      (getDb as any).mockReturnValue({ select });
      expect(
        await new StreakRepository().spendTokenManually("u1", "s1", now),
      ).toBeNull();
    });

    it("returns null when the conditional UPDATE matches nothing (lost the race to tryAdvance)", async () => {
      const behind = streak({
        period: "daily",
        freezeTokens: 1,
        lastPeriodEnd: "2026-06-18",
      });
      const select = vi
        .fn()
        .mockReturnValueOnce(selectWhereLimit([behind]))
        .mockReturnValueOnce(selectWhereLimit([{ tz: "Europe/London" }]));
      // A concurrent advance moved last_period_end off the snapshot, so the
      // `last_period_end = <snapshot>` pin in the UPDATE WHERE matches no row →
      // returns null (no regression, no token over-burned).
      (getDb as any).mockReturnValue({ select, update: () => updateChain([]) });
      expect(
        await new StreakRepository().spendTokenManually("u1", "s1", now),
      ).toBeNull();
    });

    it("pins the UPDATE WHERE to the snapshot last_period_end (not `< target`)", async () => {
      // A partial mid-gap advance (snapshot < new < target) must NOT match, so
      // the stale `missed` can't over-debit the user (Inspector finding).
      const behind = streak({
        period: "daily",
        freezeTokens: 3,
        lastPeriodEnd: "2026-06-16", // snapshot
      });
      let updateWhere: unknown;
      const select = vi
        .fn()
        .mockReturnValueOnce(selectWhereLimit([behind]))
        .mockReturnValueOnce(selectWhereLimit([{ tz: "Europe/London" }]));
      (getDb as any).mockReturnValue({
        select,
        update: () => ({
          set: () => ({
            where: (w: unknown) => {
              updateWhere = w;
              return { returning: () => Promise.resolve([behind]) };
            },
          }),
        }),
      });
      await new StreakRepository().spendTokenManually("u1", "s1", now);
      const { sql, params } = new PgDialect().sqlToQuery(updateWhere as never);
      expect(sql).toContain('"last_period_end" = ');
      expect(sql).not.toContain('"last_period_end" < ');
      expect(params).toContain("2026-06-16"); // the snapshot, not the target
    });

    it("returns null when the streak is not behind (no token wasted)", async () => {
      const upToDate = streak({
        period: "daily",
        freezeTokens: 2,
        lastPeriodEnd: "2026-06-19",
      });
      const select = vi
        .fn()
        .mockReturnValueOnce(selectWhereLimit([upToDate]))
        .mockReturnValueOnce(selectWhereLimit([{ tz: "Europe/London" }]));
      (getDb as any).mockReturnValue({ select });
      expect(
        await new StreakRepository().spendTokenManually("u1", "s1", now),
      ).toBeNull();
    });

    it("returns null when there is no token to spend", async () => {
      const noTokens = streak({ freezeTokens: 0 });
      (getDb as any).mockReturnValue({
        select: () => selectWhereLimit([noTokens]),
      });
      expect(
        await new StreakRepository().spendTokenManually("u1", "s1", now),
      ).toBeNull();
    });

    it("returns null when the streak isn't found / owned", async () => {
      (getDb as any).mockReturnValue({ select: () => selectWhereLimit([]) });
      expect(
        await new StreakRepository().spendTokenManually("u1", "s1", now),
      ).toBeNull();
    });
  });

  it("persistFreezeSpend / persistBreak update and return the row", async () => {
    const frozen = streak({ freezeTokens: 0 });
    (getDb as any).mockReturnValue({ update: () => updateChain([frozen]) });
    expect(
      await new StreakRepository().persistFreezeSpend("s1", {
        tokensSpent: 1,
        lastPeriodEnd: "2026-06-09",
        snapshotLastPeriodEnd: "2026-06-07",
      }),
    ).toBe(frozen);

    const broken = streak({ status: "broken", currentCount: 0 });
    (getDb as any).mockReturnValue({ update: () => updateChain([broken]) });
    expect(
      await new StreakRepository().persistBreak("s1", {
        lastPeriodEnd: "2026-06-09",
        snapshotLastPeriodEnd: "2026-06-04",
      }),
    ).toBe(broken);
  });

  it("persistFreezeSpend / persistBreak return null when the conditional WHERE misses (lost race)", async () => {
    (getDb as any).mockReturnValue({ update: () => updateChain([]) });
    expect(
      await new StreakRepository().persistFreezeSpend("s1", {
        tokensSpent: 1,
        lastPeriodEnd: "2026-06-09",
        snapshotLastPeriodEnd: "2026-06-07",
      }),
    ).toBeNull();
    expect(
      await new StreakRepository().persistBreak("s1", {
        lastPeriodEnd: "2026-06-09",
        snapshotLastPeriodEnd: "2026-06-04",
      }),
    ).toBeNull();
  });

  it("persistFreezeSpend / persistBreak pin the WHERE to the snapshot last_period_end (not `< target`)", async () => {
    // A partial mid-gap advance (snapshot < new < target) must NOT match — the
    // pin is exact equality, so stale arithmetic can't land (Inspector finding).
    let freezeWhere: unknown;
    let breakWhere: unknown;
    (getDb as any).mockReturnValue({
      update: () => ({
        set: () => ({
          where: (w: unknown) => {
            // first call → freeze, second → break (set per invocation below)
            if (freezeWhere === undefined) freezeWhere = w;
            else breakWhere = w;
            return { returning: () => Promise.resolve([streak()]) };
          },
        }),
      }),
    });
    await new StreakRepository().persistFreezeSpend("s1", {
      tokensSpent: 1,
      lastPeriodEnd: "2026-06-09",
      snapshotLastPeriodEnd: "2026-06-07",
    });
    await new StreakRepository().persistBreak("s1", {
      lastPeriodEnd: "2026-06-09",
      snapshotLastPeriodEnd: "2026-06-04",
    });
    const dialect = new PgDialect();
    const freezeSql = dialect.sqlToQuery(freezeWhere as never);
    const breakSql = dialect.sqlToQuery(breakWhere as never);
    // Equality pin present, and the loose `<` comparison gone.
    expect(freezeSql.sql).toContain('"last_period_end" = ');
    expect(freezeSql.sql).not.toContain('"last_period_end" < ');
    expect(freezeSql.params).toContain("2026-06-07");
    expect(breakSql.sql).toContain('"last_period_end" = ');
    expect(breakSql.sql).not.toContain('"last_period_end" < ');
    expect(breakSql.params).toContain("2026-06-04");
  });

  describe("rollbackHabitAdvance", () => {
    it("decrements + regresses when the deleted day was the counted period", async () => {
      const active = streak({
        period: "daily",
        currentCount: 6,
        lastPeriodEnd: "2026-06-10",
      });
      const rolled = streak({ currentCount: 5, lastPeriodEnd: "2026-06-09" });
      (getDb as any).mockReturnValue({
        select: () => selectWhereLimit([active]),
        update: () => updateChain([rolled]),
      });
      expect(
        await new StreakRepository().rollbackHabitAdvance(
          "u1",
          "g1",
          "2026-06-10",
        ),
      ).toBe(rolled);
    });

    it("no-ops when the deleted day is not the most recent counted period", async () => {
      const active = streak({
        period: "daily",
        currentCount: 6,
        lastPeriodEnd: "2026-06-10",
      });
      (getDb as any).mockReturnValue({
        select: () => selectWhereLimit([active]),
      });
      // Deleting 06-08 (already locked into history) → null, no UPDATE.
      expect(
        await new StreakRepository().rollbackHabitAdvance(
          "u1",
          "g1",
          "2026-06-08",
        ),
      ).toBeNull();
    });

    it("claws back the freeze token earned at a token-earning boundary", async () => {
      // count 8 → rolling back the 8th period (a multiple of 4) un-earns the
      // token that advance minted; the SET must decrement freeze_tokens too.
      const active = streak({
        period: "daily",
        currentCount: 8,
        lastPeriodEnd: "2026-06-10",
      });
      let setPayload: Record<string, unknown> | undefined;
      (getDb as any).mockReturnValue({
        select: () => selectWhereLimit([active]),
        update: () => ({
          set: (p: Record<string, unknown>) => {
            setPayload = p;
            return { where: () => ({ returning: () => Promise.resolve([]) }) };
          },
        }),
      });
      await new StreakRepository().rollbackHabitAdvance(
        "u1",
        "g1",
        "2026-06-10",
      );
      // Render the freezeTokens expression: a CASE keyed on `current_count % 4`
      // that decrements (bounded at 0) only at the boundary.
      const sql = new PgDialect().sqlToQuery(setPayload!.freezeTokens as never);
      expect(sql.sql.toLowerCase()).toContain("case when");
      expect(sql.sql).toContain('"current_count" % ');
      expect(sql.sql.toLowerCase()).toContain("greatest");
      expect(sql.params).toContain(4); // PERIODS_PER_FREEZE_TOKEN
    });

    it("no-ops when no active habit streak exists for the goal", async () => {
      (getDb as any).mockReturnValue({ select: () => selectWhereLimit([]) });
      expect(
        await new StreakRepository().rollbackHabitAdvance(
          "u1",
          "g1",
          "2026-06-10",
        ),
      ).toBeNull();
    });
  });
});
