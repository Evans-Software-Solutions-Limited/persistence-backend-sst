/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, is, Table } from "drizzle-orm";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
import { getDb } from "@persistence/db/client";

// Delegate repos are mocked so the aggregate test isolates the COMPOSITION +
// the repository's own SQL (header, adherence, calorie rollup, goal, habit
// meta, recent sessions, notes, workouts-planned). Each delegate's behaviour
// is exercised in its own suite.
const home = { getRecentPRs: vi.fn(async () => [] as any[]) };
const volume = {
  dailyVolume: vi.fn(async () => [] as any[]),
  completedSessionCount: vi.fn(async () => 0),
};
const nutrition = { get: vi.fn(async () => null as any) };
const streaks = {
  getCollectionHabitAggregates: vi.fn(async () => [] as any[]),
  getCollectionHabitStreak: vi.fn(async () => null as any),
};
const programmes = {
  getActiveProgrammeForClient: vi.fn(async () => null as any),
};

vi.mock("../homeReadRepository", () => ({
  HomeReadRepository: vi.fn(() => home),
}));
vi.mock("../volumeRepository", () => ({
  VolumeRepository: vi.fn(() => volume),
}));
vi.mock("../nutritionTargetRepository", () => ({
  NutritionTargetRepository: vi.fn(() => nutrition),
}));
vi.mock("../streakRepository", () => ({
  StreakRepository: vi.fn(() => streaks),
}));
vi.mock("../programAssignmentRepository", () => ({
  ProgramAssignmentRepository: vi.fn(() => programmes),
}));

// Module g reads (only exercised when a client_ai_summaries row exists). The
// cache row itself comes through the getDb mock (byTable.client_ai_summaries);
// entitlement + the usage counter back `canManualRefresh` and are mocked so the
// suite never touches live entitlement SQL.
const assertEntitlementMock = vi.hoisted(() =>
  vi.fn(async () => ({ allowed: true }) as { allowed: boolean }),
);
vi.mock("../../entitlement/assertEntitlement", () => ({
  assertEntitlement: assertEntitlementMock,
}));
const countSummaryTodayMock = vi.hoisted(() => vi.fn(async () => 0));
vi.mock("../aiUsageLogRepository", () => ({
  AiUsageLogRepository: vi.fn(() => ({
    countForUserToday: countSummaryTodayMock,
  })),
}));

import { ClientDetailRepository } from "../clientDetailRepository";

/**
 * A getDb() mock that dispatches `.select().from(table)...` results by the
 * table passed to `.from()`. This is robust to the Promise.all interleaving in
 * getClientDetail (query bodies run synchronously to their first await in array
 * order, but keying by table removes any reliance on that). `execute()` is a
 * separate hook for the raw-SQL calorie rollup.
 */
function makeDb(opts: {
  byTable: Record<string, unknown[]>;
  execute?: (q: unknown) => Promise<unknown[]>;
}) {
  const select = () => {
    let fromTable: string | null = null;
    const chain: any = {};
    for (const k of [
      "innerJoin",
      "leftJoin",
      "where",
      "groupBy",
      "orderBy",
      "limit",
      "offset",
    ]) {
      chain[k] = () => chain;
    }
    chain.from = (tbl: unknown) => {
      fromTable = is(tbl, Table) ? getTableName(tbl as Table) : String(tbl);
      return chain;
    };
    chain.then = (res: any, rej: any) => {
      const rows = fromTable ? (opts.byTable[fromTable] ?? []) : [];
      return Promise.resolve(rows).then(res, rej);
    };
    return chain;
  };
  return {
    select,
    execute: opts.execute ?? (async () => [] as unknown[]),
  };
}

const NOW = new Date("2026-07-08T12:00:00.000Z"); // a Wednesday
// Client-local week (Mon–Sun) containing NOW: 2026-07-06 .. 2026-07-12.
const WEEK_START = "2026-07-06";
const WEEK_END = "2026-07-12";

