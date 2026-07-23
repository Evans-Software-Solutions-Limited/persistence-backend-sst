import { render, act, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import type { Streak } from "@/domain/models/streak";
import type { HabitConfigEntry } from "@/domain/ports/api.port";
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

// The sync drain calls `fetch` directly. We spy on it so we can assert which
// habit endpoints were hit (and, for test #1, that NONE were until Save).
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
  clientName?: string,
) {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  seed?.(api, storage);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AdapterProvider adapters={makeAdapters(api, storage)}>
      {children}
    </AdapterProvider>
  );
  const result = render(
    <HabitSetupContainer clientId={clientId} clientName={clientName} />,
    { wrapper },
  );
  return { api, storage, ...result };
}

function props(): HabitSetupPresenterProps {
  if (!captured.props) throw new Error("presenter not rendered");
  return captured.props;
}

/** How many habit-config network calls the drain has fired so far. */
function habitFetchCount(): number {
  return mockFetch.mock.calls.filter(([url]) =>
    String(url).includes("/habits/"),
  ).length;
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

/** An enabled water config entry (wire shape) used across several tests. */
function waterEnabled(
  overrides: Partial<HabitConfigEntry> = {},
): HabitConfigEntry {
  return {
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
    ...overrides,
  };
}

beforeEach(() => {
  captured.props = null;
  mockPush.mockClear();
  mockBack.mockClear();
  mockFetch.mockClear();
  mockFetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ data: {} }),
  }));
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

  it("surfaces deferredChangesPending when a loaded config has a pending change", async () => {
    renderContainer(undefined, (api) => {
      api.habitConfigs = [
        waterEnabled({
          pending: { from: "2026-07-13", config: { enabled: false } },
        }),
      ];
    });
    await waitFor(() => expect(props().deferredChangesPending).toBe(true));
  });

  it("no deferredChangesPending when nothing is pending", async () => {
    renderContainer(undefined, (api) => {
      api.habitConfigs = [waterEnabled()];
    });
    await waitFor(() => expect(captured.props).not.toBeNull());
    expect(props().deferredChangesPending).toBe(false);
  });

  it("no server streak: falls back to the offline deriveCollectionStreak mirror", async () => {
    renderContainer(undefined, (api, storage) => {
      // No streak row; one enabled water habit hit 5/7 this + prior weeks.
      api.habitConfigs = [waterEnabled({ daysPerWeek: 1 })];
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
    expect(typeof props().streak).toBe("number");
    expect(props().freezeTokens).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test #1 — THE core regression (can't-toggle-off). Toggling OFF flips the
  // presenter's config IMMEDIATELY (the switch reads the draft, so off shows
  // off) and fires ZERO network writes until Save.
  // -------------------------------------------------------------------------
  it("toggling a habit OFF updates the presenter instantly and fires NO mutate until Save", async () => {
    renderContainer(undefined, (api) => {
      api.habitConfigs = [waterEnabled()];
    });
    await waitFor(() => expect(props().configs.water.enabled).toBe(true));
    const before = habitFetchCount();

    act(() => props().onToggle("water", false));

    // Draft reflects OFF immediately (this is what the live-`enabled`-driven
    // switch could NOT do pre-fix — it snapped back on).
    await waitFor(() => expect(props().configs.water.enabled).toBe(false));
    // And nothing has been written to the server yet.
    expect(habitFetchCount()).toBe(before);
  });

  it("enabling a disabled habit flips the draft on instantly, no mutate yet", async () => {
    // Water starts disabled (no server row).
    renderContainer();
    await waitFor(() => expect(props().configs.water.enabled).toBe(false));
    const before = habitFetchCount();

    act(() => props().onToggle("water", true));

    await waitFor(() => expect(props().configs.water.enabled).toBe(true));
    expect(habitFetchCount()).toBe(before);
  });

  it("canSave: false initially, true after an edit, false again after Save", async () => {
    renderContainer();
    await waitFor(() => expect(captured.props).not.toBeNull());
    expect(props().canSave).toBe(false);

    act(() => props().onToggle("water", true));
    await waitFor(() => expect(props().canSave).toBe(true));

    await act(async () => props().onSave());
    await waitFor(() => expect(props().canSave).toBe(false));
    expect(props().saving).toBe(false);
  });

  it("onSave commits: enable → configure PUT, disable → DELETE, then reloads", async () => {
    // gym starts disabled; water starts enabled → we enable gym + disable water.
    renderContainer(undefined, (api) => {
      api.habitConfigs = [waterEnabled()];
    });
    await waitFor(() => expect(props().configs.water.enabled).toBe(true));

    act(() => props().onToggle("gym", true));
    act(() => props().onToggle("water", false));
    await waitFor(() => expect(props().canSave).toBe(true));

    // Nothing written before Save.
    expect(habitFetchCount()).toBe(0);

    await act(async () => props().onSave());

    const put = mockFetch.mock.calls.find(
      ([url, opts]) =>
        String(url).endsWith("/users/me/habits/gym/config") &&
        (opts as { method?: string })?.method === "PUT",
    );
    const del = mockFetch.mock.calls.find(
      ([url, opts]) =>
        String(url).endsWith("/users/me/habits/water") &&
        (opts as { method?: string })?.method === "DELETE",
    );
    expect(put).toBeDefined();
    expect(del).toBeDefined();
    // After save, dirty is cleared (reload re-seeded the draft from baseline).
    await waitFor(() => expect(props().canSave).toBe(false));
  });

  it("enable-then-disable the SAME habit before Save writes nothing for it", async () => {
    // gym starts disabled. Enable then disable → draft == baseline → no write.
    renderContainer();
    await waitFor(() => expect(props().configs.gym.enabled).toBe(false));

    act(() => props().onToggle("gym", true));
    await waitFor(() => expect(props().configs.gym.enabled).toBe(true));
    act(() => props().onToggle("gym", false));
    await waitFor(() => expect(props().configs.gym.enabled).toBe(false));

    // Draft is back to baseline → nothing to save.
    expect(props().canSave).toBe(false);

    // Even if Save is invoked, it's a no-op (guarded by canSave/dirty).
    await act(async () => props().onSave());
    expect(habitFetchCount()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test #6 — pending-aware seed (the re-open snap-back fix). A config loaded
  // with a queued disable (`pending.enabled = false`) over a live `enabled:
  // true` must render OFF on first paint — proving a SAVED disable stays off
  // when the screen is re-opened.
  // -------------------------------------------------------------------------
  it("pending-aware seed: a queued disable renders the habit OFF on load", async () => {
    renderContainer(undefined, (api) => {
      api.habitConfigs = [
        waterEnabled({
          enabled: true, // live row still enabled (backend defers the disable)
          pending: { from: "2026-07-13", config: { enabled: false } },
        }),
      ];
    });
    // The baseline applies the pending intent over the live value → OFF.
    await waitFor(() => expect(props().configs.water.enabled).toBe(false));
    // Not dirty — this is the SAVED state, not an in-progress edit.
    expect(props().canSave).toBe(false);
  });

  it("target edit updates the draft target instantly, no mutate until Save", async () => {
    renderContainer(undefined, (api) => {
      api.habitConfigs = [waterEnabled()];
    });
    await waitFor(() => expect(props().configs.water.enabled).toBe(true));
    const before = habitFetchCount();

    act(() => props().onTargetChange("water", 3));
    await waitFor(() => expect(props().configs.water.targetValue).toBe(3));
    expect(habitFetchCount()).toBe(before);

    await act(async () => props().onSave());
    const put = mockFetch.mock.calls.find(([url]) =>
      String(url).endsWith("/users/me/habits/water/config"),
    );
    expect(put).toBeDefined();
  });

  it("freq + leniency edits update the draft instantly, commit on Save", async () => {
    renderContainer(undefined, (api) => {
      api.habitConfigs = [
        waterEnabled(),
        {
          category: "calories",
          enabled: true,
          goalId: "g-cals",
          assignedByCoach: false,
          locked: false,
          targetValue: 2000,
          unit: "kcal",
          period: "daily",
          completionRule: "within_tolerance",
          daysPerWeek: 6,
          tolerancePct: 10,
          pending: null,
        },
      ];
    });
    await waitFor(() => expect(props().configs.calories.enabled).toBe(true));
    const before = habitFetchCount();

    act(() => props().onFreqChange("water", 6));
    act(() => props().onLeniencyChange("calories", 15));
    await waitFor(() => expect(props().configs.water.daysPerWeek).toBe(6));
    expect(props().configs.calories.tolerancePct).toBe(15);
    // Local only until Save.
    expect(habitFetchCount()).toBe(before);

    await act(async () => props().onSave());
    const waterPut = mockFetch.mock.calls.find(([url]) =>
      String(url).endsWith("/users/me/habits/water/config"),
    );
    const calPut = mockFetch.mock.calls.find(([url]) =>
      String(url).endsWith("/users/me/habits/calories/config"),
    );
    expect(waterPut).toBeDefined();
    expect(calPut).toBeDefined();
  });

  it("back button pops the stack (discards the unsaved draft)", async () => {
    renderContainer();
    await waitFor(() => expect(captured.props).not.toBeNull());
    // An edit that we then abandon by going Back.
    act(() => props().onToggle("water", true));
    act(() => props().onBack());
    expect(mockBack).toHaveBeenCalled();
    // Nothing was written.
    expect(habitFetchCount()).toBe(0);
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

  it("failed freeze spend reverts the skipped flag", async () => {
    const { api } = renderContainer(undefined, (a, storage) => {
      a.streaks = [collectionStreak];
      storage.cacheStreaks(USER, [collectionStreak]);
    });
    await waitFor(() => expect(props().freezeTokens).toBe(3));
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
          waterEnabled({
            assignedByCoach: true,
            assignedByUserId: USER,
            locked: true,
          }),
        ],
      };
    });
    // The client GET is async → wait for the enabled config to seed the draft.
    await waitFor(() => expect(props().configs.water.enabled).toBe(true));
    expect(props().coachSubtitle).toBeTruthy();
    expect(props().isCoach).toBe(true);
    // Coach view never surfaces at-risk (no local streak mirror for a client).
    expect(props().atRisk).toBe(false);
  });

  it("titles the header with the client's name when supplied", async () => {
    renderContainer(
      "client-9",
      (api) => {
        api.clientHabitConfigs = { "client-9": [waterEnabled()] };
      },
      "Alex",
    );
    await waitFor(() => expect(props().isCoach).toBe(true));
    expect(props().title).toBe("Alex's habits");
  });

  it("falls back to a generic client title when no name is supplied", async () => {
    renderContainer("client-9", (api) => {
      api.clientHabitConfigs = { "client-9": [waterEnabled()] };
    });
    await waitFor(() => expect(props().isCoach).toBe(true));
    expect(props().title).toBe("Client's habits");
  });

  it("coach edit updates the draft, then Save routes to the trainer endpoint + refreshes", async () => {
    const { api } = renderContainer("client-9", (a) => {
      a.clientHabitConfigs = { "client-9": [] };
    });
    const spy = jest.spyOn(api, "getClientHabitConfigs");
    // Model the server: the drained PUT flips water enabled in the store the
    // refresh re-reads (so the reconcile can only see it AFTER the PUT).
    mockFetch.mockImplementation(async (url: unknown, opts?: unknown) => {
      const u = String(url);
      const method = (opts as { method?: string } | undefined)?.method;
      if (
        method === "PUT" &&
        u.endsWith("/trainers/me/clients/client-9/habits/water/config")
      ) {
        api.clientHabitConfigs["client-9"] = [
          waterEnabled({
            assignedByCoach: true,
            assignedByUserId: USER,
            locked: true,
          }),
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

    // Edit the draft — instant, no write.
    act(() => props().onToggle("water", true));
    await waitFor(() => expect(props().configs.water.enabled).toBe(true));
    expect(habitFetchCount()).toBe(0);

    const before = spy.mock.calls.length;
    await act(async () => props().onSave());

    // The trainer PUT fired, scoped to this client.
    const put = mockFetch.mock.calls.find(([url]) =>
      String(url).endsWith("/trainers/me/clients/client-9/habits/water/config"),
    );
    expect(put).toBeDefined();
    // A refresh re-fetched the client config AFTER the PUT persisted.
    expect(spy.mock.calls.length).toBeGreaterThan(before);
    expect(spy.mock.calls.every(([id]) => id === "client-9")).toBe(true);
    // Save cleared dirty via the reconcile.
    await waitFor(() => expect(props().canSave).toBe(false));
    spy.mockRestore();
  });

  it("coach disable Save routes the DELETE to the trainer endpoint, scoped to the client", async () => {
    renderContainer("client-9", (api) => {
      api.clientHabitConfigs = {
        "client-9": [
          waterEnabled({
            assignedByCoach: true,
            assignedByUserId: USER,
            locked: false,
          }),
        ],
      };
    });
    await waitFor(() => expect(props().configs.water.enabled).toBe(true));

    act(() => props().onToggle("water", false));
    await waitFor(() => expect(props().configs.water.enabled).toBe(false));

    await act(async () => props().onSave());
    const del = mockFetch.mock.calls.find(
      ([url, opts]) =>
        String(url).endsWith("/trainers/me/clients/client-9/habits/water") &&
        (opts as { method?: string })?.method === "DELETE",
    );
    expect(del).toBeDefined();
  });

  it("coach Calories deep-link is a no-op (no client-side editor)", async () => {
    renderContainer("client-9");
    await waitFor(() => expect(captured.props).not.toBeNull());
    act(() => props().onAdjustNutrition());
    expect(mockPush).not.toHaveBeenCalledWith("/(app)/fuel/targets");
  });

  // ---------------------------------------------------------------------
  // QA-6 — a coach Save that persists but gives no feedback reads as
  // "tapping Save does nothing". Assert the underlying write fires AND the
  // transient "Saved" confirmation flag surfaces afterwards.
  // ---------------------------------------------------------------------
  it("QA-6: after a successful coach save, justSaved flips true and the configure call fired", async () => {
    renderContainer("client-9", (api) => {
      api.clientHabitConfigs = { "client-9": [] };
    });
    await waitFor(() => expect(captured.props).not.toBeNull());
    expect(props().justSaved).toBe(false);

    act(() => props().onToggle("water", true));
    await waitFor(() => expect(props().configs.water.enabled).toBe(true));

    await act(async () => props().onSave());

    const put = mockFetch.mock.calls.find(
      ([url, opts]) =>
        String(url).endsWith(
          "/trainers/me/clients/client-9/habits/water/config",
        ) && (opts as { method?: string })?.method === "PUT",
    );
    expect(put).toBeDefined();
    await waitFor(() => expect(props().justSaved).toBe(true));
  });
});
