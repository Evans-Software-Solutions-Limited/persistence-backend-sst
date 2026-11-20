import { act, render, waitFor } from "@testing-library/react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { HabitConfig } from "@/domain/models/habit-config";
import type { FuelToday } from "@/domain/models/nutrition";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { HistoryPresenterProps } from "@/ui/presenters/HistoryPresenter";
import { historyDay, dayKey } from "@/domain/services/youPage";
import {
  musclesOf,
  record,
  session as finished,
} from "@/domain/services/__tests__/youFixtures";
import type { YouRemoteSource } from "@/application/queries/youRemote";
import {
  HistoryContainer,
  dayExtras,
  extrasLogged,
  historyDayView,
  type DayExtras,
} from "../HistoryContainer";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));
const mockFocus: { cb: (() => void) | null } = { cb: null };
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useFocusEffect: (cb: () => void) => {
    const React = jest.requireActual("react") as typeof import("react");
    mockFocus.cb = cb;
    React.useEffect(() => cb(), [cb]);
  },
}));
const mockProbe: { last: HistoryPresenterProps | null } = { last: null };
jest.mock("@/ui/presenters/HistoryPresenter", () => ({
  HistoryPresenter: (props: HistoryPresenterProps) => {
    mockProbe.last = props;
    return null;
  },
}));
(globalThis as Record<string, unknown>).fetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: {} }),
}));

const fuel = (kcal: number, cups = 0, target: number | null = 2500) =>
  ({
    date: "x",
    targets: target == null ? null : { dailyKcal: target },
    consumed: { kcal, proteinG: 0, carbsG: 0, fatG: 0, waterCups: cups },
    remainingKcal: 0,
    entriesBySlot: {},
  }) as unknown as FuelToday;

const habit = (
  category: HabitConfig["category"],
  goalId: string,
  targetValue = 8,
) => ({ category, goalId, enabled: true, targetValue }) as HabitConfig;

const noExtras: DayExtras = {
  fuel: null,
  steps: null,
  weightKg: null,
  habits: new Set(),
  sleepHours: null,
};

describe("dayExtras", () => {
  it("collects steps, weight and habit ticks for the day", () => {
    const key = "2026-10-26";
    const e = dayExtras(key, {
      fuel: fuel(2000, 6),
      steps: [
        { date: new Date(2026, 9, 26).toISOString(), steps: 9120 },
        { date: new Date(2026, 9, 25).toISOString(), steps: 100 },
      ],
      body: [
        {
          date: new Date(2026, 9, 26, 7).toISOString(),
          weightKg: 82.4,
          bodyFat: null,
        },
        {
          date: new Date(2026, 9, 26, 9).toISOString(),
          weightKg: null,
          bodyFat: 15,
        },
      ],
      habitConfigs: [
        habit("water", "g-water"),
        habit("sleep", "g-sleep", 7),
        { ...habit("steps", "x"), goalId: null },
      ],
      completions: [
        {
          id: "1",
          userId: "u",
          goalId: "g-water",
          completedAt: "2026-10-26T12:00:00Z",
          value: 8,
        },
        {
          id: "2",
          userId: "u",
          goalId: "g-sleep",
          completedAt: "2026-10-26T12:00:00Z",
          localCompletedDate: key,
          value: null,
        },
        {
          id: "3",
          userId: "u",
          goalId: "g-water",
          completedAt: "2026-10-20T12:00:00Z",
          value: 8,
        },
        {
          id: "4",
          userId: "u",
          goalId: "unknown",
          completedAt: "2026-10-26T12:00:00Z",
          value: 1,
        },
      ],
    });
    expect(e.steps).toBe(9120);
    expect(e.weightKg).toBe(82.4);
    expect([...e.habits].sort()).toEqual(["sleep", "water"]);
    expect(e.sleepHours).toBe(7);
    expect(extrasLogged(e)).toBe(true);
  });

  it("finds a date-only weigh-in on its own day (Inspector Brad #541)", () => {
    const e = dayExtras("2026-06-10", {
      fuel: null,
      steps: [],
      body: [
        { date: "2026-06-09", weightKg: 81, bodyFat: null },
        { date: "2026-06-10", weightKg: 82.4, bodyFat: null },
      ],
      habitConfigs: [],
      completions: [],
    });
    expect(e.weightKg).toBe(82.4);
  });

  it("treats zero steps and nothing cached as nothing logged", () => {
    const e = dayExtras("2026-10-26", {
      fuel: null,
      steps: [{ date: new Date(2026, 9, 26).toISOString(), steps: 0 }],
      body: [],
      habitConfigs: [],
      completions: [],
    });
    expect(e).toEqual(noExtras);
    expect(extrasLogged(e)).toBe(false);
    expect(extrasLogged({ ...noExtras, fuel: fuel(0, 2) })).toBe(true);
    expect(extrasLogged({ ...noExtras, fuel: fuel(0, 0) })).toBe(false);
  });
});