function resetDelegates() {
  home.getRecentPRs.mockResolvedValue([]);
  volume.dailyVolume.mockResolvedValue([]);
  volume.completedSessionCount.mockResolvedValue(0);
  nutrition.get.mockResolvedValue(null);
  streaks.getCollectionHabitAggregates.mockResolvedValue([]);
  streaks.getCollectionHabitStreak.mockResolvedValue(null);
  programmes.getActiveProgrammeForClient.mockResolvedValue(null);
  assertEntitlementMock.mockResolvedValue({ allowed: true });
  countSummaryTodayMock.mockResolvedValue(0);
}

// The concluded (previous) client-local day for NOW=2026-07-08 (Europe/London).
const COVERS_DATE = "2026-07-07";

describe("ClientDetailRepository.getClientDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDelegates();
  });

  it("brand-new client (no data anywhere) → all fallbacks, never 0%/crisis", async () => {
    (getDb as any).mockReturnValue(
      makeDb({
        byTable: {
          profiles: [{ tz: "Europe/London" }], // resolveTz + header both read profiles
        },
      }),
    );
    const out = await new ClientDetailRepository().getClientDetail(
      "trainer-1",
      "client-1",
      NOW,
    );

    // Header — empty name, initials "", nulls hidden by presenter.
    expect(out.client.id).toBe("client-1");
    expect(out.client.status).toBe("active"); // safety-net default
    // Adherence — no assignments in window → not-enough-data (null/null).
    expect(out.adherence.overall).toBeNull();
    expect(out.adherence.band).toBeNull();
    // Module d/e/f — all null when nothing set up.
    expect(out.calorieHit).toBeNull();
    expect(out.goal).toBeNull();
    expect(out.habits).toBeNull();
    // Volume empty.
    expect(out.volume).toEqual({ weekKg: null, daily: [] });
    expect(out.prs).toEqual([]);
    expect(out.recentSessions).toEqual([]);
    expect(out.notes).toEqual([]);
    // thisWeek — programme absent ⇒ workoutsPlanned null; checkIns always null.
    expect(out.thisWeek.workoutsPlanned).toBeNull();
    expect(out.thisWeek.checkIns).toBeNull();
    expect(out.thisWeek.workoutsCompleted).toBe(0);
    // aiSummary — no cached row for the concluded day ⇒ null shell (coversDate
    // is still the concluded client-local day). The read NEVER infers, and with
    // no row it never even checks entitlement/ceiling.
    expect(out.aiSummary).toEqual({
      summary: null,
      coversDate: COVERS_DATE,
      generatedAt: null,
      canManualRefresh: false,
    });
    expect(assertEntitlementMock).not.toHaveBeenCalled();
    expect(countSummaryTodayMock).not.toHaveBeenCalled();
  });

  it("resolves timezone + header from the CLIENT's profile, deriving age/height/initials", async () => {
    (getDb as any).mockReturnValue(
      makeDb({
        byTable: {
          profiles: [
            { tz: "America/New_York" }, // resolveTz
          ],
        },
      }),
    );
    // header reads profiles too; give the second read the full row by keying a
    // second profiles result via a small stateful queue.
    const profileRows = [
      [{ tz: "America/New_York" }],
      [
        {
          id: "client-1",
          fullName: "Jane Alice Doe",
          avatarUrl: "http://a/1.png",
          dateOfBirth: "1990-01-01",
          heightCm: "172.50",
        },
      ],
      [{ status: "pending" }], // relationship status read
    ];
    let pi = 0;
    (getDb as any).mockReturnValue({
      select: () => {
        const rows = profileRows[Math.min(pi++, profileRows.length - 1)];
        const chain: any = {};
        for (const k of [
          "from",
          "innerJoin",
          "leftJoin",
          "where",
          "groupBy",
          "orderBy",
          "limit",
          "offset",
        ]) {
          chain[k] = () => chain;
        }
        chain.then = (res: any, rej: any) =>
          Promise.resolve(rows).then(res, rej);
        return chain;
      },
      execute: async () => [],
    });

    const out = await new ClientDetailRepository().getClientDetail(
      "trainer-1",
      "client-1",
      NOW,
    );
    expect(out.client.name).toBe("Jane Alice Doe");
    expect(out.client.initials).toBe("JD");
    expect(out.client.avatarUrl).toBe("http://a/1.png");
    expect(out.client.ageYears).toBe(36);
    expect(out.client.heightCm).toBe(172.5);
    expect(out.client.status).toBe("pending");
  });

  it("adherence — completed/total → % + 5-band via clientRosterBand", async () => {
    (getDb as any).mockReturnValue(
      makeDb({
        byTable: {
          profiles: [{ tz: "Europe/London" }],
          workout_assignments: [{ completed: 9, total: 10 }], // 90% → strong
        },
      }),
    );
    const out = await new ClientDetailRepository().getClientDetail(
      "trainer-1",
      "client-1",
      NOW,
    );
    expect(out.adherence.overall).toBe(90);
    expect(out.adherence.band).toBe("strong");
    // Workouts category is lit; protein/check-in/sleep stay unavailable.
    const cats = out.adherence.categories;
    expect(cats.find((c) => c.label === "Workouts completed")).toMatchObject({
      pct: 90,
      available: true,
    });
    // No nutrition data here → Calorie target is also unavailable (it lights
    // only when module d has logged days; covered in the calorie-hit test).
    expect(cats.filter((c) => !c.available).map((c) => c.label)).toEqual([
      "Calorie target",
      "Protein target",
      "Check-ins",
      "Sleep",
    ]);
  });

  it("QA-18: a just-onboarded client with 1-2 past-due assignments gets null/null, never 0%/crisis", async () => {
    (getDb as any).mockReturnValue(
      makeDb({
        byTable: {
          profiles: [{ tz: "Europe/London" }],
          // 2 past-due assignments, 0 completed — a raw ratio would be 0%
          // (crisis), but the sample is below ADHERENCE_MIN_SAMPLE (3).
          workout_assignments: [{ completed: 0, total: 2 }],
        },
      }),
    );
    const out = await new ClientDetailRepository().getClientDetail(
      "trainer-1",
      "client-1",
      NOW,
    );
    expect(out.adherence.overall).toBeNull();
    expect(out.adherence.band).toBeNull();
    const workoutsCat = out.adherence.categories.find(
      (c) => c.label === "Workouts completed",
    )!;
    expect(workoutsCat.available).toBe(false);
    expect(workoutsCat.pct).toBeNull();
  });

  it("QA-18: an established client with >=3 past-due assignments and low completion still shows real crisis", async () => {
    (getDb as any).mockReturnValue(
      makeDb({
        byTable: {
          profiles: [{ tz: "Europe/London" }],
          // 4 past-due assignments, 1 completed → 25%, genuinely crisis.
          workout_assignments: [{ completed: 1, total: 4 }],
        },
      }),
    );
    const out = await new ClientDetailRepository().getClientDetail(
      "trainer-1",
      "client-1",
      NOW,
    );
    expect(out.adherence.overall).toBe(25);
    expect(out.adherence.band).toBe("crisis");
  });

  it("QA-18: the adherence WHERE clause is past-due only — due_date < windowEnd, not <=", async () => {
    let capturedWhere: unknown;
    const select = () => {
      let fromTable: string | null = null;
      const chain: any = {};
      for (const k of [
        "innerJoin",
        "leftJoin",
        "groupBy",
        "orderBy",
        "limit",
        "offset",
      ]) {
        chain[k] = () => chain;
      }
      chain.from = (tbl: unknown) => {
        fromTable = is(tbl, Table) ? getTableName(tbl as Table) : String(tbl);
        return chain;
      };
      chain.where = (cond: unknown) => {
        if (fromTable === "workout_assignments") capturedWhere = cond;
        return chain;
      };
      chain.then = (res: any, rej: any) => {
        const byTable: Record<string, unknown[]> = {
          profiles: [{ tz: "Europe/London" }],
          workout_assignments: [{ completed: 0, total: 0 }],
        };
        const rows = fromTable ? (byTable[fromTable] ?? []) : [];
        return Promise.resolve(rows).then(res, rej);
      };
      return chain;
    };
    (getDb as any).mockReturnValue({ select, execute: async () => [] });

    await new ClientDetailRepository().getClientDetail(
      "trainer-1",
      "client-1",
      NOW,
    );

    const { sql } = new PgDialect().sqlToQuery(capturedWhere as never);
    const low = sql.toLowerCase();
    expect(low).toContain('"due_date" < ');
    expect(low).not.toContain('"due_date" <=');
    expect(low).toContain('"due_date" >= ');
  });

  it("calorie hit — TOTALS ONLY, ±10% boundary, calorie category lit from daysHit/daysLogged", async () => {
    nutrition.get.mockResolvedValue({ dailyKcal: 2000 } as any);
    // Per-day kcal: 1800 (=lower bound, HIT), 2200 (=upper bound, HIT),
    // 2201 (just over, MISS), and today (2026-07-08) = 500.
    const execute = vi.fn(async () => [
      { d: "2026-07-06", kcal: 1800 },
      { d: "2026-07-07", kcal: 2201 },
      { d: "2026-07-08", kcal: 500 },
      { d: "2026-07-09", kcal: 2200 },
    ]);
    (getDb as any).mockReturnValue(
      makeDb({ byTable: { profiles: [{ tz: "Europe/London" }] }, execute }),
    );

    const out = await new ClientDetailRepository().getClientDetail(
      "trainer-1",
      "client-1",
      NOW,
    );
    expect(out.calorieHit).not.toBeNull();
    const cal = out.calorieHit!;
    expect(cal.targetKcal).toBe(2000);
    expect(cal.daysLogged).toBe(4);
    expect(cal.daysHit).toBe(2); // 1800 and 2200 hit; 2201 misses; 500 misses
    expect(cal.todayKcal).toBe(500); // today = 2026-07-08
    expect(cal.todayRemainingKcal).toBe(1500);
    // Privacy line — the payload carries NO per-entry food rows.
    expect(JSON.stringify(cal)).not.toContain("entries");
    expect(Object.keys(cal).sort()).toEqual([
      "daysHit",
      "daysLogged",
      "targetKcal",
      "todayKcal",
      "todayRemainingKcal",
    ]);
    // Calorie adherence category lit from daysHit/daysLogged (2/4 = 50%).
    const cal2 = out.adherence.categories.find(
      (c) => c.label === "Calorie target",
    )!;
    expect(cal2.available).toBe(true);
    expect(cal2.pct).toBe(50);
  });

  it("calorie week-rollup GROUPs BY ordinal, TOTALS only (Postgres 42803 guard)", async () => {
    nutrition.get.mockResolvedValue({ dailyKcal: 2000 } as any);
    let executed: unknown;
    const execute = vi.fn(async (q: unknown) => {
      executed = q;
      return [];
    });
    (getDb as any).mockReturnValue(
      makeDb({ byTable: { profiles: [{ tz: "Europe/London" }] }, execute }),
    );
    await new ClientDetailRepository().getClientDetail(
      "trainer-1",
      "client-1",
      NOW,
    );
    const { sql, params } = new PgDialect().sqlToQuery(executed as never);
    const low = sql.toLowerCase();
    expect(low).toContain("group by 1"); // ordinal, not a re-bound tz expr
    expect(low).toContain("sum(kcal)"); // totals only
    expect(low).not.toContain("from nutrition_entries n2"); // no entry-row select
    // The client-local week bounds are the bind params.
    expect(params).toContain(WEEK_START);
    expect(params).toContain(WEEK_END);
    expect(params).toContain("client-1");
  });

  it("volume — sums daily into weekKg + passes the client tz/week to the repo", async () => {
    volume.dailyVolume.mockResolvedValue([
      { date: "2026-07-06", volumeKg: 600 },
      { date: "2026-07-08", volumeKg: 900 },
    ]);
    (getDb as any).mockReturnValue(
      makeDb({ byTable: { profiles: [{ tz: "Europe/London" }] } }),
    );
    const out = await new ClientDetailRepository().getClientDetail(
      "trainer-1",
      "client-1",
      NOW,
    );
    expect(out.volume.weekKg).toBe(1500);
    expect(out.volume.daily).toHaveLength(2);
    expect(volume.dailyVolume).toHaveBeenCalledWith(
      "client-1",
      "Europe/London",
      WEEK_START,
      WEEK_END,
    );
    expect(out.thisWeek.volumeKg).toBe(1500);
  });

  it("PRs — maps recordType→type + kg unit, and counts PRs achieved this week", async () => {
    home.getRecentPRs.mockResolvedValue([
      {
        recordType: "1rm",
        exerciseName: "Bench",
        value: 100,
        achievedAt: "2026-07-07T09:00:00.000Z", // in-week
      },
      {
        recordType: "max_volume",
        exerciseName: "Squat",
        value: 5000,
        achievedAt: "2026-06-01T09:00:00.000Z", // out of week
      },
    ]);
    (getDb as any).mockReturnValue(
      makeDb({ byTable: { profiles: [{ tz: "Europe/London" }] } }),
    );
    const out = await new ClientDetailRepository().getClientDetail(
      "trainer-1",
      "client-1",
      NOW,
    );
    expect(out.prs[0]).toEqual({
      type: "1rm",
      exerciseName: "Bench",
      value: 100,
      unit: "kg",
      achievedAt: "2026-07-07T09:00:00.000Z",
    });
    expect(out.thisWeek.prs).toBe(1); // only the in-week PR counts
  });

  it("goal — most-recent active goal, title via goal_types, weight axis + pct + assignedByCoach", async () => {
    // getGoal issues two selects: userGoals (join goal_types), then
    // body_measurements. Key both by table.
    (getDb as any).mockReturnValue(
      makeDb({
        byTable: {
          profiles: [{ tz: "Europe/London" }],
          user_goals: [
            {
              id: "goal-1",
              title: "Lose weight",
              unit: "kg",
              targetValue: "80",
              targetDate: "2026-10-01",
              assignedByUserId: "trainer-1",
            },
          ],
          body_measurements: [
            { weightKg: "90", measuredAt: new Date("2026-06-20") },
            { weightKg: "85", measuredAt: new Date("2026-07-05") },
          ],
        },
      }),
    );
    const out = await new ClientDetailRepository().getClientDetail(
      "trainer-1",
      "client-1",
      NOW,
    );
    expect(out.goal).toEqual({
      id: "goal-1",
      title: "Lose weight",
      unit: "kg",
      targetDate: "2026-10-01",
      assignedByCoach: true, // assigned_by_user_id === trainerId
      weight: { startKg: 90, nowKg: 85, targetKg: 80 },
      pct: 0.5, // (85-90)/(80-90) = 0.5
    });
  });

  it("goal — assignedByCoach false when assigned by someone else / self", async () => {
    (getDb as any).mockReturnValue(
      makeDb({
        byTable: {
          profiles: [{ tz: "Europe/London" }],
          user_goals: [
            {
              id: "goal-2",
              title: "Run 5k",
              unit: null,
              targetValue: null,
              assignedByUserId: null, // self-set
            },
          ],
          body_measurements: [],
        },
      }),
    );
    const out = await new ClientDetailRepository().getClientDetail(
      "trainer-1",
      "client-1",
      NOW,
    );
    expect(out.goal!.assignedByCoach).toBe(false);
    // No weigh-ins + no target → axis all null, pct null.
    expect(out.goal!.weight).toEqual({
      startKg: null,
      nowKg: null,
      targetKg: null,
    });
    expect(out.goal!.pct).toBeNull();
  });

  it("habits — per-habit satisfaction (weekMet) + collection streak, reusing Phase-7 aggregates", async () => {
    streaks.getCollectionHabitAggregates.mockResolvedValue([
      {
        goalId: "water-goal",
        completionRule: "value_gte",
        targetValue: 2,
        daysPerWeek: 5,
        tolerancePct: null,
        qualifyingDays: 5,
        sessionCount: 0,
      },
      {
        goalId: "gym-goal",
        completionRule: "count",
        targetValue: 4,
        daysPerWeek: null,
        tolerancePct: null,
        qualifyingDays: 0,
        sessionCount: 2,
      },
    ]);
    streaks.getCollectionHabitStreak.mockResolvedValue({
      currentCount: 3,
    } as any);
    (getDb as any).mockReturnValue(
      makeDb({
        byTable: {
          profiles: [{ tz: "Europe/London" }],
          habit_configs: [
            { goalId: "water-goal", category: "water", label: "Water" },
            { goalId: "gym-goal", category: "gym", label: "Gym" },
          ],
        },
      }),
    );
    const out = await new ClientDetailRepository().getClientDetail(
      "trainer-1",
      "client-1",
      NOW,
    );
    expect(out.habits).not.toBeNull();
    const h = out.habits!;
    expect(h.collectionStreak).toBe(3);
    const water = h.habits.find((x) => x.goalId === "water-goal")!;
    const gym = h.habits.find((x) => x.goalId === "gym-goal")!;
    expect(water).toMatchObject({
      label: "Water",
      category: "water",
      met: true,
      pct: 1,
    });
    // gym: 2 of 4 sessions → not met, pct 0.5
    expect(gym).toMatchObject({ label: "Gym", met: false, pct: 0.5 });
    // Collection not satisfied — gym unmet.
    expect(h.collectionSatisfied).toBe(false);
  });

  it("recentSessions — client's completed sessions newest-first, ISO completedAt", async () => {
    (getDb as any).mockReturnValue(
      makeDb({
        byTable: {
          profiles: [{ tz: "Europe/London" }],
          workout_sessions: [
            {
              id: "s2",
              name: "Push B",
              completedAt: new Date("2026-07-07T18:00:00.000Z"),
            },
            { id: "s1", name: null, completedAt: "2026-07-05T18:00:00.000Z" },
          ],
        },
      }),
    );
    const out = await new ClientDetailRepository().getClientDetail(
      "trainer-1",
      "client-1",
      NOW,
    );
    expect(out.recentSessions).toEqual([
      {
        id: "s2",
        name: "Push B",
        completedAt: "2026-07-07T18:00:00.000Z",
        volumeKg: null,
      },
      {
        id: "s1",
        name: null,
        completedAt: "2026-07-05T18:00:00.000Z",
        volumeKg: null,
      },
    ]);
  });

  it("notes — scoped to (trainer, client); never leak across trainers", async () => {
    (getDb as any).mockReturnValue(
      makeDb({
        byTable: {
          profiles: [{ tz: "Europe/London" }],
          trainer_client_notes: [
            {
              id: "n1",
              noteType: "progress",
              title: "Great month",
              content: "Squat up 10kg",
              createdAt: new Date("2026-07-01T00:00:00.000Z"),
            },
          ],
        },
      }),
    );
    const rep = new ClientDetailRepository();
    const out = await rep.getClientDetail("trainer-1", "client-1", NOW);
    expect(out.notes).toEqual([
      {
        id: "n1",
        noteType: "progress",
        title: "Great month",
        content: "Squat up 10kg",
        createdAt: "2026-07-01T00:00:00.000Z",
      },
    ]);

    // A DIFFERENT trainer with no notes row for this client sees an empty list
    // — the same table result is empty because the WHERE is (trainer, client).
    (getDb as any).mockReturnValue(
      makeDb({
        byTable: {
          profiles: [{ tz: "Europe/London" }],
          trainer_client_notes: [], // no row for trainer-2 + client-1
        },
      }),
    );
    const out2 = await rep.getClientDetail("trainer-2", "client-1", NOW);
    expect(out2.notes).toEqual([]);
  });

  it("workoutsPlanned — counts the week's assignments only when an active programme exists", async () => {
    programmes.getActiveProgrammeForClient.mockResolvedValue({
      assignmentId: "a1",
    } as any);
    volume.completedSessionCount.mockResolvedValue(2);
    (getDb as any).mockReturnValue(
      makeDb({
        byTable: {
          profiles: [{ tz: "Europe/London" }],
          workout_assignments: [{ c: 3 }], // count(*) this week
        },
      }),
    );
    const out = await new ClientDetailRepository().getClientDetail(
      "trainer-1",
      "client-1",
      NOW,
    );
    expect(out.thisWeek.workoutsPlanned).toBe(3);
    expect(out.thisWeek.workoutsCompleted).toBe(2);
  });

  // ── Module g (AI summary) read — the aggregate NEVER infers ─────────────────

  const CACHED_ROW = {
    id: "sum-1",
    summary: "Solid week — hit calories 4/6 logged days. Focus: protein.",
    model: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
    refreshCount: 0,
    generatedAt: new Date("2026-07-08T06:00:00.000Z"),
  };

  it("aiSummary — cached row for the concluded day, refresh unused + coach can spend ⇒ canManualRefresh true", async () => {
    countSummaryTodayMock.mockResolvedValue(3); // under the 40 default
    (getDb as any).mockReturnValue(
      makeDb({
        byTable: {
          profiles: [{ tz: "Europe/London" }],
          client_ai_summaries: [CACHED_ROW],
        },
      }),
    );
    const out = await new ClientDetailRepository().getClientDetail(
      "trainer-1",
      "client-1",
      NOW,
    );
    expect(out.aiSummary).toEqual({
      summary: CACHED_ROW.summary,
      coversDate: COVERS_DATE,
      generatedAt: "2026-07-08T06:00:00.000Z",
      canManualRefresh: true,
    });
    expect(assertEntitlementMock).toHaveBeenCalledWith(
      "trainer-1",
      "ai_access",
    );
  });

  it("aiSummary — the one manual refresh already spent (refresh_count ≥ 1) ⇒ canManualRefresh false, no entitlement/ceiling read", async () => {
    (getDb as any).mockReturnValue(
      makeDb({
        byTable: {
          profiles: [{ tz: "Europe/London" }],
          client_ai_summaries: [{ ...CACHED_ROW, refreshCount: 1 }],
        },
      }),
    );
    const out = await new ClientDetailRepository().getClientDetail(
      "trainer-1",
      "client-1",
      NOW,
    );
    expect(out.aiSummary.summary).toBe(CACHED_ROW.summary);
    expect(out.aiSummary.canManualRefresh).toBe(false);
    // Short-circuits on the spent refresh — never spends a read on entitlement.
    expect(assertEntitlementMock).not.toHaveBeenCalled();
    expect(countSummaryTodayMock).not.toHaveBeenCalled();
  });

  it("aiSummary — coach over the daily ceiling ⇒ canManualRefresh false", async () => {
    countSummaryTodayMock.mockResolvedValue(40); // at the 40 default ceiling
    (getDb as any).mockReturnValue(
      makeDb({
        byTable: {
          profiles: [{ tz: "Europe/London" }],
          client_ai_summaries: [CACHED_ROW],
        },
      }),
    );
    const out = await new ClientDetailRepository().getClientDetail(
      "trainer-1",
      "client-1",
      NOW,
    );
    expect(out.aiSummary.canManualRefresh).toBe(false);
  });

  it("aiSummary — coach lacks ai_access ⇒ canManualRefresh false (ceiling not even read)", async () => {
    assertEntitlementMock.mockResolvedValue({ allowed: false });
    (getDb as any).mockReturnValue(
      makeDb({
        byTable: {
          profiles: [{ tz: "Europe/London" }],
          client_ai_summaries: [CACHED_ROW],
        },
      }),
    );
    const out = await new ClientDetailRepository().getClientDetail(
      "trainer-1",
      "client-1",
      NOW,
    );
    expect(out.aiSummary.canManualRefresh).toBe(false);
    expect(countSummaryTodayMock).not.toHaveBeenCalled();
  });
});
