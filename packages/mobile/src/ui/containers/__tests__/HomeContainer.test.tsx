/* eslint-disable @typescript-eslint/no-require-imports */

// Jest hoists jest.mock factories — prefix captured refs with `mock*`.

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

const mockHomePresenterProps: { current: any } = { current: null };
// Records the props passed on each render. Used by the identity-
// stability test (bugbot regression) to assert onRefresh +
// onConnectHealthPress don't get recreated on every render.
const mockHomePresenterRenders: any[] = [];
jest.mock("@/ui/presenters/HomePresenter", () => {
  const React = require("react");
  const { Pressable } = require("react-native");
  return {
    HomePresenter: (props: any) => {
      mockHomePresenterProps.current = props;
      mockHomePresenterRenders.push(props);
      return React.createElement(
        require("react-native").View,
        { testID: "home-presenter-stub" },
        [
          React.createElement(Pressable, {
            key: "refresh",
            testID: "stub-refresh",
            onPress: props.onRefresh,
          }),
          React.createElement(Pressable, {
            key: "workout",
            testID: "stub-workout",
            onPress: () => props.onWorkoutPress("w1"),
          }),
          React.createElement(Pressable, {
            key: "view-all-workouts",
            testID: "stub-view-all-workouts",
            onPress: props.onViewAllWorkoutsPress,
          }),
          React.createElement(Pressable, {
            key: "view-all-progress",
            testID: "stub-view-all-progress",
            onPress: props.onViewAllProgressPress,
          }),
          React.createElement(Pressable, {
            key: "connect",
            testID: "stub-connect",
            onPress: props.onConnectHealthPress,
          }),
          React.createElement(Pressable, {
            key: "upgrade",
            testID: "stub-upgrade",
            onPress: props.onUpgradePress,
          }),
          React.createElement(Pressable, {
            key: "activity",
            testID: "stub-activity",
            onPress: () => props.onActivityPress("s1"),
          }),
          React.createElement(Pressable, {
            key: "workout-start",
            testID: "stub-workout-start",
            onPress: () => props.onWorkoutStart("w1"),
          }),
          React.createElement(Pressable, {
            key: "manage-subscription",
            testID: "stub-manage-subscription",
            onPress: props.onManageSubscriptionPress,
          }),
        ],
      );
    },
  };
});

// eslint-disable-next-line import/first
import { act, fireEvent, waitFor } from "@testing-library/react-native";
// eslint-disable-next-line import/first
import type { ReactNode } from "react";
// eslint-disable-next-line import/first
import { Alert } from "react-native";
// eslint-disable-next-line import/first
import { DASHBOARD_FIXTURE } from "@/adapters/api/__tests__/fixtures/dashboard.fixture";
// eslint-disable-next-line import/first
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
// eslint-disable-next-line import/first
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
// eslint-disable-next-line import/first
import type { AuthSession } from "@/domain/ports/auth.port";
// eslint-disable-next-line import/first
import type { HealthPort } from "@/domain/ports/health.port";
// eslint-disable-next-line import/first
import { ok } from "@/shared/errors";
// eslint-disable-next-line import/first
import type { Adapters } from "@/shared/types";
// eslint-disable-next-line import/first
import { AdapterProvider } from "@/ui/hooks/useAdapters";
// eslint-disable-next-line import/first
import { HomeContainer } from "@/ui/containers/HomeContainer";
// eslint-disable-next-line import/first
import { renderWithTheme } from "../../../../__tests__/test-utils";

jest.setTimeout(15_000);

