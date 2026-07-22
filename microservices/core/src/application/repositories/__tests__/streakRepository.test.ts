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

  it("getActiveStreaksByType / getActiveStreaks / forUser return rows", async () => {
    const rows = [streak()];
    (getDb as any).mockReturnValue({ select: () => selectWhere(rows) });
    expect(
      await new StreakRepository().getActiveStreaksByType("u1", "habit_streak"),
    ).toBe(rows);
    expect(await new StreakRepository().getActiveStreaks()).toBe(rows);
    expect(await new StreakRepository().getActiveStreaksForUser("u1")).toBe(
      rows,
    );
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

    it("habit: collection row with no enabled habits is not satisfied", async () => {
      // A null source_goal_id is the COLLECTION streak (18-habit-setup) — it
      // delegates to getCollectionHabitAggregates. With no enabled+effective
      // habits the set is empty, so the week can't advance the collection count.
      (getDb as any).mockReturnValue({
        select: () => ({
          from: () => ({
            innerJoin: () => ({ where: () => Promise.resolve([]) }),
          }),
        }),
      });
      expect(
        await new StreakRepository().isPeriodSatisfied(
          streak({ streakType: "habit_streak", sourceGoalId: null }),
          "2026-06-01",
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

    const nutritionStreak = () =>
      streak({ streakType: "nutrition_streak", sourceGoalId: null });
    const nutritionDb = (target: unknown[], total: number) => {
      const select = vi
        .fn()
        .mockReturnValueOnce(selectWhereLimit(target))
        .mockReturnValueOnce(selectWhere([{ total }]));
      return { select };
    };
    it("nutrition: satisfied when the day's kcal is within target ±10%", async () => {
      (getDb as any).mockReturnValue(nutritionDb([{ daily: "2000" }], 2000));
      expect(
        await new StreakRepository().isPeriodSatisfied(
          nutritionStreak(),
          "2026-06-22",
          "2026-06-22",
          "Europe/London",
        ),
      ).toBe(true);
    });

    it("nutrition: satisfied at the lower edge (−10%)", async () => {
      (getDb as any).mockReturnValue(nutritionDb([{ daily: "2000" }], 1800));
      expect(
        await new StreakRepository().isPeriodSatisfied(
          nutritionStreak(),
          "2026-06-22",
          "2026-06-22",
          "Europe/London",
        ),
      ).toBe(true);
    });

    it("nutrition: unmet when over the +10% band", async () => {
      (getDb as any).mockReturnValue(nutritionDb([{ daily: "2000" }], 2300));
      expect(
        await new StreakRepository().isPeriodSatisfied(
          nutritionStreak(),
          "2026-06-22",
          "2026-06-22",
          "Europe/London",
        ),
      ).toBe(false);
    });

    it("nutrition: unmet when under the −10% band (incl. zero logging)", async () => {
      (getDb as any).mockReturnValue(nutritionDb([{ daily: "2000" }], 0));
      expect(
        await new StreakRepository().isPeriodSatisfied(
          nutritionStreak(),
          "2026-06-22",
          "2026-06-22",
          "Europe/London",
        ),
      ).toBe(false);
    });

    it("nutrition: unmet when no target is set (can't evaluate)", async () => {
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValueOnce(selectWhereLimit([])),
      });
      expect(
        await new StreakRepository().isPeriodSatisfied(
          nutritionStreak(),
          "2026-06-22",
          "2026-06-22",
          "Europe/London",
        ),
      ).toBe(false);
    });
  });

  it("getNutritionStreakUserIds returns distinct active/broken user ids", async () => {
    (getDb as any).mockReturnValue({
      selectDistinct: () => ({
        from: () => ({
          where: () => Promise.resolve([{ userId: "u1" }, { userId: "u2" }]),
        }),
      }),
    });
    expect(await new StreakRepository().getNutritionStreakUserIds()).toEqual([
      "u1",
      "u2",
    ]);
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

  // ── 18-habit-setup: collection streak model ───────────────────────────────

  const enabledJoin = (rows: unknown[]) => ({
    from: () => ({
      innerJoin: () => ({ where: () => Promise.resolve(rows) }),
    }),
  });

  describe("getCollectionHabitAggregates (T-18.5.1)", () => {
    it("computes value_gte qualifying days via a GROUP-BY-ordinal subquery (42803 guard)", async () => {
      let executed: unknown;
      (getDb as any).mockReturnValue({
        select: () =>
          enabledJoin([
            {
              goalId: "water-goal",
              completionRule: "value_gte",
              targetValue: "2",
              daysPerWeek: 5,
              tolerancePct: null,
            },
          ]),
        execute: (q: unknown) => {
          executed = q;
          return Promise.resolve([{ days: 5 }]);
        },
      });

      const out = await new StreakRepository().getCollectionHabitAggregates(
        "u1",
        "2026-06-01",
        "2026-06-07",
        "Europe/London",
      );
      expect(out).toHaveLength(1);
      expect(out[0].qualifyingDays).toBe(5);
      expect(out[0].completionRule).toBe("value_gte");

      // Render the raw SQL: it must GROUP BY ordinal (1), never repeat the
      // parameterised sum() expr in both SELECT and GROUP BY (Postgres 42803).
      const { sql } = new PgDialect().sqlToQuery(executed as never);
      expect(sql.toLowerCase()).toContain("group by 1");
      expect(sql.toLowerCase()).toContain("having coalesce(sum(");
    });

    it("scores within_tolerance days against the live Fuel target, not the stored habit snapshot", async () => {
      let executed: unknown;
      let call = 0;
      (getDb as any).mockReturnValue({
        // 1st select = enabled-habits join; 2nd = the user's daily_kcal.
        select: () =>
          call++ === 0
            ? enabledJoin([
                {
                  goalId: "cal-goal",
                  completionRule: "within_tolerance",
                  targetValue: "2000", // stale habit-config snapshot — must be ignored
                  daysPerWeek: 6,
                  tolerancePct: "10",
                },
              ])
            : selectWhereLimit([{ daily: "2500" }]),
        execute: (q: unknown) => {
          executed = q;
          return Promise.resolve([{ days: 6 }]);
        },
      });

      const out = await new StreakRepository().getCollectionHabitAggregates(
        "u1",
        "2026-06-01",
        "2026-06-07",
        "Europe/London",
      );
      expect(out[0].qualifyingDays).toBe(6);
      expect(out[0].tolerancePct).toBe(10);
      // Scored against the Fuel target (2500), NOT the stored 2000 snapshot —
      // single source of truth, so this agrees with the nutrition streak.
      expect(out[0].targetValue).toBe(2500);

      const { sql, params } = new PgDialect().sqlToQuery(executed as never);
      expect(sql.toLowerCase()).toContain("group by 1");
      expect(sql.toLowerCase()).toContain("between");
      // 2500 ± 10% → [2250, 2750] bounds are bound as params.
      expect(params).toContain(2250);
      expect(params).toContain(2750);
    });

    it("falls back to the 2000 default for the Calories habit when no Fuel target is set", async () => {
      let call = 0;
      (getDb as any).mockReturnValue({
        select: () =>
          call++ === 0
            ? enabledJoin([
                {
                  goalId: "cal-goal",
                  completionRule: "within_tolerance",
                  targetValue: "9999", // stored snapshot ignored
                  daysPerWeek: 6,
                  tolerancePct: "10",
                },
              ])
            : selectWhereLimit([]), // no nutrition_targets row
        execute: () => Promise.resolve([{ days: 4 }]),
      });

      const out = await new StreakRepository().getCollectionHabitAggregates(
        "u1",
        "2026-06-01",
        "2026-06-07",
        "Europe/London",
      );
      expect(out[0].qualifyingDays).toBe(4);
      expect(out[0].targetValue).toBe(2000);
    });

    it("counts Gym sessions via a plain aggregate (no value/day grouping)", async () => {
      let call = 0;
      (getDb as any).mockReturnValue({
        // 1st select = enabled-habits join; 2nd = the session count.
        select: () =>
          call++ === 0
            ? enabledJoin([
                {
                  goalId: "gym-goal",
                  completionRule: "count",
                  targetValue: "3",
                  daysPerWeek: null,
                  tolerancePct: null,
                },
              ])
            : selectWhere([{ c: 3 }]),
      });
      const out = await new StreakRepository().getCollectionHabitAggregates(
        "u1",
        "2026-06-01",
        "2026-06-07",
        "Europe/London",
      );
      expect(out[0].sessionCount).toBe(3);
      expect(out[0].completionRule).toBe("count");
    });

    it("returns an empty list when no habit is enabled/effective", async () => {
      (getDb as any).mockReturnValue({ select: () => enabledJoin([]) });
      expect(
        await new StreakRepository().getCollectionHabitAggregates(
          "u1",
          "2026-06-01",
          "2026-06-07",
          "Europe/London",
        ),
      ).toEqual([]);
    });
  });

  // ── BRIEF-7 QA-1..QA-4: derived Home-grid rows for Gym + Calories ─────────
  // buildHabitsGrid is pure row-existence over habit_completions, which Gym
  // (`count`) and Calories (`within_tolerance`) never write. These per-day
  // queries derive the SAME qualification getCollectionHabitAggregates scores
  // weekly, just resolved to actual days over the grid's own window.
  const selectWhereGroupBy = (val: unknown) => ({
    from: () => ({ where: () => ({ groupBy: () => Promise.resolve(val) }) }),
  });
  const GRID_WINDOW = ["2026-06-08", "2026-06-09", "2026-06-10"];

  describe("getDerivedHabitGridRows (BRIEF-7 QA-1..QA-4)", () => {
    it("returns [] immediately for an empty window (no DB round-trip)", async () => {
      expect(
        await new StreakRepository().getDerivedHabitGridRows(
          "u1",
          [],
          "Europe/London",
        ),
      ).toEqual([]);
    });

    it("returns [] when no Gym/Calories habit is enabled", async () => {
      (getDb as any).mockReturnValue({ select: () => enabledJoin([]) });
      expect(
        await new StreakRepository().getDerivedHabitGridRows(
          "u1",
          GRID_WINDOW,
          "Europe/London",
        ),
      ).toEqual([]);
    });

    describe("Gym", () => {
      it("marks a day true when >= 1 completed session lands on it, false otherwise", async () => {
        let call = 0;
        (getDb as any).mockReturnValue({
          select: () =>
            call++ === 0
              ? enabledJoin([
                  { goalId: "gym-goal", category: "gym", tolerancePct: null },
                ])
              : selectWhereGroupBy([{ day: "2026-06-09" }]),
        });
        const rows = await new StreakRepository().getDerivedHabitGridRows(
          "u1",
          GRID_WINDOW,
          "Europe/London",
        );
        expect(rows).toEqual([
          { goalId: "gym-goal", days: [false, true, false] },
        ]);
      });

      it("an enabled habit with zero sessions in the window still renders an all-false row (tile stays visible)", async () => {
        let call = 0;
        (getDb as any).mockReturnValue({
          select: () =>
            call++ === 0
              ? enabledJoin([
                  { goalId: "gym-goal", category: "gym", tolerancePct: null },
                ])
              : selectWhereGroupBy([]),
        });
        const rows = await new StreakRepository().getDerivedHabitGridRows(
          "u1",
          GRID_WINDOW,
          "Europe/London",
        );
        expect(rows).toEqual([
          { goalId: "gym-goal", days: [false, false, false] },
        ]);
      });

      it("normalises a real-driver Date cell to the same YYYY-MM-DD key as the string-mock shape", async () => {
        let call = 0;
        (getDb as any).mockReturnValue({
          select: () =>
            call++ === 0
              ? enabledJoin([
                  { goalId: "gym-goal", category: "gym", tolerancePct: null },
                ])
              : selectWhereGroupBy([
                  { day: new Date("2026-06-09T00:00:00.000Z") },
                ]),
        });
        const rows = await new StreakRepository().getDerivedHabitGridRows(
          "u1",
          GRID_WINDOW,
          "Europe/London",
        );
        expect(rows[0].days).toEqual([false, true, false]);
      });

      it("only counts COMPLETED sessions — an in-progress/abandoned session is excluded by the WHERE (rendered SQL)", async () => {
        let call = 0;
        let executedWhere: unknown;
        (getDb as any).mockReturnValue({
          select: () =>
            call++ === 0
              ? enabledJoin([
                  { goalId: "gym-goal", category: "gym", tolerancePct: null },
                ])
              : {
                  from: () => ({
                    where: (w: unknown) => {
                      executedWhere = w;
                      return { groupBy: () => Promise.resolve([]) };
                    },
                  }),
                },
        });
        await new StreakRepository().getDerivedHabitGridRows(
          "u1",
          GRID_WINDOW,
          "Europe/London",
        );
        const { sql, params } = new PgDialect().sqlToQuery(
          executedWhere as never,
        );
        expect(sql).toContain('"status" = ');
        expect(params).toContain("completed");
      });
    });

    describe("Calories", () => {
      it("marks a day true when kcal is within tolerance (inclusive bounds — matches countCalorieToleranceDays), false outside", async () => {
        let call = 0;
        let executed: unknown;
        (getDb as any).mockReturnValue({
          select: () =>
            call++ === 0
              ? enabledJoin([
                  {
                    goalId: "cal-goal",
                    category: "calories",
                    tolerancePct: "10",
                  },
                ])
              : selectWhereLimit([{ daily: "2000" }]), // Fuel target
          execute: (q: unknown) => {
            executed = q;
            return Promise.resolve([{ d: "2026-06-09" }]);
          },
        });
        const rows = await new StreakRepository().getDerivedHabitGridRows(
          "u1",
          GRID_WINDOW,
          "Europe/London",
        );
        expect(rows).toEqual([
          { goalId: "cal-goal", days: [false, true, false] },
        ]);
        const { sql, params } = new PgDialect().sqlToQuery(executed as never);
        expect(sql.toLowerCase()).toContain("between");
        expect(params).toContain(1800); // 2000 - 10%
        expect(params).toContain(2200); // 2000 + 10%
      });

      it("resolves the target against the live Fuel target, falling back to the 2000 default when none is set", async () => {
        let call = 0;
        let executed: unknown;
        (getDb as any).mockReturnValue({
          select: () =>
            call++ === 0
              ? enabledJoin([
                  {
                    goalId: "cal-goal",
                    category: "calories",
                    tolerancePct: "0",
                  },
                ])
              : selectWhereLimit([]), // no nutrition_targets row
          execute: (q: unknown) => {
            executed = q;
            return Promise.resolve([]);
          },
        });
        await new StreakRepository().getDerivedHabitGridRows(
          "u1",
          GRID_WINDOW,
          "Europe/London",
        );
        const { params } = new PgDialect().sqlToQuery(executed as never);
        expect(params).toContain(2000); // category default, 0% tolerance both bounds
      });

      it("an enabled habit with no qualifying days still renders an all-false row", async () => {
        let call = 0;
        (getDb as any).mockReturnValue({
          select: () =>
            call++ === 0
              ? enabledJoin([
                  {
                    goalId: "cal-goal",
                    category: "calories",
                    tolerancePct: "10",
                  },
                ])
              : selectWhereLimit([{ daily: "2000" }]),
          execute: () => Promise.resolve([]),
        });
        const rows = await new StreakRepository().getDerivedHabitGridRows(
          "u1",
          GRID_WINDOW,
          "Europe/London",
        );
        expect(rows).toEqual([
          { goalId: "cal-goal", days: [false, false, false] },
        ]);
      });

      it("defaults a null tolerancePct to 0% (exact-target day only)", async () => {
        let call = 0;
        let executed: unknown;
        (getDb as any).mockReturnValue({
          select: () =>
            call++ === 0
              ? enabledJoin([
                  {
                    goalId: "cal-goal",
                    category: "calories",
                    tolerancePct: null,
                  },
                ])
              : selectWhereLimit([{ daily: "2000" }]),
          execute: (q: unknown) => {
            executed = q;
            return Promise.resolve([]);
          },
        });
        await new StreakRepository().getDerivedHabitGridRows(
          "u1",
          GRID_WINDOW,
          "Europe/London",
        );
        const { params } = new PgDialect().sqlToQuery(executed as never);
        // 0% tolerance ⇒ both bounds collapse to the target itself (2000).
        expect(params.filter((p) => p === 2000)).toHaveLength(2);
      });
    });

    it("computes Gym + Calories together, resolving the Fuel target exactly once", async () => {
      let selectCall = 0;
      (getDb as any).mockReturnValue({
        select: () => {
          const n = selectCall++;
          if (n === 0) {
            return enabledJoin([
              { goalId: "gym-goal", category: "gym", tolerancePct: null },
              { goalId: "cal-goal", category: "calories", tolerancePct: "10" },
            ]);
          }
          if (n === 1) return selectWhereLimit([{ daily: "2000" }]); // fuel target — fetched once
          return selectWhereGroupBy([{ day: "2026-06-09" }]); // gym days
        },
        execute: () => Promise.resolve([{ d: "2026-06-10" }]), // calorie days
      });
      const rows = await new StreakRepository().getDerivedHabitGridRows(
        "u1",
        GRID_WINDOW,
        "Europe/London",
      );
      expect(rows).toEqual([
        { goalId: "gym-goal", days: [false, true, false] },
        { goalId: "cal-goal", days: [false, false, true] },
      ]);
      // Exactly 2 select() round-trips before the per-habit day queries: the
      // enabled-habits join, then ONE daily_kcal lookup shared by the single
      // Calories habit — not re-fetched per habit.
      expect(selectCall).toBe(3); // enabled join + fuel target + gym groupBy
    });
  });

  describe("weekIntersectsHoliday / getCollectionHabitStreak", () => {
    it("weekIntersectsHoliday true when a range overlaps", async () => {
      (getDb as any).mockReturnValue({
        select: () => selectWhereLimit([{ id: "h1" }]),
      });
      expect(
        await new StreakRepository().weekIntersectsHoliday(
          "u1",
          "2026-06-01",
          "2026-06-07",
        ),
      ).toBe(true);
    });

    it("weekIntersectsHoliday false when none overlaps", async () => {
      (getDb as any).mockReturnValue({
        select: () => selectWhereLimit([]),
      });
      expect(
        await new StreakRepository().weekIntersectsHoliday(
          "u1",
          "2026-06-01",
          "2026-06-07",
        ),
      ).toBe(false);
    });

    it("getCollectionHabitStreak returns the null-source habit row", async () => {
      const row = streak({ sourceGoalId: null });
      (getDb as any).mockReturnValue({
        select: () => selectWhereLimit([row]),
      });
      expect(
        await new StreakRepository().getCollectionHabitStreak("u1"),
      ).toEqual(row);
    });

    it("getCollectionHabitStreakUserIds maps distinct rows", async () => {
      (getDb as any).mockReturnValue({
        selectDistinct: () => ({
          from: () => ({ where: () => Promise.resolve([{ userId: "u1" }]) }),
        }),
      });
      expect(
        await new StreakRepository().getCollectionHabitStreakUserIds(),
      ).toEqual(["u1"]);
    });
  });

  describe("persistHolidayPause / persistHolidayResume", () => {
    it("pause pins to the snapshot lpe + sets paused", async () => {
      let where: unknown;
      (getDb as any).mockReturnValue({
        update: () => ({
          set: () => ({
            where: (w: unknown) => {
              where = w;
              return {
                returning: () =>
                  Promise.resolve([streak({ status: "paused" })]),
              };
            },
          }),
        }),
      });
      const r = await new StreakRepository().persistHolidayPause("s1", {
        lastPeriodEnd: "2026-06-07",
        snapshotLastPeriodEnd: "2026-05-31",
      });
      expect(r?.status).toBe("paused");
      const { params } = new PgDialect().sqlToQuery(where as never);
      expect(params).toContain("2026-05-31");
    });

    it("resume flips paused → active", async () => {
      (getDb as any).mockReturnValue({
        update: () => updateChain([streak({ status: "active" })]),
      });
      const r = await new StreakRepository().persistHolidayResume("s1");
      expect(r?.status).toBe("active");
    });

    it("resume returns null when nothing was paused", async () => {
      (getDb as any).mockReturnValue({ update: () => updateChain([]) });
      expect(
        await new StreakRepository().persistHolidayResume("s1"),
      ).toBeNull();
    });
  });

  describe("skipCurrentPeriod (T-18.5.4 — proactive skip)", () => {
    const weekly = (o: Partial<UserStreak> = {}) =>
      streak({
        period: "weekly",
        sourceGoalId: null,
        freezeTokens: 2,
        ...o,
      });
    // now = Wed 2026-06-10; last completed week ended Sun 2026-06-07; current
    // week ends Sun 2026-06-14.
    const NOW = new Date("2026-06-10T09:00:00.000Z");

    it("null when the streak isn't owned/active", async () => {
      (getDb as any).mockReturnValue({ select: () => selectWhereLimit([]) });
      expect(
        await new StreakRepository().skipCurrentPeriod("u1", "s1", NOW),
      ).toBeNull();
    });

    it("null with no token", async () => {
      (getDb as any).mockReturnValue({
        select: () => selectWhereLimit([weekly({ freezeTokens: 0 })]),
      });
      expect(
        await new StreakRepository().skipCurrentPeriod("u1", "s1", NOW),
      ).toBeNull();
    });

    it("null when the streak is behind (must retro-spend first)", async () => {
      // lpe = 2026-05-31 (a week behind the last completed 2026-06-07).
      const behind = weekly({ lastPeriodEnd: "2026-05-31" });
      let call = 0;
      (getDb as any).mockReturnValue({
        select: () =>
          call++ === 0
            ? selectWhereLimit([behind])
            : selectWhereLimit([{ tz: "Europe/London" }]),
      });
      expect(
        await new StreakRepository().skipCurrentPeriod("u1", "s1", NOW),
      ).toBeNull();
    });

    it("spends one token + advances lpe over the current week, no count change", async () => {
      const upToDate = weekly({ lastPeriodEnd: "2026-06-07", currentCount: 4 });
      let where: unknown;
      let call = 0;
      (getDb as any).mockReturnValue({
        select: () =>
          call++ === 0
            ? selectWhereLimit([upToDate])
            : selectWhereLimit([{ tz: "Europe/London" }]),
        update: () => ({
          set: (s: unknown) => {
            expect(s).not.toHaveProperty("currentCount");
            return {
              where: (w: unknown) => {
                where = w;
                return {
                  returning: () =>
                    Promise.resolve([
                      weekly({
                        lastPeriodEnd: "2026-06-14",
                        freezeTokens: 1,
                        currentCount: 4,
                      }),
                    ]),
                };
              },
            };
          },
        }),
      });
      const r = await new StreakRepository().skipCurrentPeriod("u1", "s1", NOW);
      expect(r?.lastPeriodEnd).toBe("2026-06-14");
      expect(r?.currentCount).toBe(4); // unchanged
      const { params } = new PgDialect().sqlToQuery(where as never);
      expect(params).toContain("2026-06-07"); // pinned to snapshot lpe
    });
  });
});
