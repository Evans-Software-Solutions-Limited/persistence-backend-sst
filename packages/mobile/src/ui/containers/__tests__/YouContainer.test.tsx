import { act, render, waitFor } from "@testing-library/react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Achievement } from "@/domain/models/achievement";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import type { YouPresenterProps } from "@/ui/presenters/YouPresenter";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { PROFILE_PAGE_FIXTURE } from "@/adapters/api/__tests__/fixtures/profile-page.fixture";
import type { Exercise } from "@/domain/models/exercise";
import { session as finished } from "@/domain/services/__tests__/youFixtures";
import type { RemoteMuscleVolume } from "@/domain/models/trainingReads";
import {
  remoteChestRow,
  remoteTotals,
} from "@/application/queries/__tests__/youRemoteFixtures";
import {
  YouContainer,
  bodyTile,
  buildMilestoneTiers,
  coachSubtitle,
} from "../YouContainer";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));
jest.mock("@/state/drawer", () => ({ useDrawer: () => jest.fn() }));
// Holder so a test can re-fire the focus callback (simulate returning to the
// You tab). The `mock` prefix lets jest.mock reference it despite hoisting.
const mockFocus: { cb: (() => void | (() => void)) | null } = { cb: null };
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useNavigation: () => ({ addListener: () => () => {} }),
  // One-shot on mount + re-fireable via mockFocus.cb() (mirrors the shape used
  // in ProfileContainer's test).
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = jest.requireActual("react") as typeof import("react");
    mockFocus.cb = cb;
    React.useEffect(() => {
      const cleanup = cb();
      return typeof cleanup === "function" ? cleanup : undefined;
    }, [cb]);
  },
}));

const mockProbe: { last: YouPresenterProps | null } = { last: null };
jest.mock("@/ui/presenters/YouPresenter", () => ({
  YouPresenter: (props: YouPresenterProps) => {
    mockProbe.last = props;
    return null;
  },
}));

const mockFetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: {} }),
}));
(globalThis as Record<string, unknown>).fetch = mockFetch;

describe("buildMilestoneTiers", () => {
  it("marks workout-streak tiers earned from achievements", () => {
    const achievements: Achievement[] = [
      {
        id: "ua1",
        achievementId: "a1",
        name: "Workout Streak — 4 weeks",
        description: null,
        category: "streak",
        requirements: { streak_type: "workout_streak", threshold: 4 },
        unlockedAt: null,
      },
    ];
    const tiers = buildMilestoneTiers(achievements);
    expect(tiers).toHaveLength(5);
    expect(tiers.find((t) => t.label === "4w")?.earned).toBe(true);
    expect(tiers.find((t) => t.label === "1w")?.earned).toBe(false);
  });

  it("returns all-unearned for an empty set", () => {
    expect(buildMilestoneTiers([]).every((t) => !t.earned)).toBe(true);
  });
});

function makeAdapters() {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: "user-1",
    email: "alex@example.com",
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
    adapters: {
      api,
      auth,
      storage,
      health: {
        isAvailable: jest.fn(async () => false),
        getPermissionStatus: jest.fn(async () => ({
          steps: "not_determined",
          calories: "not_determined",
          bodyWeight: "not_determined",
          heartRate: "not_determined",
        })),
        writeBodyWeight: jest.fn(async () => ok(undefined)),
      } as unknown as Adapters["health"],
      notifications: {} as Adapters["notifications"],
      netInfo: {} as Adapters["netInfo"],
    } as Adapters,
  };
}

const healthAdapter = (over: Record<string, unknown> = {}) =>
  ({
    isAvailable: jest.fn(async () => true),
    getPermissionStatus: jest.fn(async () => ({
      steps: "granted",
      calories: "granted",
      bodyWeight: "granted",
      heartRate: "granted",
    })),
    getStepsToday: jest.fn(async () => ok(0)),
    getStepsLastNDays: jest.fn(async () => ok([])),
    getActiveCaloriesToday: jest.fn(async () => ok(0)),
    getBasalCaloriesToday: jest.fn(async () => ok(0)),
    getStandTimeTodayMinutes: jest.fn(async () => ok(0)),
    getLatestBodyWeight: jest.fn(async () => ok(null)),
    getHeartRateLatest: jest.fn(async () => ok(null)),
    getLatestBodyFat: jest.fn(async () => ok(null)),
    writeBodyWeight: jest.fn(async () => ok(undefined)),
    ...over,
  }) as unknown as Adapters["health"];

