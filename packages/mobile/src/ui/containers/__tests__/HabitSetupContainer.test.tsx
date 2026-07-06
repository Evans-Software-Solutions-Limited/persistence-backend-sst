import { render, act, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import type { Streak } from "@/domain/models/streak";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { HabitSetupPresenterProps } from "@/ui/presenters/habits/HabitSetupPresenter";

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, canGoBack: () => true }),
}));

const captured: { props: HabitSetupPresenterProps | null } = { props: null };
jest.mock("@/ui/presenters/habits/HabitSetupPresenter", () => ({
  HabitSetupPresenter: (props: HabitSetupPresenterProps) => {
    captured.props = props;
    return null;
  },
}));

// Avoid the real network drain firing on mutations.
const mockFetch = jest.fn(async (..._args: unknown[]) => ({
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

// eslint-disable-next-line import/first
import { HabitSetupContainer } from "@/ui/containers/HabitSetupContainer";

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

function renderContainer(
  clientId?: string,
  seed?: (api: InMemoryApiAdapter, storage: InMemoryStorageAdapter) => void,
) {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  seed?.(api, storage);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AdapterProvider adapters={makeAdapters(api, storage)}>
      {children}
    </AdapterProvider>
  );
  const result = render(<HabitSetupContainer clientId={clientId} />, {
    wrapper,
  });
  return { api, storage, ...result };
}

function props(): HabitSetupPresenterProps {
  if (!captured.props) throw new Error("presenter not rendered");
  return captured.props;
}

const collectionStreak: Streak = {
  id: "streak-1",
  userId: USER,
  streakType: "habit_streak",
  sourceGoalId: null,
  period: "weekly",
  currentCount: 8,
  longestCount: 20,
  lastPeriodEnd: "2026-06-07",
  freezeTokens: 3,
  status: "active",
};

beforeEach(() => {
  captured.props = null;
  mockPush.mockClear();
  mockFetch.mockClear();
});

describe("HabitSetupContainer (self)", () => {
  it("surfaces the server collection streak (current/longest/tokens)", async () => {
    renderContainer(undefined, (api, storage) => {
      api.streaks = [collectionStreak];
      storage.cacheStreaks(USER, [collectionStreak]);
    });
    await waitFor(() => expect(props().streak).toBe(8));
    expect(props().longest).toBe(20);
    expect(props().freezeTokens).toBe(3);
  });

  it("Calories deep-link navigates to Fuel Targets", async () => {
    renderContainer();
    await waitFor(() => expect(captured.props).not.toBeNull());
    act(() => props().onAdjustNutrition());
    expect(mockPush).toHaveBeenCalledWith("/(app)/fuel/targets");
  });

  it("enabling a habit fires the configure PUT through the drain", async () => {
    renderContainer();
    await waitFor(() => expect(captured.props).not.toBeNull());
    await act(async () => props().onToggle("water", true));
    const put = mockFetch.mock.calls.find(([url]) =>
      String(url).endsWith("/users/me/habits/water/config"),
    );
    expect(put).toBeDefined();
  });

  it("spend freeze: calls the skip mode + marks skipped", async () => {
    const { api } = renderContainer(undefined, (a, storage) => {
      a.streaks = [collectionStreak];
      storage.cacheStreaks(USER, [collectionStreak]);
    });
    await waitFor(() => expect(props().freezeTokens).toBe(3));
    await act(async () => props().onSpendFreeze());
    expect(api.useFreezeTokenCalls).toContainEqual({
      streakId: "streak-1",
      mode: "skip",
    });
    await waitFor(() => expect(props().skipped).toBe(true));
  });

  it("no server streak: falls back to the offline deriveCollectionStreak mirror", async () => {
    renderContainer(undefined, (api, storage) => {
      // No streak row; one enabled water habit hit 5/7 this + prior weeks.
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
          daysPerWeek: 1, // easy to satisfy
          tolerancePct: null,
          pending: null,
        },
      ];
      // A completion this week + last week (relative to now) → offline streak ≥ 1.
      const today = new Date();
      const iso = today.toISOString().slice(0, 10);
      storage.cacheHabitCompletions(USER, [
        {
          id: "c1",
          userId: USER,
          goalId: "g-water",
          completedAt: `${iso}T09:00:00.000Z`,
          localCompletedDate: iso,
          value: 3,
        },
      ]);
    });
    await waitFor(() => expect(props().configs.water.enabled).toBe(true));
    // Offline mirror produces a numeric streak (freezeTokens default 0 with no row).
    expect(typeof props().streak).toBe("number");
    expect(props().freezeTokens).toBe(0);
  });

  it("regression: enabling a habit flips its config in the mounted presenter (reflectConfig → reload)", async () => {
    // Water starts DISABLED (no server row). Enabling it writes a live config
    // (enabled:true) to the cache synchronously; reflectConfig() → reload()
    // must re-read that cache into the mounted presenter WITHOUT a re-mount —
    // the same frozen-snapshot bug as the Home habit grid. Pre-fix the switch
    // stayed off until a navigate-away/back re-mount.
    renderContainer();
    await waitFor(() => expect(props().configs.water.enabled).toBe(false));
    await act(async () => props().onToggle("water", true));
    // The presenter now reflects the enabled config — proof of the re-render.
    await waitFor(() => expect(props().configs.water.enabled).toBe(true));
    expect(props().configs.water.goalId).toBeTruthy();
  });

  it("regression: a target edit is reflected in the mounted presenter's pending config", async () => {
    // Start from an already-active habit so a target edit writes a PENDING
    // config (live row untouched until Monday). The mounted presenter must
    // reflect that pending value via reflectConfig → reload, no re-mount.
    renderContainer(undefined, (api) => {
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
    });
    await waitFor(() => expect(props().configs.water.enabled).toBe(true));
    await act(async () => props().onTargetChange("water", 3));
    await waitFor(() =>
      expect(props().configs.water.pending?.targetValue).toBe(3),
    );
  });

  it("disabling a habit fires the DELETE through the drain", async () => {
    renderContainer(undefined, (api) => {
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
    });
    await waitFor(() => expect(props().configs.water.enabled).toBe(true));
    await act(async () => props().onToggle("water", false));
    const del = mockFetch.mock.calls.find(
      ([url, opts]) =>
        String(url).endsWith("/users/me/habits/water") &&
        (opts as { method?: string })?.method === "DELETE",
    );
    expect(del).toBeDefined();
  });

  it("target / freq / leniency edits fire configure PUTs", async () => {
    renderContainer();
    await waitFor(() => expect(captured.props).not.toBeNull());
    await act(async () => props().onTargetChange("water", 3));
    await act(async () => props().onFreqChange("water", 6));
    await act(async () => props().onLeniencyChange("calories", 15));
    const puts = mockFetch.mock.calls.filter(([url]) =>
      String(url).includes("/users/me/habits/"),
    );
    expect(puts.length).toBeGreaterThanOrEqual(3);
  });

  it("back button pops the stack", async () => {
    renderContainer();
    await waitFor(() => expect(captured.props).not.toBeNull());
    act(() => props().onBack());
    expect(mockBack).toHaveBeenCalled();
  });

  it("failed freeze spend reverts the skipped flag", async () => {
    const { api } = renderContainer(undefined, (a, storage) => {
      a.streaks = [collectionStreak];
      storage.cacheStreaks(USER, [collectionStreak]);
    });
    await waitFor(() => expect(props().freezeTokens).toBe(3));
    // Force the freeze spend (api.useFreezeToken) to fail → the container
    // should revert its optimistic `skipped` flag.
    api.shouldFail = true;
    await act(async () => props().onSpendFreeze());
    await waitFor(() => expect(props().skipped).toBe(false));
  });
});