function mockHealth(overrides: Partial<HealthPort> = {}): HealthPort {
  const grantedStatus = {
    steps: "granted",
    calories: "granted",
    bodyWeight: "granted",
    heartRate: "granted",
  } as const;
  const base: HealthPort = {
    isMock: false,
    isAvailable: async () => true,
    requestPermissions: async () => ok(grantedStatus),
    getPermissionStatus: async () => grantedStatus,
    getStepsToday: async () => ok(4812),
    getStepsLastNDays: async () => ok([]),
    getActiveCaloriesToday: async () => ok(312),
    getLatestBodyWeight: async () =>
      ok({ value: 74.5, unit: "kg" as const, date: "2026-04-20T07:00:00Z" }),
    getHeartRateLatest: async () => ok(62),
    writeBodyWeight: async () =>
      ok(undefined) as Awaited<ReturnType<HealthPort["writeBodyWeight"]>>,
    disconnect: async () => {},
  };
  const wrapped: HealthPort = {
    isMock: base.isMock,
    isAvailable: jest.fn(base.isAvailable),
    requestPermissions: jest.fn(base.requestPermissions),
    getPermissionStatus: jest.fn(base.getPermissionStatus),
    getStepsToday: jest.fn(base.getStepsToday),
    getStepsLastNDays: jest.fn(base.getStepsLastNDays),
    getActiveCaloriesToday: jest.fn(base.getActiveCaloriesToday),
    getLatestBodyWeight: jest.fn(base.getLatestBodyWeight),
    getHeartRateLatest: jest.fn(base.getHeartRateLatest),
    writeBodyWeight: jest.fn(base.writeBodyWeight),
    disconnect: jest.fn(base.disconnect),
  };
  return { ...wrapped, ...overrides };
}

function makeAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
  health: HealthPort = mockHealth(),
): Adapters {
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: "user-1",
    email: "u@example.com",
    expiresAt: Date.now() + 60_000,
  };
  return {
    api,
    auth: {
      signInWithEmail: jest.fn(),
      signUpWithEmail: jest.fn(),
      signInWithOAuth: jest.fn(),
      signOut: jest.fn(),
      getSession: jest.fn(async () => ok(session)),
      onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
        setTimeout(() => cb(session), 0);
        return () => {};
      }),
      resetPassword: jest.fn(),
      refreshSession: jest.fn(),
      getAccessToken: jest.fn(async () => "t"),
    } as unknown as Adapters["auth"],
    storage,
    health,
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
  };
}

function Wrap({
  adapters,
  children,
}: {
  adapters: Adapters;
  children: ReactNode;
}) {
  return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
}

