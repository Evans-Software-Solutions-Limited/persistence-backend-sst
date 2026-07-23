import { act, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { HealthPort } from "@/domain/ports/health.port";
import { ok } from "@/shared/errors";
import { localDayISO } from "@/shared/utils";
import type { Adapters } from "@/shared/types";
import type { HomePresenterProps } from "@/ui/presenters/HomePresenter";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useFuelSheets } from "@/state/fuel-sheets";
import { HomeContainer } from "../HomeContainer";

// jest hoists jest.mock factories above imports — captured refs must be
// `mock*`-prefixed to satisfy the hoist guard.
const mockPush = jest.fn();
// Probe presenter: captures the latest props the container passes down + the
// render count. Returns null (we assert on props, not output).
const mockProbe: { last: HomePresenterProps | null } = { last: null };

jest.mock("expo-router", () => {
  const React = jest.requireActual("react") as typeof import("react");
  return {
    useRouter: () => ({ push: mockPush }),
    useNavigation: () => ({ addListener: () => () => {} }),
    // Run the focus callback once on mount so HomeContainer's focus-refresh
    // path (HealthKit re-read) is exercised under test.
    useFocusEffect: (cb: () => void | (() => void)) =>
      React.useEffect(cb, [cb]),
  };
});
jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));
jest.mock("@/ui/presenters/HomePresenter", () => ({
  HomePresenter: (props: HomePresenterProps) => {
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

const USER = "user-1";

// HealthPort stub. Defaults to unavailable (most home tests don't exercise
// HealthKit); pass overrides to drive the MOVE-ring overlay. Every read
// method is stubbed so an available adapter completes its mount read cleanly.
function makeHealthStub(over: Partial<HealthPort> = {}): HealthPort {
  return {
    isAvailable: async () => false,
    getPermissionStatus: async () => ({
      steps: "not_determined",
      calories: "not_determined",
      bodyWeight: "not_determined",
      heartRate: "not_determined",
    }),
    getStepsToday: async () => ok(0),
    getStepsLastNDays: async () => ok([]),
    getActiveCaloriesToday: async () => ok(0),
    getBasalCaloriesToday: async () => ok(0),
    getStandTimeTodayMinutes: async () => ok(0),
    getLatestBodyWeight: async () => ok(null),
    getLatestBodyFat: async () => ok(null),
    ...over,
  } as unknown as HealthPort;
}

function makeAdapters(healthOverride: Partial<HealthPort> = {}): {
  adapters: Adapters;
  api: InMemoryApiAdapter;
  storage: InMemoryStorageAdapter;
} {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: USER,
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
      health: makeHealthStub(healthOverride),
      notifications: {
        // useUnreadNotificationCount registers a foreground push listener; it
        // must return an unsubscribe fn or the effect cleanup throws.
        addNotificationReceivedListener: jest.fn(() => () => {}),
        setBadgeCount: jest.fn(async () => {}),
      } as unknown as Adapters["notifications"],
      payments: {} as Adapters["payments"],
      netInfo: {} as Adapters["netInfo"],
    },
  };
}

function Wrapper({
  adapters,
  children,
}: {
  adapters: Adapters;
  children: ReactNode;
}) {
  return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
}

describe("HomeContainer (V2)", () => {
  beforeEach(() => {
    mockProbe.last = null;
    mockPush.mockClear();
    useFuelSheets.setState({
      sheet: null,
      slot: "breakfast",
      date: localDayISO(),
      rev: 0,
    });
  });

  it("renders the presenter and populates the home payload from the API", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <HomeContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.home).not.toBeNull());
    expect(mockProbe.last?.user.initials).toBe("A"); // from alex@example.com
    expect(mockProbe.last?.weekDates).toHaveLength(7);
    expect(mockProbe.last?.showCoachPeek).toBe(false); // default athlete mode
  });

  it("overlays HealthKit steps onto the MOVE ring", async () => {
    // Granted + a live reading → the backend's 0-step MOVE ring is replaced by
    // the device value, and pct is recomputed against the 10000 target.
    const { adapters } = makeAdapters({
      isAvailable: async () => true,
      getPermissionStatus: async () => ({
        steps: "granted",
        calories: "granted",
        bodyWeight: "granted",
        heartRate: "granted",
        sleep: "granted",
      }),
      getStepsToday: async () => ok(8421),
    });
    render(
      <Wrapper adapters={adapters}>
        <HomeContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(mockProbe.last?.home?.rings.move.current).toBe(8421),
    );
    expect(mockProbe.last?.home?.rings.move.pct).toBeCloseTo(0.8421, 4);
  });

  it("clears the workouts loading state once the fetch resolves (no stuck skeleton)", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <HomeContainer />
      </Wrapper>,
    );
    // After the workouts fetch settles (here: an empty list), the carousel must
    // drop out of the loading posture so it shows the empty state rather than
    // spinning the skeleton forever (regression: isStale stays true on a failed
    // fetch, so loading must gate on isRefreshing/error, not stale+empty).
    await waitFor(() => expect(mockProbe.last?.workoutsLoading).toBe(false));
  });

  it("escapes the loader and surfaces the error when a cold-start fetch fails", async () => {
    jest.useFakeTimers();
    const { adapters, api } = makeAdapters();
    api.shouldFail = true; // empty cache + failing GET
    render(
      <Wrapper adapters={adapters}>
        <HomeContainer />
      </Wrapper>,
    );
    // A cold-start fetch fails transiently (server) and retries with backoff;
    // once the retry budget is exhausted the loader must NOT stick — isLoading
    // drops to false so the error/retry state is reachable (regression:
    // useCachedResource never resets isStale on error, so gating on stale+empty
    // trapped the loader).
    await act(async () => {
      await jest.advanceTimersByTimeAsync(6000);
    });
    expect(mockProbe.last?.error).not.toBeNull();
    expect(mockProbe.last?.isLoading).toBe(false);
    expect(mockProbe.last?.home).toBeNull();
    jest.useRealTimers();
  });

  it("keeps onRefresh referentially stable across re-renders", async () => {
    // Regression (PR #37): the useCallback deps were the whole hook-result
    // objects, which are fresh literals each render, so the handler was rebuilt
    // every render. Depending on the stable .refresh callbacks fixes it.
    const { adapters } = makeAdapters();
    const { rerender } = render(
      <Wrapper adapters={adapters}>
        <HomeContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    const first = mockProbe.last?.onRefresh;
    rerender(
      <Wrapper adapters={adapters}>
        <HomeContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.onRefresh).toBe(first);
  });

  it("routes to the You tab via onOpenTab", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <HomeContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    act(() => mockProbe.last?.onOpenTab("you"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/(tabs)/you");
  });

  it("opens the notifications list via the header bell", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <HomeContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    act(() => mockProbe.last?.onOpenNotifications());
    expect(mockPush).toHaveBeenCalledWith("/(app)/notifications");
  });

  it("read-only grid: exposes habits and passes NO toggle handler", async () => {
    // The Home grid reflects logged activity — it is not a toggle surface.
    // The container must build the grid rows (config-driven) but expose no
    // per-cell toggle callback to the presenter.
    const { adapters, api } = makeAdapters();
    api.habitConfigs = [
      {
        category: "water",
        enabled: true,
        goalId: "g-water",
        assignedByCoach: false,
        locked: false,
        targetValue: 2,
        unit: "l",
        period: "daily",
        completionRule: "value_gte",
        daysPerWeek: 5,
        tolerancePct: null,
        pending: null,
      },
    ];
    render(
      <Wrapper adapters={adapters}>
        <HomeContainer />
      </Wrapper>,
    );
    await waitFor(() => {
      const row = mockProbe.last?.habits.find((h) => h.id === "g-water");
      if (!row) throw new Error("g-water row not in grid yet");
    });
    // No toggle affordance is wired through to the presenter (read-only).
    expect(
      (mockProbe.last as unknown as { onToggleHabitDay?: unknown })
        .onToggleHabitDay,
    ).toBeUndefined();
    expect(
      (mockProbe.last as unknown as { onOpenCaloriesFromGrid?: unknown })
        .onOpenCaloriesFromGrid,
    ).toBeUndefined();
  });

  it("reflects a logged habit into the grid without a manual toggle", async () => {
    // A HealthKit steps read ≥ target reflects into the Steps habit completion
    // (useReflectStepsHabit) and the container reloads habits so the tile ticks
    // with no pull-to-refresh. Seed the config in BOTH api (grid row) and
    // storage (the reflect reads the local config), and return the completion
    // from the API so the assertion is deterministic regardless of the
    // reflect-vs-fetch write ordering.
    const today = localDayISO();
    const { adapters, api, storage } = makeAdapters({
      isAvailable: async () => true,
      getStepsToday: async () => ok(9000),
    });
    const stepsConfig = {
      category: "steps" as const,
      enabled: true,
      goalId: "g-steps",
      assignedByCoach: false,
      assignedByName: null,
      locked: false,
      targetValue: 8000,
      unit: "steps",
      period: "daily" as const,
      completionRule: "value_gte" as const,
      daysPerWeek: 7,
      tolerancePct: null,
      pending: null,
    };
    api.habitConfigs = [stepsConfig];
    storage.cacheHabitConfigs(USER, [stepsConfig]);
    api.habitCompletions = [
      {
        id: "c-steps-today",
        userId: USER,
        goalId: "g-steps",
        completedAt: `${today}T12:00:00.000Z`,
        localCompletedDate: today,
        value: 8000,
      },
    ];
    render(
      <Wrapper adapters={adapters}>
        <HomeContainer />
      </Wrapper>,
    );
    const dayIndex = await waitFor(() => {
      const i = mockProbe.last?.weekDates.indexOf(today) ?? -1;
      if (i < 0) throw new Error("today not in weekDates yet");
      return i;
    });
    // The Steps tile shows ticked for today with no toggle interaction.
    await waitFor(() =>
      expect(
        mockProbe.last?.habits.find((h) => h.id === "g-steps")?.days[dayIndex],
      ).toBe(true),
    );
  });

  it("opening the 'Your programme' card routes to the athlete programme view", async () => {
    const { adapters, api } = makeAdapters();
    api.nextActiveProgramme = {
      assignmentId: "pa-1",
      programId: "p-1",
      name: "Strength Foundations",
      week: 2,
      totalWeeks: 8,
      endDate: null,
      startDate: "2026-06-01",
      assignedByName: "Coach Jane",
    };
    render(
      <Wrapper adapters={adapters}>
        <HomeContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(mockProbe.last?.activeProgramme?.programId).toBe("p-1"),
    );
    act(() => mockProbe.last?.onOpenProgramme?.());
    expect(mockPush).toHaveBeenCalledWith("/(app)/programs/view/p-1");
  });

  it("quick-log Meal jumps to Fuel and opens the add-food sheet", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <HomeContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    act(() => mockProbe.last?.onOpenMealLog());
    expect(mockPush).toHaveBeenCalledWith("/(app)/(tabs)/fuel");
    expect(useFuelSheets.getState().sheet).toBe("quickAdd");
    expect(useFuelSheets.getState().date).toBe(localDayISO());
  });

  it("quick-log Meal forces the shared sheet store back to today even if a prior Fuel-tab session left it on a past day (QA-20)", async () => {
    const { adapters } = makeAdapters();
    act(() => useFuelSheets.getState().setDate("2020-01-01"));
    render(
      <Wrapper adapters={adapters}>
        <HomeContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    act(() => mockProbe.last?.onOpenMealLog());
    expect(useFuelSheets.getState().date).toBe(localDayISO());
  });
});
