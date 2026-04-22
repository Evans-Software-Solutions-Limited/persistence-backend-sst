/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

// Jest hoists jest.mock factories — prefix captured refs with `mock*`.

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

const mockHomePresenterProps: { current: any } = { current: null };
jest.mock("@/ui/presenters/HomePresenter", () => {
  const React = require("react");
  const { Pressable } = require("react-native");
  return {
    HomePresenter: (props: any) => {
      mockHomePresenterProps.current = props;
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
    isAvailable: async () => true,
    requestPermissions: async () => ok(grantedStatus),
    getPermissionStatus: async () => grantedStatus,
    getStepsToday: async () => ok(4812),
    getActiveCaloriesToday: async () => ok(312),
    getLatestBodyWeight: async () =>
      ok({ value: 74.5, unit: "kg" as const, date: "2026-04-20T07:00:00Z" }),
    getHeartRateLatest: async () => ok(62),
    writeBodyWeight: async () =>
      ok(undefined) as Awaited<ReturnType<HealthPort["writeBodyWeight"]>>,
    disconnect: async () => {},
  };
  const wrapped: HealthPort = {
    isAvailable: jest.fn(base.isAvailable),
    requestPermissions: jest.fn(base.requestPermissions),
    getPermissionStatus: jest.fn(base.getPermissionStatus),
    getStepsToday: jest.fn(base.getStepsToday),
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
      expect(mockHomePresenterProps.current?.viewModel.firstName).toBe("Alex");
    });
    expect(mockHomePresenterProps.current.viewModel.workouts).toHaveLength(
      DASHBOARD_FIXTURE.recentWorkouts.length,
    );
  });

  it("falls back to safe defaults when cache is empty", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    // Do not seed api.dashboard — so the auto-refresh will fail silently
    // and the cache stays empty.
    const adapters = makeAdapters(api, storage);

    renderWithTheme(
      <Wrap adapters={adapters}>
        <HomeContainer />
      </Wrap>,
    );

    await waitFor(() => {
      expect(mockHomePresenterProps.current).not.toBeNull();
    });
    expect(mockHomePresenterProps.current.viewModel.firstName).toBeNull();
    expect(mockHomePresenterProps.current.viewModel.goals).toEqual([]);
    expect(mockHomePresenterProps.current.viewModel.workouts).toEqual([]);
    expect(
      mockHomePresenterProps.current.viewModel.subscription.isFreeTier,
    ).toBe(true);
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
});