describe("HomeContainer", () => {
  beforeEach(() => {
    mockRouterPush.mockClear();
    mockHomePresenterProps.current = null;
    mockHomePresenterRenders.length = 0;
  });

  it("passes the dashboard fixture into the presenter view-model", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.dashboard = DASHBOARD_FIXTURE;
    storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
    const adapters = makeAdapters(api, storage);

    renderWithTheme(
      <Wrap adapters={adapters}>
        <HomeContainer />
      </Wrap>,
    );

    await waitFor(() => {
      expect(mockHomePresenterProps.current?.viewModel.userName).toBe("Alex");
    });
    expect(mockHomePresenterProps.current.viewModel.workouts).toHaveLength(
      DASHBOARD_FIXTURE.recentWorkouts.length,
    );
  });

  it("emits null userName + surfaces the api error when cache is empty and refresh fails", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    // Do not seed api.dashboard — the InMemoryApiAdapter returns a
    // not_found ApiError, which the container should propagate via
    // `error` rather than swallowing behind a polite-greeting fallback.
    const adapters = makeAdapters(api, storage);

    renderWithTheme(
      <Wrap adapters={adapters}>
        <HomeContainer />
      </Wrap>,
    );

    await waitFor(() => {
      expect(mockHomePresenterProps.current?.error).not.toBeNull();
    });
    // No "Lifter" fallback any more — null signals the presenter to
    // pivot to the dedicated error state instead of greeting a fake
    // user. See PR #37 review thread.
    expect(mockHomePresenterProps.current.viewModel.userName).toBeNull();
    expect(mockHomePresenterProps.current.error?.kind).toBe("api");
    expect(mockHomePresenterProps.current.viewModel.goals).toEqual([]);
    expect(mockHomePresenterProps.current.viewModel.workouts).toEqual([]);
    expect(mockHomePresenterProps.current.viewModel.isFreeTier).toBe(true);
  });

  it("passes isLoading=true to the presenter during cold-start refresh", async () => {
    // Regression + feature test: when the cache is empty and the auto-
    // refresh is in flight, HomePresenter must receive `isLoading=true`
    // so it renders the full-screen PLogoDrawLoader (matches the legacy
    // app's first-open behaviour).
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.dashboard = DASHBOARD_FIXTURE;

    // Stall the dashboard fetch so the loading branch is observable
    // without a release.
    let release: (() => void) | null = null;
    jest.spyOn(api, "getDashboard").mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return ok(DASHBOARD_FIXTURE);
    });

    const adapters = makeAdapters(api, storage);

    renderWithTheme(
      <Wrap adapters={adapters}>
        <HomeContainer />
      </Wrap>,
    );

    await waitFor(() => {
      expect(mockHomePresenterProps.current?.isLoading).toBe(true);
    });

    // Release the stall and confirm isLoading flips back to false.
    await act(async () => {
      release?.();
    });
    await waitFor(() => {
      expect(mockHomePresenterProps.current?.isLoading).toBe(false);
    });
  });

  it("triggers both dashboard + health refresh on pull-to-refresh", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.dashboard = DASHBOARD_FIXTURE;
    storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
    const health = mockHealth();
    const adapters = makeAdapters(api, storage, health);

    const { getByTestId } = renderWithTheme(
      <Wrap adapters={adapters}>
        <HomeContainer />
      </Wrap>,
    );

    await waitFor(() => {
      expect(mockHomePresenterProps.current).not.toBeNull();
    });

    const initialStepsCount = (health.getStepsToday as jest.Mock).mock.calls
      .length;
    await act(async () => {
      fireEvent.press(getByTestId("stub-refresh"));
    });
    // Refresh-on-stub bypasses rate limit, so steps is called again
    await waitFor(() => {
      expect(
        (health.getStepsToday as jest.Mock).mock.calls.length,
      ).toBeGreaterThan(initialStepsCount);
    });
  });

  it("routes to /workouts on workout tap", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.dashboard = DASHBOARD_FIXTURE;
    storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
    const adapters = makeAdapters(api, storage);

    const { getByTestId } = renderWithTheme(
      <Wrap adapters={adapters}>
        <HomeContainer />
      </Wrap>,
    );
    await waitFor(() => {
      expect(mockHomePresenterProps.current).not.toBeNull();
    });
    fireEvent.press(getByTestId("stub-workout"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/(tabs)/workouts");
  });

  it("routes the view-all and connect-health taps correctly", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.dashboard = DASHBOARD_FIXTURE;
    storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
    const health = mockHealth();
    const adapters = makeAdapters(api, storage, health);

    const { getByTestId } = renderWithTheme(
      <Wrap adapters={adapters}>
        <HomeContainer />
      </Wrap>,
    );
    await waitFor(() => {
      expect(mockHomePresenterProps.current).not.toBeNull();
    });

    fireEvent.press(getByTestId("stub-view-all-workouts"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/(tabs)/workouts");

    fireEvent.press(getByTestId("stub-view-all-progress"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/(tabs)/progress");

    fireEvent.press(getByTestId("stub-activity"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/(tabs)/workouts");

    await act(async () => {
      fireEvent.press(getByTestId("stub-connect"));
    });
    expect(health.requestPermissions).toHaveBeenCalled();
  });

  it("routes to /workouts on workout-start tap", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.dashboard = DASHBOARD_FIXTURE;
    storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
    const adapters = makeAdapters(api, storage);

    const { getByTestId } = renderWithTheme(
      <Wrap adapters={adapters}>
        <HomeContainer />
      </Wrap>,
    );
    await waitFor(() => {
      expect(mockHomePresenterProps.current).not.toBeNull();
    });
    fireEvent.press(getByTestId("stub-workout-start"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/(tabs)/workouts");
  });

  it("surfaces an Alert when the manage-subscription CTA fires", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.dashboard = DASHBOARD_FIXTURE;
    storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
    const adapters = makeAdapters(api, storage);

    const { getByTestId } = renderWithTheme(
      <Wrap adapters={adapters}>
        <HomeContainer />
      </Wrap>,
    );
    await waitFor(() => {
      expect(mockHomePresenterProps.current).not.toBeNull();
    });

    fireEvent.press(getByTestId("stub-manage-subscription"));
    expect(alertSpy).toHaveBeenCalledWith(
      "Manage subscription",
      expect.any(String),
    );
    alertSpy.mockRestore();
  });

  it("maps health.stepsHistory ISO dates into Date objects on the view-model", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.dashboard = DASHBOARD_FIXTURE;
    storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
    const stepsHistory = [
      { date: "2026-04-19T00:00:00.000Z", steps: 4500 },
      { date: "2026-04-20T00:00:00.000Z", steps: 5200 },
    ];
    const health = mockHealth({
      getStepsLastNDays: jest.fn(async () => ok(stepsHistory)),
    });
    const adapters = makeAdapters(api, storage, health);

    renderWithTheme(
      <Wrap adapters={adapters}>
        <HomeContainer />
      </Wrap>,
    );
    await waitFor(() => {
      expect(
        mockHomePresenterProps.current?.viewModel?.stepsHistory?.length,
      ).toBe(2);
    });
    const mapped = mockHomePresenterProps.current.viewModel.stepsHistory;
    expect(mapped[0].date).toBeInstanceOf(Date);
    expect(mapped[0].steps).toBe(4500);
    expect(mapped[1].steps).toBe(5200);
  });

  it("surfaces an Alert when the upgrade CTA fires", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.dashboard = DASHBOARD_FIXTURE;
    storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
    const adapters = makeAdapters(api, storage);

    const { getByTestId } = renderWithTheme(
      <Wrap adapters={adapters}>
        <HomeContainer />
      </Wrap>,
    );
    await waitFor(() => {
      expect(mockHomePresenterProps.current).not.toBeNull();
    });

    fireEvent.press(getByTestId("stub-upgrade"));
    expect(alertSpy).toHaveBeenCalledWith(
      "Upgrade coming soon",
      expect.any(String),
    );
    alertSpy.mockRestore();
  });

  it("provides 5 per-section animation styles", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.dashboard = DASHBOARD_FIXTURE;
    storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
    const adapters = makeAdapters(api, storage);

    renderWithTheme(
      <Wrap adapters={adapters}>
        <HomeContainer />
      </Wrap>,
    );
    await waitFor(() => {
      expect(mockHomePresenterProps.current).not.toBeNull();
    });
    expect(mockHomePresenterProps.current.animationStyles).toHaveLength(5);
  });

  describe("error + profile-incomplete surfacing (PR #37 follow-up)", () => {
    it("forwards a refresh error from useDashboard onto the presenter prop", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      // No fixture seeded — InMemoryApiAdapter returns a not_found
      // ApiError, so the auto-refresh fires and rejects.
      const adapters = makeAdapters(api, storage);

      renderWithTheme(
        <Wrap adapters={adapters}>
          <HomeContainer />
        </Wrap>,
      );

      await waitFor(() => {
        expect(mockHomePresenterProps.current?.error).not.toBeNull();
      });
      expect(mockHomePresenterProps.current.error.kind).toBe("api");
      expect(mockHomePresenterProps.current.error.code).toBe("not_found");
    });

    it("synthesises an error when the payload comes back with a null firstName", async () => {
      // Brad-flagged scenario: API returns 200 but profile.firstName is
      // null. Pre-fix we silently rendered "Lifter"; post-fix the
      // container surfaces an api/server error so the presenter shows
      // the blocking error state.
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const incompletePayload = {
        ...DASHBOARD_FIXTURE,
        profile: { ...DASHBOARD_FIXTURE.profile, firstName: null },
      };
      api.dashboard = incompletePayload;
      storage.cacheDashboard("user-1", incompletePayload);
      const adapters = makeAdapters(api, storage);

      renderWithTheme(
        <Wrap adapters={adapters}>
          <HomeContainer />
        </Wrap>,
      );

      // Wait for the auth bootstrap to land + the cache read to lift
      // the incomplete payload into state. Gating only on
      // `userName === null` is not enough — the very first render
      // (pre-bootstrap, userId === null) ALSO has userName === null
      // and a null `error`, so a naive waitFor resolves before the
      // synthesised error has had a chance to materialise. Local
      // runs happened to settle on a later render; CI on Linux
      // settled on the earlier one. Gate explicitly on the error
      // we're about to assert. See PR #38 review.
      await waitFor(() => {
        expect(mockHomePresenterProps.current?.error).not.toBeNull();
      });
      expect(mockHomePresenterProps.current.viewModel.userName).toBeNull();
      expect(mockHomePresenterProps.current.error?.kind).toBe("api");
      expect(mockHomePresenterProps.current.error?.code).toBe("server");
      expect(mockHomePresenterProps.current.error?.message).toMatch(/profile/i);
    });

    it("clears the synthesised error once the payload returns with a firstName", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.dashboard = DASHBOARD_FIXTURE;
      storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
      const adapters = makeAdapters(api, storage);

      renderWithTheme(
        <Wrap adapters={adapters}>
          <HomeContainer />
        </Wrap>,
      );

      await waitFor(() => {
        expect(mockHomePresenterProps.current?.viewModel?.userName).toBe(
          "Alex",
        );
      });
      expect(mockHomePresenterProps.current.error).toBeNull();
    });
  });

  describe("loader caption timer (5s)", () => {
    it("flips showSlowLoaderCaption true after 5 seconds of loading", async () => {
      jest.useFakeTimers();
      try {
        const api = new InMemoryApiAdapter();
        const storage = new InMemoryStorageAdapter();
        api.dashboard = DASHBOARD_FIXTURE;
        // Stall the fetch so isLoading stays true long enough for the
        // caption timer to fire under our control.
        let release: (() => void) | null = null;
        jest.spyOn(api, "getDashboard").mockImplementation(async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return ok(DASHBOARD_FIXTURE);
        });

        const adapters = makeAdapters(api, storage);

        renderWithTheme(
          <Wrap adapters={adapters}>
            <HomeContainer />
          </Wrap>,
        );

        await waitFor(() => {
          expect(mockHomePresenterProps.current?.isLoading).toBe(true);
        });
        expect(mockHomePresenterProps.current.showSlowLoaderCaption).toBe(
          false,
        );

        await act(async () => {
          jest.advanceTimersByTime(5_000);
        });

        await waitFor(() => {
          expect(mockHomePresenterProps.current.showSlowLoaderCaption).toBe(
            true,
          );
        });

        // Cleanup: drain microtasks before swapping back to real timers
        // so any pending `release()` doesn't leak into other tests.
        await act(async () => {
          release?.();
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it("resets showSlowLoaderCaption back to false when isLoading flips off", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.dashboard = DASHBOARD_FIXTURE;
      // Pre-seed the cache so isLoading is false from mount.
      storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
      const adapters = makeAdapters(api, storage);

      renderWithTheme(
        <Wrap adapters={adapters}>
          <HomeContainer />
        </Wrap>,
      );

      await waitFor(() => {
        expect(mockHomePresenterProps.current?.isLoading).toBe(false);
      });
      expect(mockHomePresenterProps.current.showSlowLoaderCaption).toBe(false);
    });
  });

  describe("isMock threading", () => {
    it("forwards healthIsMock=true onto the view-model when the adapter is a mock", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.dashboard = DASHBOARD_FIXTURE;
      storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
      const health = mockHealth({ isMock: true });
      const adapters = makeAdapters(api, storage, health);

      renderWithTheme(
        <Wrap adapters={adapters}>
          <HomeContainer />
        </Wrap>,
      );

      await waitFor(() => {
        expect(mockHomePresenterProps.current).not.toBeNull();
      });
      expect(mockHomePresenterProps.current.viewModel.healthIsMock).toBe(true);
    });

    it("forwards healthIsMock=false for real adapters", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.dashboard = DASHBOARD_FIXTURE;
      storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
      const adapters = makeAdapters(api, storage); // default mockHealth has isMock:false

      renderWithTheme(
        <Wrap adapters={adapters}>
          <HomeContainer />
        </Wrap>,
      );

      await waitFor(() => {
        expect(mockHomePresenterProps.current).not.toBeNull();
      });
      expect(mockHomePresenterProps.current.viewModel.healthIsMock).toBe(false);
    });
  });

  it("keeps onRefresh + onConnectHealthPress identity stable across re-renders", async () => {
    // Regression for bugbot finding on PR #37: the original code
    // declared `useCallback(..., [dashboard, health])`, but both
    // useDashboard() and useHealthData() return fresh plain objects
    // each render — so the deps were "new" every render and
    // useCallback re-created both handlers every render, defeating
    // the memoization entirely. The fix depends on the stable
    // useCallback-wrapped refresh / requestPermissions methods.
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.dashboard = DASHBOARD_FIXTURE;
    storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
    const adapters = makeAdapters(api, storage);

    const { getByTestId } = renderWithTheme(
      <Wrap adapters={adapters}>
        <HomeContainer />
      </Wrap>,
    );

    // Wait for the auth bootstrap + cache read to settle — during
    // that window `userId` legitimately flips from null to "user-1",
    // which recomputes dashboard.refresh and is not a memo defeat.
    //
    // HomePresenter receives `viewModel`, not `payload`. When the
    // fixture-backed cache read lands, viewModel.userName transitions
    // from null (the pre-bootstrap fallback) to "Alex" (the fixture
    // value). The earlier revision of this wait gated on
    // `?.payload !== undefined`, which the optional chain coerced to
    // `undefined`, making `expect(undefined).not.toBeNull()` pass on
    // the very first render — completely defeating the wait. See
    // bugbot thread on PR #37.
    await waitFor(() => {
      expect(mockHomePresenterProps.current?.viewModel?.userName).toBe("Alex");
    });

    // Snapshot the post-settle render count, then capture identities
    // only from renders AFTER this point. That way any change in the
    // captured handler reference is caused by a re-render alone, not
    // by a genuine dependency change.
    const cutoff = mockHomePresenterRenders.length;

    // Force at least two more re-renders by firing a pull-to-refresh
    // twice. Pre-fix, each of these renders pushes a distinct
    // onRefresh identity (the old deps `[dashboard, health]` were
    // fresh objects every render).
    await act(async () => {
      fireEvent.press(getByTestId("stub-refresh"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("stub-refresh"));
    });

    const postSettleRenders = mockHomePresenterRenders.slice(cutoff);
    expect(postSettleRenders.length).toBeGreaterThanOrEqual(2);

    const distinctRefreshes = new Set(
      postSettleRenders.map((p) => p.onRefresh),
    );
    const distinctConnects = new Set(
      postSettleRenders.map((p) => p.onConnectHealthPress),
    );

    // Both handlers must be memo-stable across post-settle renders.
    // Pre-fix, these Sets would have size === postSettleRenders.length.
    expect(distinctRefreshes.size).toBe(1);
    expect(distinctConnects.size).toBe(1);
  });
});