describe("HabitSetupContainer (coach)", () => {
  it("reads the client's config + shows the attribution subtitle", async () => {
    renderContainer("client-9", (api) => {
      api.clientHabitConfigs = {
        "client-9": [
          {
            category: "water",
            enabled: true,
            goalId: "g-water",
            assignedByCoach: true,
            assignedByUserId: USER,
            locked: true,
            targetValue: 2,
            unit: "l",
            period: "daily",
            completionRule: "value_gte",
            daysPerWeek: 5,
            tolerancePct: null,
            pending: null,
          },
        ],
      };
    });
    await waitFor(() => expect(captured.props?.coachSubtitle).toBeTruthy());
    expect(props().configs.water.enabled).toBe(true);
    // Coach view never surfaces at-risk (no local streak mirror for a client).
    expect(props().atRisk).toBe(false);
  });

  it("coach edit routes the PUT to the trainer endpoint", async () => {
    renderContainer("client-9");
    await waitFor(() => expect(captured.props).not.toBeNull());
    await act(async () => props().onToggle("water", true));
    const put = mockFetch.mock.calls.find(([url]) =>
      String(url).endsWith("/trainers/me/clients/client-9/habits/water/config"),
    );
    expect(put).toBeDefined();
  });

  it("regression: coach edit reflects the client config in the mounted presenter (reflectConfig → chained refresh, not raced)", async () => {
    // Coach view has no local cache for a client's config: the on-behalf PUT is
    // sent inside the queue drain, and reflectConfig() re-FETCHES the server row
    // to reflect it. The refresh MUST be chained onto the mutate's drain —
    // firing it synchronously would race the GET ahead of the PUT and read the
    // pre-edit row (the switch would stay frozen).
    //
    // Model the server: the drained PUT flips water to enabled in the store
    // that getClientHabitConfigs reads. So this assertion is ORDERING-SENSITIVE
    // — a raced (unchained) refresh reads the store BEFORE the PUT persists and
    // stays false; only the chained refresh reads it AFTER and shows enabled.
    const { api } = renderContainer("client-9", (a) => {
      a.clientHabitConfigs = { "client-9": [] };
    });
    const spy = jest.spyOn(api, "getClientHabitConfigs");
    mockFetch.mockImplementation(async (url: unknown, opts?: unknown) => {
      const u = String(url);
      const method = (opts as { method?: string } | undefined)?.method;
      if (
        method === "PUT" &&
        u.endsWith("/trainers/me/clients/client-9/habits/water/config")
      ) {
        api.clientHabitConfigs["client-9"] = [
          {
            category: "water",
            enabled: true,
            goalId: "g-water",
            assignedByCoach: true,
            assignedByUserId: USER,
            locked: true,
            targetValue: 2,
            unit: "l",
            period: "daily",
            completionRule: "value_gte",
            daysPerWeek: 5,
            tolerancePct: null,
            pending: null,
          },
        ];
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ data: {} }),
      };
    });
    await waitFor(() => expect(captured.props).not.toBeNull());
    expect(props().configs.water.enabled).toBe(false);
    const before = spy.mock.calls.length;
    await act(async () => props().onToggle("water", true));
    // The chained refresh re-fetched AFTER the PUT persisted, so the mounted
    // presenter now reflects the enabled config — proof of reflection + order.
    await waitFor(() => expect(props().configs.water.enabled).toBe(true));
    expect(spy.mock.calls.length).toBeGreaterThan(before);
    // Every observed fetch targeted this client (never leaks another id).
    expect(spy.mock.calls.every(([id]) => id === "client-9")).toBe(true);
    spy.mockRestore();
  });

  it("coach Calories deep-link is a no-op (no client-side editor)", async () => {
    renderContainer("client-9");
    await waitFor(() => expect(captured.props).not.toBeNull());
    act(() => props().onAdjustNutrition());
    expect(mockPush).not.toHaveBeenCalledWith("/(app)/fuel/targets");
  });
});
