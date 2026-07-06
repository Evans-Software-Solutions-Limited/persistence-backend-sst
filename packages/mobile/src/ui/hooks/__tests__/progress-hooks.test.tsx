import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  useGetHome,
  useGetTodayRings,
  useGetWeeklyVolume,
  useGetRecentPRs,
  useGetPRHistory,
  useGetVolumeStats,
  useGetBodyMeasurements,
  useGetAchievements,
  useGetStreaks,
  useGetHabits,
  buildHabitGrid,
  useToggleHabitDay,
  useLogMeasurement,
  useUseFreezeToken,
} from "@/ui/hooks";
// `today` in these habit tests MUST be derived the SAME way the hook is
// (device-local calendar day via localDayISO), not from `new Date().toISOString()`
// (UTC). The two diverge just after local midnight in a positive-offset zone —
// e.g. 00:30 BST Monday is still Sunday in UTC — which put the test's UTC "today"
// in the PREVIOUS Mon→Sun window and failed `weekDates.indexOf(today)` on Mondays.
import { localDayISO } from "@/shared/utils";

const mockFetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: {} }),
}));
(globalThis as Record<string, unknown>).fetch = mockFetch;

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

const USER = "user-1";

function makeAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
): Adapters {
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: USER,
    email: "u@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  return {
    api,
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
    netInfo: {} as Adapters["netInfo"],
  };
}

function wrap(adapters: Adapters) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

function setup() {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  return { api, storage, wrapper: wrap(makeAdapters(api, storage)) };
}

beforeEach(() => mockFetch.mockClear());

