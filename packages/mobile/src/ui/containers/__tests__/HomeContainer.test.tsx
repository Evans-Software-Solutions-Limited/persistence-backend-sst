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
    useFuelSheets.setState({ sheet: null, slot: "breakfast", rev: 0 });
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
    const { adapters, api } = makeAdapters();
    api.shouldFail = true; // empty cache + failing GET
    render(
      <Wrapper adapters={adapters}>
        <HomeContainer />
      </Wrapper>,
    );
    // The loader must NOT stick: once the failed fetch settles, isLoading drops
    // to false so the error/retry state is reachable (regression: useCachedResource
    // never resets isStale on error, so gating on stale+empty trapped the loader).
    await waitFor(() => expect(mockProbe.last?.error).not.toBeNull());
    expect(mockProbe.last?.isLoading).toBe(false);
    expect(mockProbe.last?.home).toBeNull();
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

  it("toggling a habit writes the optimistic completion to cache", async () => {
    const { adapters, storage } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <HomeContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    await act(async () => {
      mockProbe.last?.onToggleHabitDay("g1", "2026-06-10", true);
    });
    await waitFor(() =>
      expect(
        storage.getCachedHabitCompletions(USER, { goalId: "g1" }),
      ).toHaveLength(1),
    );
  });

  it("regression: toggling a habit flips the grid tile without a re-mount", async () => {
    // Seed an ENABLED habit config so the `g-water` row is present in the grid
    // regardless of completions (config-driven path — the real product shape).
    // The tile boolean for a given day is what the toggle must flip. Anchor on
    // today's LOCAL day: that's what `useGetHabits.read` reads back (its
    // `since` = this week's Monday) and what `buildHabitGrid` indexes `days[i]`
    // against.
    const today = localDayISO();
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
    // The config-driven row is present; today's tile starts FALSE (no
    // completion logged yet).
    const weekDates = await waitFor(() => {
      const row = mockProbe.last?.habits.find((h) => h.id === "g-water");
      if (!row) throw new Error("g-water row not in grid yet");
      return mockProbe.last!.weekDates;
    });
    const dayIndex = weekDates.indexOf(today);
    expect(dayIndex).toBeGreaterThanOrEqual(0);
    expect(
      mockProbe.last?.habits.find((h) => h.id === "g-water")?.days[dayIndex],
    ).toBe(false);

    // Toggle ON: the command writes the optimistic completion to the cache
    // synchronously (value threaded from the config target), then the container
    // calls reloadHabits() — a mounted re-render (NO unmount/re-render of the
    // tree here) must flip today's tile to TRUE. Pre-fix (no reload wiring) the
    // grid stayed frozen at false until a navigate-away/back re-mount.
    await act(async () => {
      mockProbe.last?.onToggleHabitDay("g-water", today, true, 2);
    });
    await waitFor(() =>
      expect(
        mockProbe.last?.habits.find((h) => h.id === "g-water")?.days[dayIndex],
      ).toBe(true),
    );

    // Inverse: toggling done=false removes the completion synchronously and
    // reloadHabits() re-renders the mounted grid back to false.
    await act(async () => {
      mockProbe.last?.onToggleHabitDay("g-water", today, false);
    });
    await waitFor(() =>
      expect(
        mockProbe.last?.habits.find((h) => h.id === "g-water")?.days[dayIndex],
      ).toBe(false),
    );
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
  });

  it("regression fix: toggling a configured habit with a value writes it to the optimistic cache row", async () => {
    const { adapters, storage } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <HomeContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    await act(async () => {
      // The grid's onToggle signature carries the habit's live targetValue as
      // a 4th arg (threaded from buildHabitGrid) — the backend 422s a
      // value_gte completion with none once the habit is configured.
      mockProbe.last?.onToggleHabitDay("g-water", "2026-06-10", true, 2);
    });
    await waitFor(() => {
      const rows = storage.getCachedHabitCompletions(USER, {
        goalId: "g-water",
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe(2);
    });
  });

  it("regression fix: Calories deep-link (non-toggleable grid row) navigates to Fuel Targets", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <HomeContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    act(() => mockProbe.last?.onOpenCaloriesFromGrid());
    expect(mockPush).toHaveBeenCalledWith("/(app)/fuel/targets");
  });
});
