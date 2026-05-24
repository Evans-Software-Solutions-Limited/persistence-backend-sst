/* eslint-disable @typescript-eslint/no-require-imports */

// Mocks must be hoisted ahead of imports — Jest's transformer rearranges
// `jest.mock` calls to the top, so capturing identifiers via `mock*`
// keeps the factories ESM-safe.

const mockProgressPresenterProps: { current: any } = { current: null };
jest.mock("@/ui/presenters/ProgressPresenter", () => {
  const React = require("react");
  const { Pressable, Text } = require("react-native");
  return {
    ProgressPresenter: (props: any) => {
      mockProgressPresenterProps.current = props;
      return React.createElement(
        require("react-native").View,
        { testID: "progress-presenter-stub" },
        [
          React.createElement(
            Text,
            { key: "loading", testID: "stub-is-loading" },
            props.viewModel.isLoading ? "true" : "false",
          ),
          React.createElement(
            Text,
            { key: "workouts", testID: "stub-workouts-this-month" },
            String(props.viewModel.workoutsThisMonth),
          ),
          React.createElement(
            Text,
            { key: "gate", testID: "stub-gate" },
            props.analyticsGate === null
              ? "null"
              : props.analyticsGate.allowed
                ? "allowed"
                : "denied",
          ),
          React.createElement(Pressable, {
            key: "refresh",
            testID: "stub-refresh",
            onPress: props.onRefresh,
          }),
        ],
      );
    },
  };
});

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => ({ push: mockRouterPush }),
    useFocusEffect: (cb: any) => {
      React.useEffect(() => cb(), [cb]);
    },
  };
});

// eslint-disable-next-line import/first
import { act, fireEvent, waitFor } from "@testing-library/react-native";
// eslint-disable-next-line import/first
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// eslint-disable-next-line import/first
import type { ReactNode } from "react";
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
import type { MySubscription } from "@/domain/models/subscription";
// eslint-disable-next-line import/first
import { ok } from "@/shared/errors";
// eslint-disable-next-line import/first
import type { Adapters } from "@/shared/types";
// eslint-disable-next-line import/first
import { AdapterProvider } from "@/ui/hooks/useAdapters";
// eslint-disable-next-line import/first
import { ProgressContainer } from "@/ui/containers/ProgressContainer";
// eslint-disable-next-line import/first
import { renderWithTheme } from "../../../../__tests__/test-utils";

jest.setTimeout(15_000);

function stubHealth(): HealthPort {
  const granted = {
    steps: "granted" as const,
    calories: "granted" as const,
    bodyWeight: "granted" as const,
    heartRate: "granted" as const,
  };
  return {
    isAvailable: async () => true,
    requestPermissions: async () => ok(granted),
    getPermissionStatus: async () => granted,
    getStepsToday: async () => ok(0),
    getStepsLastNDays: async () => ok([]),
    getActiveCaloriesToday: async () => ok(0),
    getBasalCaloriesToday: async () => ok(0),
    getStandTimeTodayMinutes: async () => ok(0),
    getLatestBodyWeight: async () => ok(null),
    getHeartRateLatest: async () => ok(null),
    writeBodyWeight: async () =>
      ok(undefined) as Awaited<ReturnType<HealthPort["writeBodyWeight"]>>,
    disconnect: async () => {},
  };
}

function makeAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
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
        cb(session);
        return () => {};
      }),
      resetPassword: jest.fn(),
      refreshSession: jest.fn(),
      getAccessToken: jest.fn(async () => "t"),
    } as unknown as Adapters["auth"],
    storage,
    health: stubHealth(),
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
    netInfo: {} as Adapters["netInfo"],
  };
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function Wrap({
  adapters,
  children,
}: {
  adapters: Adapters;
  children: ReactNode;
}) {
  return (
    <AdapterProvider adapters={adapters}>
      <QueryClientProvider client={makeQueryClient()}>
        {children}
      </QueryClientProvider>
    </AdapterProvider>
  );
}

function makePremiumSubscription(): MySubscription {
  return {
    subscriptionId: "sub-1",
    tierName: "premium",
    paymentStatus: "active",
    billingCycle: "monthly",
    startsAt: "2026-04-01T00:00:00.000Z",
    expiresAt: "2026-05-01T00:00:00.000Z",
    cancelledAt: null,
    trialEndsAt: null,
    externalSubscriptionId: "stripe-sub-1",
    tierDisplayName: "Premium",
    tierDescription: null,
    workoutLimit: null,
    aiAccess: true,
    aiWorkoutLimit: 6,
    gymBuddyAccess: true,
    trainerClientLimit: null,
    isTrainerTier: false,
    role: "user",
    hasUsedUserTrial: false,
    hasUsedTrainerTrial: false,
    isEligibleForUserTrial: true,
    isEligibleForTrainerTrial: true,
    scheduledChange: null,
  };
}