describe("Progress/Home read hooks (cache-first + refresh)", () => {
  it("useGetHome populates from the aggregate endpoint", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useGetHome(), { wrapper });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.data?.rings.fuel).toBe("gated");
  });

  it("useGetTodayRings seeds from cached home then refreshes", async () => {
    const { storage, wrapper } = setup();
    storage.cacheHome(USER, {
      rings: {
        move: { current: 5, target: 10, pct: 0.5, unit: "steps" },
        train: { current: 0, target: 1, pct: 0, unit: "kg" },
        fuel: "gated",
        todayPct: 25,
      },
      micro: { streak: 0, water: null, strain: null, sleep: null },
      weeklyVolume: {
        days: [],
        totalKg: 0,
        deltaPct: null,
        workouts: { completed: 0, target: 5 },
      },
      recentPRs: [],
      habits: [],
      todayWorkout: [],
    });
    const { result } = renderHook(() => useGetTodayRings(), { wrapper });
    expect(result.current.data?.move.current).toBe(5); // cache-first
    await waitFor(() => expect(result.current.isRefreshing).toBe(false));
  });

  it("useGetWeeklyVolume refreshes", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useGetWeeklyVolume(), { wrapper });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.data?.workouts.target).toBe(5);
  });

  it("useGetRecentPRs caches PRs", async () => {
    const { api, storage, wrapper } = setup();
    api.recentPRs = [
      {
        id: "pr1",
        userId: USER,
        exerciseId: "e1",
        exerciseName: "Bench",
        recordType: "1rm",
        value: 100,
        achievedAt: "2026-06-07T00:00:00.000Z",
        sessionId: null,
        setId: null,
      },
    ];
    const { result } = renderHook(() => useGetRecentPRs(5), { wrapper });
    await waitFor(() => expect(result.current.data?.length).toBe(1));
    expect(storage.getPersonalRecords(USER).length).toBe(1);
  });

  it("useGetPRHistory uses the deeper limit", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useGetPRHistory(), { wrapper });
    await waitFor(() => expect(result.current.data).not.toBeNull());
  });

  it("useGetVolumeStats refreshes + caches", async () => {
    const { storage, wrapper } = setup();
    const { result } = renderHook(() => useGetVolumeStats("month"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(storage.getCachedVolumeStats(USER)).not.toBeNull();
  });

  it("useGetBodyMeasurements refreshes", async () => {
    const { api, wrapper } = setup();
    api.bodyTrend = [{ date: "2026-06-01", weightKg: 80, bodyFat: null }];
    const { result } = renderHook(() => useGetBodyMeasurements(30), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data?.length).toBe(1));
  });

  it("useGetAchievements refreshes", async () => {
    const { api, wrapper } = setup();
    api.achievements = [
      {
        id: "ua1",
        achievementId: "a1",
        name: "Streak",
        description: null,
        category: "streak",
        requirements: null,
        unlockedAt: null,
      },
    ];
    const { result } = renderHook(() => useGetAchievements(), { wrapper });
    await waitFor(() => expect(result.current.data?.length).toBe(1));
  });

  it("useGetStreaks refreshes from the API", async () => {
    const { api, wrapper } = setup();
    api.streaks = [
      {
        id: "s1",
        userId: USER,
        streakType: "workout_streak",
        sourceGoalId: null,
        period: "weekly",
        currentCount: 4,
        longestCount: 8,
        lastPeriodEnd: "2026-06-07",
        freezeTokens: 2,
        status: "active",
      },
    ];
    const { result } = renderHook(() => useGetStreaks(), { wrapper });
    await waitFor(() => expect(result.current.data?.length).toBe(1));
    expect(result.current.data?.[0].freezeTokens).toBe(2);
  });

  it("useGetHabits builds the 7-day grid", async () => {
    const { api, wrapper } = setup();
    api.habitCompletions = [
      {
        id: "h1",
        userId: USER,
        goalId: "g1",
        completedAt: new Date().toISOString(),
        // Anchor to the device-local day (same basis as the hook's window) so
        // the completion always lands inside this week's Mon→Sun grid, even
        // just after local midnight when the UTC day is still yesterday.
        localCompletedDate: localDayISO(),
        value: null,
      },
    ];
    const { result } = renderHook(() => useGetHabits(), { wrapper });
    await waitFor(() => expect(result.current.habits.length).toBe(1));
    // Mon→Sun grid: today's single completion lands on exactly one day (today),
    // wherever it falls in the week — no longer always the last column.
    expect(result.current.habits[0].days).toHaveLength(7);
    expect(result.current.habits[0].days.filter(Boolean)).toHaveLength(1);
  });

  describe("buildHabitGrid (config-aware)", () => {
    const week = [
      "2026-06-22",
      "2026-06-23",
      "2026-06-24",
      "2026-06-25",
      "2026-06-26",
      "2026-06-27",
      "2026-06-28",
    ];
    const cfg = (over: Record<string, unknown>) => ({
      category: "water",
      enabled: true,
      goalId: "g-water",
      assignedByCoach: false,
      locked: false,
      targetValue: 2,
      unit: "L",
      period: "daily",
      completionRule: "value_gte",
      daysPerWeek: null,
      tolerancePct: null,
      pending: null,
      ...over,
    });

    it("renders one tile per enabled config with mapped label/tone, even with no completions", () => {
      const habits = buildHabitGrid([], week, [
        cfg({ category: "water", goalId: "g-water" }),
        cfg({ category: "gym", goalId: "g-gym" }),
      ]);
      expect(habits).toHaveLength(2);
      expect(habits[0]).toMatchObject({ label: "Water", tone: "primary" });
      expect(habits[1]).toMatchObject({ label: "Gym", tone: "success" });
      // No completions → all 7 days false.
      expect(habits[0].days.filter(Boolean)).toHaveLength(0);
    });

    it("marks completion days against the configured goal", () => {
      const habits = buildHabitGrid(
        [
          {
            id: "c1",
            userId: USER,
            goalId: "g-water",
            completedAt: `${week[2]}T10:00:00.000Z`,
            localCompletedDate: week[2],
            value: null,
          },
        ],
        week,
        [cfg({ category: "water", goalId: "g-water" })],
      );
      expect(habits[0].days[2]).toBe(true);
      expect(habits[0].days.filter(Boolean)).toHaveLength(1);
    });

    it("filters out disabled configs and ones with no goalId", () => {
      const habits = buildHabitGrid([], week, [
        cfg({ category: "water", goalId: "g-water", enabled: true }),
        cfg({ category: "gym", goalId: "g-gym", enabled: false }),
        cfg({ category: "sleep", goalId: null, enabled: true }),
      ]);
      expect(habits).toHaveLength(1);
      expect(habits[0].label).toBe("Water");
    });

    it("falls back to the category name + primary tone for an unknown category", () => {
      const habits = buildHabitGrid([], week, [
        cfg({ category: "meditation", goalId: "g-x" }),
      ]);
      expect(habits[0]).toMatchObject({ label: "meditation", tone: "primary" });
    });

    it("uses the completions-only legacy path when no configs are supplied", () => {
      const habits = buildHabitGrid(
        [
          {
            id: "c1",
            userId: USER,
            goalId: "g-legacy",
            completedAt: `${week[1]}T10:00:00.000Z`,
            localCompletedDate: week[1],
            value: null,
          },
        ],
        week,
        [],
      );
      expect(habits).toHaveLength(1);
      expect(habits[0].id).toBe("g-legacy");
    });
  });

  it("buckets a habit by its local day, not the completedAt UTC slice (tz≥+12)", async () => {
    const { api, wrapper } = setup();
    const today = localDayISO();
    // completedAt is the PRIOR calendar day in UTC, but the server's
    // authoritative local day is today — a tz≥+12 morning toggle the server
    // clamped back. The grid must mark today's column, not the prior day's.
    const prior = new Date(`${today}T00:00:00.000Z`);
    prior.setUTCDate(prior.getUTCDate() - 1);
    api.habitCompletions = [
      {
        id: "h1",
        userId: USER,
        goalId: "g1",
        completedAt: `${prior.toISOString().slice(0, 10)}T19:00:00.000Z`,
        localCompletedDate: today,
        value: null,
      },
    ];
    const { result } = renderHook(() => useGetHabits(), { wrapper });
    await waitFor(() => expect(result.current.habits.length).toBe(1));
    const { weekDates, habits } = result.current;
    const todayIdx = weekDates.indexOf(today);
    expect(todayIdx).toBeGreaterThanOrEqual(0);
    const trueCols = habits[0].days
      .map((d, i) => (d ? i : -1))
      .filter((i) => i >= 0);
    expect(trueCols).toEqual([todayIdx]);
  });

  it("useGetHabits exposes a Mon→Sun weekDates window aligned with the grid", async () => {
    const { api, wrapper } = setup();
    const today = localDayISO();
    api.habitCompletions = [
      {
        id: "h1",
        userId: USER,
        goalId: "g1",
        completedAt: new Date().toISOString(),
        // Local-day anchor (see the import note) so the completion buckets to
        // today's column regardless of the UTC/local day offset.
        localCompletedDate: today,
        value: null,
      },
    ];
    const { result } = renderHook(() => useGetHabits(), { wrapper });
    await waitFor(() => expect(result.current.habits.length).toBe(1));
    const { weekDates, habits } = result.current;
    expect(weekDates).toHaveLength(7);
    // Monday-first + strictly ascending (lexicographic == chronological here).
    expect([...weekDates].sort()).toEqual(weekDates);
    // The single `true` column is exactly the one weekDates labels as today —
    // weekDates and the grid columns are built from one shared window, so they
    // can never index different weeks (regression: weekDates was frozen at
    // mount while the grid re-captured the day, drifting after midnight).
    const idx = weekDates.indexOf(today);
    expect(idx).toBeGreaterThanOrEqual(0);
    const trueCols = habits[0].days
      .map((d, i) => (d ? i : -1))
      .filter((i) => i >= 0);
    expect(trueCols).toEqual([idx]);
  });
});