const ex = (id: string, primary: string[], secondary: string[] = []) =>
  ({
    id,
    name: id,
    description: null,
    instructions: null,
    category: "strength",
    difficulty: "intermediate",
    primaryMuscleGroups: primary,
    secondaryMuscleGroups: secondary,
    equipment: [],
    videoUrl: null,
    thumbnailUrl: null,
    isCustom: false,
    createdBy: null,
  }) as unknown as Exercise;

const renderYou = (adapters: Adapters) =>
  render(
    <AdapterProvider adapters={adapters}>
      <YouContainer />
    </AdapterProvider>,
  );

describe("YouContainer", () => {
  beforeEach(() => {
    mockProbe.last = null;
    mockFocus.cb = null;
    mockFetch.mockClear();
    mockPush.mockClear();
  });

  it("routes every Y1 action", async () => {
    const { adapters } = makeAdapters();
    renderYou(adapters);
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    const p = mockProbe.last!;
    const cases: [() => void, string][] = [
      [p.onOpenWeight, "/(app)/weight-history"],
      [p.onOpenBodyFat, "/(app)/body-fat-history"],
      [p.onOpenHistory, "/(app)/history"],
      [p.onOpenRecap, "/(app)/recap"],
      [p.onOpenBadges, "/(app)/achievements"],
      [p.onOpenRequests, "/(app)/requests"],
      [p.onOpenAcceptInvite, "/(app)/accept-invite"],
    ];
    for (const [fn, path] of cases) {
      act(() => fn());
      expect(mockPush).toHaveBeenLastCalledWith(path);
    }
    // Pull-to-refresh fans out to every read without throwing.
    await act(async () => {
      p.onRefresh();
    });
    // No gallery until APP-F1.
    expect(p.gallery).toBeNull();
  });

  it("new user: an empty week, no Rest group and no lifts", async () => {
    const { adapters } = makeAdapters();
    renderYou(adapters);
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    const p = mockProbe.last!;
    expect(p.lastSevenDays).toEqual({
      workouts: "0",
      volume: "0.0 t",
      time: "0h 00m",
    });
    expect(p.muscles.rest).toBeNull();
    expect(p.muscles.trainNext?.text).toBe("Back, quads, chest");
    expect(p.muscles.gender).toBe("male");
    expect(p.topLifts).toEqual([]);
    expect(p.coaches).toEqual([]);
    expect(p.badges.map((b) => b.label)).toEqual([
      "1w",
      "2w",
      "4w",
      "2mo",
      "3mo",
    ]);
    // The first read stamps when this phone started its training log.
    expect(adapters.storage.getTrainingLogSince("user-1")).not.toBeNull();
  });

  it("works out muscles, the 7-day strip and top lifts from the training log", async () => {
    const { adapters } = makeAdapters();
    adapters.storage.cacheExercises([
      ex("bench", ["chest"], ["triceps"]),
      ex("squat", ["quadriceps"]),
    ]);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const lastMonth = new Date(Date.now() - 20 * 86_400_000).toISOString();
    adapters.storage.saveTrainingLogEntry(
      "user-1",
      finished("s1", yesterday, {
        bench: Array.from({ length: 10 }, () => [100, 5] as [number, number]),
        squat: [[120, 7]],
      }),
    );
    adapters.storage.saveTrainingLogEntry(
      "user-1",
      finished("old", lastMonth, { squat: [[200, 1]] }),
    );
    renderYou(adapters);
    await waitFor(() => expect(mockProbe.last?.topLifts.length).toBe(2));
    const p = mockProbe.last!;
    expect(p.lastSevenDays).toEqual({
      workouts: "1",
      volume: "5.8 t",
      time: "1h 00m",
    });
    expect(p.muscles.rest?.text).toBe("Chest");
    expect(p.muscles.shading.regions).toEqual(
      expect.arrayContaining([{ slug: "chest", intensity: 4 }]),
    );
    expect(p.muscles.shading.accessibilityLabel).toContain("Rest: chest");
    // Squat 120 × 7 ≈ 148 kg beats bench 100 × 5 ≈ 116.7 kg; last month's
    // 200 kg single is outside the window.
    expect(p.topLifts.map((l) => l.name)).toEqual(["Squat", "Bench"]);
    expect(p.topLifts[0]!.value).toBe("148.0 kg");
  });

  it("follows profile sex for the figure and shows every active coach", async () => {
    const { api, adapters } = makeAdapters();
    api.profilePage = {
      ...PROFILE_PAGE_FIXTURE,
      profile: { ...PROFILE_PAGE_FIXTURE.profile, gender: "female" },
    };
    const rel = (
      id: string,
      name: string,
      status: "active" | "pending",
      initiatedBy: "trainer" | "client" = "trainer",
    ) => ({
      relationshipId: id,
      trainerId: `t-${id}`,
      trainerName: name,
      trainerRole: "personal_trainer",
      trainerAvatarUrl: null,
      status,
      relationshipReason: null,
      since: "2026-03-04T00:00:00.000Z",
      initiatedBy,
    });
    api.clientRelationships = [
      rel("r1", "Ellie Hart", "active"),
      rel("r2", "Marcus Lee", "active"),
      rel("r3", "Pat", "pending"),
      rel("r4", "Sam", "pending", "client"),
    ];
    renderYou(adapters);
    await waitFor(() => expect(mockProbe.last?.coaches).toHaveLength(2));
    await waitFor(() => expect(mockProbe.last?.muscles.gender).toBe("female"));
    const p = mockProbe.last!;
    expect(p.coaches[0]).toEqual({
      id: "r1",
      initials: "EH",
      name: "Ellie Hart",
      subtitle: "Personal Trainer · since Mar 2026",
    });
    expect(p.pendingRequestCount).toBe(1);
    expect(p.myPendingCoachRequests).toEqual([
      { relationshipId: "r4", trainerName: "Sam" },
    ]);
    expect(p.initials).toBe("BS");
  });

  it("asks the BE-H1 seam for a week the phone only partly kept (Inspector Brad #541)", async () => {
    const lastSevenDays = jest.fn(async () => ({
      status: "unavailable" as const,
    }));
    const remote = { historyMonth: jest.fn(), recap: jest.fn(), lastSevenDays };
    // A fresh log (starts now): the 7-day window begins before it.
    const fresh = makeAdapters();
    const r = render(
      <AdapterProvider adapters={fresh.adapters}>
        <YouContainer remote={remote} />
      </AdapterProvider>,
    );
    await waitFor(() => expect(lastSevenDays).toHaveBeenCalled());
    r.unmount();

    // A log kept long before the window: the phone has the whole week.
    lastSevenDays.mockClear();
    const kept = makeAdapters();
    kept.adapters.storage.markTrainingLogSince(
      "user-1",
      "2020-01-01T00:00:00.000Z",
    );
    mockProbe.last = null;
    render(
      <AdapterProvider adapters={kept.adapters}>
        <YouContainer remote={remote} />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    expect(lastSevenDays).not.toHaveBeenCalled();
  });

  it("shows the server's week once BE-H1 answers for a part-kept week", async () => {
    const week: RemoteMuscleVolume = {
      days: 7,
      from: "x",
      to: "y",
      timezone: "Europe/London",
      bodyType: "male",
      muscles: [{ ...remoteChestRow, credit: 12, ratio: 1, level: 4 }],
      trainNext: [],
      rest: ["chest"],
      totals: { ...remoteTotals, workouts: 3 },
      topLifts: [
        {
          exerciseId: "bench",
          name: "Bench press",
          weightKg: 100,
          reps: 5,
          startedAt: new Date().toISOString(),
          oneRepMaxKg: 116.7,
          isRecord: true,
        },
      ],
      asOf: "x",
    };
    const remote = {
      historyMonth: jest.fn(),
      recap: jest.fn(),
      lastSevenDays: jest.fn(async () => ({
        status: "ok" as const,
        data: week,
      })),
    };
    const { adapters } = makeAdapters();
    render(
      <AdapterProvider adapters={adapters}>
        <YouContainer remote={remote} />
      </AdapterProvider>,
    );
    await waitFor(() =>
      expect(mockProbe.last?.lastSevenDays.workouts).toBe("3"),
    );
    expect(mockProbe.last!.muscles.rest?.text).toMatch(/chest/i);
    expect(mockProbe.last!.topLifts[0]).toMatchObject({ name: "Bench press" });
  });

  it("keeps the phone's week while the server's lacks a workout the phone holds, and asks again after the sync renames it (Inspector Brad #545)", async () => {
    const week = (ids: string[]): RemoteMuscleVolume => ({
      days: 7,
      from: "x",
      to: "y",
      timezone: "Europe/London",
      bodyType: "male",
      muscles: [remoteChestRow],
      trainNext: ["chest"],
      rest: [],
      totals: { ...remoteTotals, workouts: ids.length },
      topLifts: [],
      sessionIds: ids,
      asOf: "x",
    });
    const lastSevenDays = jest
      .fn()
      .mockResolvedValueOnce({
        status: "ok" as const,
        data: week(["s1", "s2", "s3"]),
      })
      .mockResolvedValue({
        status: "ok" as const,
        data: week(["s1", "s2", "s3", "srv-a"]),
      });
    const remote = { historyMonth: jest.fn(), recap: jest.fn(), lastSevenDays };
    const { adapters } = makeAdapters();
    const storage = adapters.storage;
    storage.saveTrainingLogEntry(
      "user-1",
      finished("local-a", new Date().toISOString(), { bench: [[100, 5]] }),
    );
    render(
      <AdapterProvider adapters={adapters}>
        <YouContainer remote={remote} />
      </AdapterProvider>,
    );
    await waitFor(() => expect(lastSevenDays).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mockProbe.last?.lastSevenDays.workouts).toBe("1"),
    );
    // The sync swaps the local id for the server's: the page asks again
    // and, now that the server counts it, shows the server's week.
    // (SQLite's change listener fires on the rename; the in-memory adapter
    // needs telling.)
    act(() => {
      storage.linkTrainingLogSessionId("local-a", "srv-a");
      (storage as InMemoryStorageAdapter).emitChange("training_log");
    });
    await waitFor(() => expect(lastSevenDays).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(mockProbe.last?.lastSevenDays.workouts).toBe("4"),
    );
  });

  it("drops yesterday's server week after midnight when the new ask finds nothing (Inspector Brad #545)", async () => {
    jest.useFakeTimers({
      doNotFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "setImmediate",
        "clearImmediate",
        "nextTick",
        "queueMicrotask",
        "performance",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
    try {
      jest.setSystemTime(new Date(2026, 10, 21, 23, 59));
      const week: RemoteMuscleVolume = {
        days: 7,
        from: "x",
        to: "y",
        timezone: "Europe/London",
        bodyType: "male",
        muscles: [remoteChestRow],
        trainNext: ["chest"],
        rest: [],
        totals: { ...remoteTotals, workouts: 3 },
        topLifts: [],
        asOf: "x",
      };
      const lastSevenDays = jest
        .fn()
        .mockResolvedValueOnce({ status: "ok" as const, data: week })
        .mockResolvedValue({ status: "unavailable" as const });
      const remote = {
        historyMonth: jest.fn(),
        recap: jest.fn(),
        lastSevenDays,
      };
      const { adapters } = makeAdapters();
      const r = render(
        <AdapterProvider adapters={adapters}>
          <YouContainer remote={remote} />
        </AdapterProvider>,
      );
      await waitFor(() =>
        expect(mockProbe.last?.lastSevenDays.workouts).toBe("3"),
      );
      // Past midnight, offline: the new day's week has nothing kept.
      jest.setSystemTime(new Date(2026, 10, 22, 0, 1));
      r.rerender(
        <AdapterProvider adapters={adapters}>
          <YouContainer remote={remote} />
        </AdapterProvider>,
      );
      await waitFor(() => expect(lastSevenDays).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(mockProbe.last?.lastSevenDays.workouts).toBe("0"),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("falls back to the email initial until the profile resolves", async () => {
    const { adapters } = makeAdapters();
    renderYou(adapters);
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    expect(mockProbe.last?.initials).toBe("A");
  });

  it("regression: returning to You (focus) reflects a weigh-in logged from another tab", async () => {
    const { api, adapters } = makeAdapters();
    const initial = [
      { date: "2026-06-20T00:00:00.000Z", weightKg: 80.0, bodyFat: null },
    ];
    api.bodyTrend = initial;
    adapters.storage.cacheBodyTrend("user-1", initial);
    adapters.health = healthAdapter({
      isAvailable: jest.fn(async () => false),
    });
    renderYou(adapters);
    await waitFor(() => expect(mockProbe.last?.weight.series).toEqual([80.0]));
    act(() => {
      adapters.storage.cacheBodyTrend("user-1", [
        ...initial,
        { date: "2026-06-29T00:00:00.000Z", weightKg: 78.5, bodyFat: null },
      ]);
    });
    expect(mockProbe.last?.weight.series).toEqual([80.0]);
    act(() => {
      mockFocus.cb?.();
    });
    await waitFor(() =>
      expect(mockProbe.last?.weight.series).toEqual([80.0, 78.5]),
    );
    expect(mockProbe.last?.weight.value).toBe("78.5");
  });

  it("re-reads the training log on focus", async () => {
    const { adapters } = makeAdapters();
    renderYou(adapters);
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    adapters.storage.saveTrainingLogEntry(
      "user-1",
      finished("s1", new Date(Date.now() - 3_600_000).toISOString(), {
        bench: [[100, 5]],
      }),
    );
    act(() => {
      mockFocus.cb?.();
    });
    await waitFor(() =>
      expect(mockProbe.last?.lastSevenDays.workouts).toBe("1"),
    );
  });

  it("surfaces Health weight, body fat and steps when the app has none", async () => {
    const { adapters } = makeAdapters();
    adapters.health = healthAdapter({
      getStepsToday: jest.fn(async () => ok(8240)),
      getStepsLastNDays: jest.fn(async () =>
        ok([
          { date: "d1", steps: 6000 },
          { date: "d2", steps: 0 },
          { date: "d3", steps: 8000 },
        ]),
      ),
      getLatestBodyWeight: jest.fn(async () =>
        ok({ value: 180, unit: "lbs", date: "2026-06-29T12:00:00.000Z" }),
      ),
      getLatestBodyFat: jest.fn(async () =>
        ok({ value: 22.5, date: "2026-06-29T12:00:00.000Z" }),
      ),
    });
    renderYou(adapters);
    await waitFor(() => expect(mockProbe.last?.bodyFat.value).toBe("22.5"));
    await waitFor(() => expect(mockProbe.last?.steps.today).toBe("8,240"));
    const p = mockProbe.last!;
    expect(p.weight.value).toBe("81.6");
    expect(p.steps.detail).toBe("Avg 7,000 · last 7 days");
    expect(p.steps.days).toEqual([null, null, null, null, 6000, null, 8000]);
  });

  it("does NOT let a stale Health fat reading override newer in-app history", async () => {
    const { api, adapters } = makeAdapters();
    const trend = [
      { date: "2026-06-25T00:00:00.000Z", weightKg: null, bodyFat: 20 },
      { date: "2026-06-28T00:00:00.000Z", weightKg: null, bodyFat: 19.5 },
    ];
    api.bodyTrend = trend;
    adapters.storage.cacheBodyTrend("user-1", trend);
    adapters.health = healthAdapter({
      getLatestBodyFat: jest.fn(async () =>
        ok({ value: 25, date: "2026-06-01T12:00:00.000Z" }),
      ),
    });
    renderYou(adapters);
    await waitFor(() =>
      expect(mockProbe.last?.bodyFat.series).toEqual([20, 19.5]),
    );
    expect(mockProbe.last?.bodyFat.value).toBe("19.5");
  });
});

describe("bodyTile", () => {
  const now = new Date(2026, 9, 29, 12);
  it("shows the latest reading, when, and the change over the window", () => {
    const t = bodyTile(
      [
        { date: new Date(2026, 9, 1).toISOString(), value: 81 },
        { date: new Date(2026, 9, 24).toISOString(), value: 82 },
        { date: new Date(2026, 9, 29, 7).toISOString(), value: 82.4 },
      ],
      { unit: "kg", now, windowDays: 7, period: "this week" },
    );
    expect(t).toEqual({
      value: "82.4",
      unit: "kg",
      detail: "Today · +0.4 this week",
      series: [81, 82, 82.4],
    });
  });

  it("drops the change with one reading in the window, and handles none", () => {
    expect(
      bodyTile([{ date: new Date(2026, 9, 22).toISOString(), value: 14.8 }], {
        unit: "%",
        now,
        windowDays: 30,
        period: "this month",
      }).detail,
    ).toBe("22 Oct");
    expect(
      bodyTile([], { unit: "%", now, windowDays: 30, period: "this month" }),
    ).toEqual({ value: null, unit: "%", detail: null, series: [] });
  });

  it("labels today's date-only weigh-in Today (Inspector Brad #541)", () => {
    const t = bodyTile(
      [
        { date: "2026-10-27", value: 82 },
        { date: "2026-10-29", value: 82.4 },
      ],
      { unit: "kg", now, windowDays: 7, period: "this week" },
    );
    expect(t.detail).toBe("Today · +0.4 this week");
  });

  it("converts to the athlete's unit", () => {
    const t = bodyTile(
      [
        { date: new Date(2026, 9, 28).toISOString(), value: 80 },
        { date: new Date(2026, 9, 29).toISOString(), value: 79 },
      ],
      {
        unit: "lb",
        now,
        windowDays: 7,
        period: "this week",
        convert: (kg) => kg * 2,
      },
    );
    expect(t.value).toBe("158.0");
    expect(t.detail).toBe("Today · −2.0 this week");
  });
});

describe("coachSubtitle", () => {
  it.each([
    [
      "personal_trainer",
      "2026-03-04T00:00:00Z",
      "Personal Trainer · since Mar 2026",
    ],
    ["physiotherapist", null, "Physiotherapist"],
    ["admin", "not a date", "Coach"],
    [null, null, "Trainer"],
  ])("%p, %p → %p", (role, since, out) => {
    expect(coachSubtitle(role, since)).toBe(out);
  });
});