function makeFreeSubscription(): MySubscription {
  return {
    ...makePremiumSubscription(),
    subscriptionId: null,
    tierName: "free",
    billingCycle: null,
    expiresAt: null,
    externalSubscriptionId: null,
    tierDisplayName: "Free",
    workoutLimit: 3,
    aiAccess: false,
    aiWorkoutLimit: 0,
    gymBuddyAccess: false,
  };
}

describe("ProgressContainer", () => {
  beforeEach(() => {
    mockProgressPresenterProps.current = null;
    mockRouterPush.mockClear();
  });

  it("passes the dashboard workout count through to the presenter", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.dashboard = DASHBOARD_FIXTURE;
    storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
    const adapters = makeAdapters(api, storage);

    renderWithTheme(
      <Wrap adapters={adapters}>
        <ProgressContainer />
      </Wrap>,
    );

    await waitFor(() => {
      expect(mockProgressPresenterProps.current?.viewModel).toBeTruthy();
    });
    expect(mockProgressPresenterProps.current.viewModel.workoutsThisMonth).toBe(
      DASHBOARD_FIXTURE.progress.workoutsThisMonth,
    );
    expect(mockProgressPresenterProps.current.viewModel.workoutsLastMonth).toBe(
      DASHBOARD_FIXTURE.progress.workoutsLastMonth,
    );
  });

  it("emits analyticsGate=null until useMySubscription resolves", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.dashboard = DASHBOARD_FIXTURE;
    storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
    // No subscription seeded — getMySubscription returns not_found.
    const adapters = makeAdapters(api, storage);

    renderWithTheme(
      <Wrap adapters={adapters}>
        <ProgressContainer />
      </Wrap>,
    );

    await waitFor(() => {
      expect(mockProgressPresenterProps.current).not.toBeNull();
    });
    expect(mockProgressPresenterProps.current.analyticsGate).toBeNull();
  });

  it("emits analyticsGate.allowed=false for a free-tier user", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.dashboard = DASHBOARD_FIXTURE;
    storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
    api.mySubscription = makeFreeSubscription();
    const adapters = makeAdapters(api, storage);

    renderWithTheme(
      <Wrap adapters={adapters}>
        <ProgressContainer />
      </Wrap>,
    );

    await waitFor(() => {
      expect(mockProgressPresenterProps.current?.analyticsGate?.allowed).toBe(
        false,
      );
    });
    expect(
      mockProgressPresenterProps.current.analyticsGate.gateProps.currentTier,
    ).toBe("free");
  });

  it("emits analyticsGate.allowed=true for a premium user", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.dashboard = DASHBOARD_FIXTURE;
    storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
    api.mySubscription = makePremiumSubscription();
    const adapters = makeAdapters(api, storage);

    renderWithTheme(
      <Wrap adapters={adapters}>
        <ProgressContainer />
      </Wrap>,
    );

    await waitFor(() => {
      expect(mockProgressPresenterProps.current?.analyticsGate?.allowed).toBe(
        true,
      );
    });
  });

  it("defaults workout counts to 0 when no dashboard payload is available", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    // No dashboard seeded — useDashboard.payload stays null. Container
    // must default to 0 rather than crashing on undefined.
    const adapters = makeAdapters(api, storage);

    renderWithTheme(
      <Wrap adapters={adapters}>
        <ProgressContainer />
      </Wrap>,
    );

    await waitFor(() => {
      expect(mockProgressPresenterProps.current).not.toBeNull();
    });
    expect(mockProgressPresenterProps.current.viewModel.workoutsThisMonth).toBe(
      0,
    );
    expect(mockProgressPresenterProps.current.viewModel.workoutsLastMonth).toBe(
      0,
    );
  });

  it("invokes the dashboard refresh on the presenter's onRefresh tap", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.dashboard = DASHBOARD_FIXTURE;
    storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
    const adapters = makeAdapters(api, storage);

    const getDashboardSpy = jest.spyOn(api, "getDashboard");

    const { getByTestId } = renderWithTheme(
      <Wrap adapters={adapters}>
        <ProgressContainer />
      </Wrap>,
    );

    await waitFor(() => {
      expect(mockProgressPresenterProps.current).not.toBeNull();
    });
    const initialCalls = getDashboardSpy.mock.calls.length;
    await act(async () => {
      fireEvent.press(getByTestId("stub-refresh"));
    });
    await waitFor(() => {
      expect(getDashboardSpy.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  it("surfaces a non-blocking error banner when cache exists + refresh fails", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.dashboard = DASHBOARD_FIXTURE;
    storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
    const adapters = makeAdapters(api, storage);

    const { getByTestId } = renderWithTheme(
      <Wrap adapters={adapters}>
        <ProgressContainer />
      </Wrap>,
    );

    await waitFor(() => {
      expect(mockProgressPresenterProps.current).not.toBeNull();
    });

    // Flip the adapter into failure mode and trigger a manual refresh.
    api.shouldFail = true;
    await act(async () => {
      fireEvent.press(getByTestId("stub-refresh"));
    });

    await waitFor(() => {
      expect(
        mockProgressPresenterProps.current.viewModel.errorMessage,
      ).toBeTruthy();
    });
  });
});