describe("historyDayView", () => {
  const morning = finished(
    "w1",
    new Date(2026, 9, 26, 7, 10).toISOString(),
    {
      bench: [
        [95, 5],
        [95, 5],
      ],
    },
    { name: "Upper A" },
  );
  const evening = finished(
    "w2",
    new Date(2026, 9, 26, 18, 30).toISOString(),
    {
      plank: [[null, 60]],
    },
    { name: "Core finisher" },
  );

  it("training day with two workouts and a record", () => {
    const v = historyDayView(
      historyDay(
        "2026-10-26",
        [morning, evening],
        [record("bench", "x", { sessionId: "w1" })],
        musclesOf,
      ),
      {
        ...noExtras,
        fuel: fuel(2341, 8),
        steps: 9120,
        habits: new Set(["water"]),
      },
      { gender: "male", unit: "kg" },
    );
    expect(v.title).toBe("Mon 26 October");
    expect(v.status).toBe("Training day");
    expect(v.musclesText).toBe("Chest, shoulders, arms, core");
    expect(v.summary).toBe("2 workouts · 120 min · 1.0 t");
    expect(v.workoutsTitle).toBe("2 workouts");
    expect(v.workouts[0]).toMatchObject({
      id: "w1",
      time: "07:10",
      name: "Upper A",
      detail: "60 min · 1.0 t · 2 sets · ★ 1 record",
    });
    expect(v.workouts[1]!.detail).toBe("60 min · 0.0 t · 1 set");
    expect(v.values).toEqual([
      { label: "Calories", value: "2,341 / 2,500" },
      { label: "Steps", value: "9,120" },
      { label: "Weight", value: "—" },
      { label: "Water", value: "8 cups ✓", good: true },
      { label: "Sleep", value: "—", good: false },
    ]);
    expect(v.shading.accessibilityLabel).toContain("Muscles worked: chest");
  });

  it("rest day: something logged but no workout", () => {
    const v = historyDayView(
      historyDay("2026-10-25", [morning], [], musclesOf),
      {
        ...noExtras,
        fuel: fuel(1800, 1, null),
        weightKg: 82.4,
        sleepHours: 7.5,
        habits: new Set(["sleep"]),
      },
      { gender: "female", unit: "lb" },
    );
    expect(v.status).toBe("Rest day");
    expect(v.trained).toBe(false);
    expect(v.musclesText).toBe("Nothing trained");
    expect(v.summary).toBe("Rest day");
    expect(v.workoutsTitle).toBe("Workout");
    expect(v.shading).toEqual({
      regions: [],
      accessibilityLabel: "No muscles worked",
    });
    expect(v.values.map((x) => x.value)).toEqual([
      "1,800",
      "—",
      "181.7 lb",
      "1 cup",
      "7.5h ✓",
    ]);
  });

  it("a day with nothing logged, and a single workout", () => {
    expect(
      historyDayView(historyDay("2026-10-24", [], [], musclesOf), noExtras, {
        gender: "male",
        unit: "kg",
      }).status,
    ).toBe("Nothing logged");
    const one = historyDayView(
      historyDay("2026-10-26", [morning], [], musclesOf),
      { ...noExtras, habits: new Set(["water"]) },
      { gender: "male", unit: "kg" },
    );
    expect(one.workoutsTitle).toBe("Workout");
    expect(one.summary).toBe("1 workout · 60 min · 1.0 t");
    expect(one.values.find((x) => x.label === "Water")!.value).toBe("✓");
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
    storage,
    adapters: {
      api,
      auth,
      storage,
      health: {
        isAvailable: jest.fn(async () => false),
        getPermissionStatus: jest.fn(async () => ({})),
      } as unknown as Adapters["health"],
      notifications: {} as Adapters["notifications"],
      netInfo: {} as Adapters["netInfo"],
    } as Adapters,
  };
}

describe("HistoryContainer", () => {
  beforeEach(() => {
    mockProbe.last = null;
    mockPush.mockClear();
    mockBack.mockClear();
  });

  it("opens on today, marks logged days, and opens a workout's summary", async () => {
    const { storage, adapters } = makeAdapters();
    const now = new Date();
    const earlier = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      1,
    );
    storage.saveTrainingLogEntry(
      "user-1",
      finished("w1", earlier.toISOString(), { bench: [[100, 5]] }),
    );
    const remote: YouRemoteSource = {
      historyMonth: jest.fn(async () => ({ status: "unavailable" as const })),
      recap: jest.fn(),
      lastSevenDays: jest.fn(),
    };
    render(
      <AdapterProvider adapters={adapters}>
        <HistoryContainer remote={remote} />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    const p = mockProbe.last!;
    const todayKey = dayKey(now);
    expect(p.selectedKey).toBe(todayKey);
    expect(p.canGoNext).toBe(false);
    expect(p.cells.find((c) => c.key === todayKey)!.logged).toBe(true);
    expect(p.day.status).toBe("Training day");
    expect(p.day.workouts.map((w) => w.id)).toEqual(["w1"]);
    act(() => p.onOpenWorkout("w1"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/(app)/history-workout",
      params: { id: "w1", at: earlier.toISOString() },
    });
    act(() => p.onBack());
    expect(mockBack).toHaveBeenCalled();
    // The log started on this phone today, so this month asks the BE-H1
    // seam, which can't help yet: the page says what the phone covers.
    await waitFor(() =>
      expect(mockProbe.last!.coverageNote).toMatch(
        /^This phone keeps your history from /,
      ),
    );
    expect(remote.historyMonth).toHaveBeenCalled();
  });

  it("goes back a month and forward again; a selected rest day reads as one", async () => {
    const { storage, adapters } = makeAdapters();
    render(
      <AdapterProvider adapters={adapters}>
        <HistoryContainer />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    const title = mockProbe.last!.monthTitle;
    act(() => mockProbe.last!.onPrevMonth());
    await waitFor(() => expect(mockProbe.last!.monthTitle).not.toBe(title));
    expect(mockProbe.last!.canGoNext).toBe(true);
    act(() => mockProbe.last!.onNextMonth());
    await waitFor(() => expect(mockProbe.last!.monthTitle).toBe(title));

    const yesterday = dayKey(new Date(Date.now() - 86_400_000));
    storage.cacheFuelToday("user-1", yesterday, fuel(1800));
    act(() => mockFocus.cb?.());
    act(() => mockProbe.last!.onSelectDay(yesterday));
    await waitFor(() => expect(mockProbe.last!.day.status).toBe("Rest day"));
  });

  it("fills a month from BE-H1 once the seam returns data", async () => {
    const { adapters } = makeAdapters();
    const key = dayKey(new Date(Date.now() - 86_400_000));
    const remote: YouRemoteSource = {
      historyMonth: jest.fn(async () => ({
        status: "ok" as const,
        data: [key],
      })),
      recap: jest.fn(),
      lastSevenDays: jest.fn(),
    };
    render(
      <AdapterProvider adapters={adapters}>
        <HistoryContainer remote={remote} />
      </AdapterProvider>,
    );
    await waitFor(() =>
      expect(mockProbe.last?.cells.find((c) => c.key === key)?.logged).toBe(
        true,
      ),
    );
    expect(mockProbe.last!.coverageNote).toBeNull();
  });
});