describe("Progress/Home mutation hooks", () => {
  it("useToggleHabitDay flips the cache + enqueues", async () => {
    const { storage, wrapper } = setup();
    const { result } = renderHook(() => useToggleHabitDay(), { wrapper });
    await act(async () => {
      await result.current.mutate({
        goalId: "g1",
        day: "2026-06-10",
        done: true,
      });
    });
    expect(
      storage.getCachedHabitCompletions(USER, { goalId: "g1" }),
    ).toHaveLength(1);
  });

  it("useLogMeasurement appends body-trend + validates", async () => {
    const { storage, wrapper } = setup();
    const { result } = renderHook(() => useLogMeasurement(), { wrapper });
    let res: { ok: boolean } | undefined;
    await act(async () => {
      res = await result.current.mutate({ weightKg: 82.5 }, "2026-06-10");
    });
    expect(res?.ok).toBe(true);
    expect(storage.getCachedBodyTrend(USER)).toHaveLength(1);

    let bad: { ok: boolean } | undefined;
    await act(async () => {
      bad = await result.current.mutate({});
    });
    expect(bad?.ok).toBe(false);
  });

  it("useUseFreezeToken updates the cached streak", async () => {
    const { storage, wrapper } = setup();
    storage.cacheStreaks(USER, [
      {
        id: "s1",
        userId: USER,
        streakType: "workout_streak",
        sourceGoalId: null,
        period: "weekly",
        currentCount: 4,
        longestCount: 4,
        lastPeriodEnd: "2026-06-07",
        freezeTokens: 2,
        status: "active",
      },
    ]);
    const { result } = renderHook(() => useUseFreezeToken(), { wrapper });
    await act(async () => {
      await result.current.mutate("s1");
    });
    // in-memory adapter returns freezeTokens: 0 for the streak
    expect(storage.getCachedStreaks(USER)[0].freezeTokens).toBe(0);
  });
});
