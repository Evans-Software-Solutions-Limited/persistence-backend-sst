import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TamaguiProvider } from "@tamagui/core";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { ReactNode } from "react";
import config from "../../../../tamagui.config";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { MySubscription } from "@/domain/models/subscription";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useAddClientSheet } from "@/state/add-client-sheet";
import { ClientsContainer } from "@/ui/containers/ClientsContainer";
import { makeTrainerClients } from "@/ui/presenters/coach/__tests__/trainerClients.fixture";

const mockFetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: [] }),
}));
(globalThis as Record<string, unknown>).fetch = mockFetch;

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    replace: jest.fn(),
    back: jest.fn(),
  }),
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: jest.fn(),
    back: jest.fn(),
  },
}));
jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

function makeAdapters(sub: MySubscription | null): {
  adapters: Adapters;
  api: InMemoryApiAdapter;
} {
  const api = new InMemoryApiAdapter();
  api.mySubscription = sub;
  const auth = new InMemoryAuthAdapter();
  auth.currentSession = {
    accessToken: "tok",
    refreshToken: "rtok",
    userId: "u-1",
    email: "x@y.com",
    expiresAt: Date.now() + 3_600_000,
  };
  const adapters: Adapters = {
    api,
    auth,
    storage: new InMemoryStorageAdapter(),
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new MockPaymentsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
  };
  return { adapters, api };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function Wrapper({
  adapters,
  queryClient,
  children,
}: {
  adapters: Adapters;
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 44, left: 0, right: 0, bottom: 34 },
      }}
    >
      <TamaguiProvider config={config} defaultTheme="dark">
        <QueryClientProvider client={queryClient}>
          <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
        </QueryClientProvider>
      </TamaguiProvider>
    </SafeAreaProvider>
  );
}

function makeSub(overrides: Partial<MySubscription> = {}): MySubscription {
  return {
    subscriptionId: null,
    tierName: "free",
    paymentStatus: "active",
    billingCycle: null,
    startsAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    cancelledAt: null,
    trialEndsAt: null,
    externalSubscriptionId: null,
    tierDisplayName: "Free",
    tierDescription: null,
    workoutLimit: 0,
    aiAccess: false,
    aiWorkoutLimit: 0,
    gymBuddyAccess: false,
    trainerClientLimit: null,
    isTrainerTier: false,
    role: "user",
    hasUsedUserTrial: false,
    hasUsedTrainerTrial: false,
    isEligibleForUserTrial: true,
    isEligibleForTrainerTrial: true,
    scheduledChange: null,
    ...overrides,
  };
}

function makeTrainerSub(
  overrides: Partial<MySubscription> = {},
): MySubscription {
  return makeSub({
    tierName: "small_business",
    isTrainerTier: true,
    role: "personal_trainer",
    workoutLimit: null,
    // 30-seat tier vs the 5-client roster → under cap by default, so the
    // invite affordance stays enabled for the roster/sheet tests. At-cap
    // behaviour is exercised explicitly below.
    trainerClientLimit: 30,
    ...overrides,
  });
}

beforeEach(() => {
  mockPush.mockReset();
  mockFetch.mockClear();
  useAddClientSheet.setState({ open: false, onInvited: null });
});

describe("ClientsContainer", () => {
  it("renders a loading spinner while the subscription cache is resolving", () => {
    // No subscription set on the adapter AND auth in place means the
    // hook fires the query but it has not yet settled — `isPending` is
    // true on the first synchronous render before the in-memory adapter
    // resolves. We assert the spinner via testID before any waits.
    const { adapters } = makeAdapters(null);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ClientsContainer />
      </Wrapper>,
    );
    expect(screen.getByTestId("clients-loading")).toBeTruthy();
  });

  it("renders the FeatureGatePrompt for a non-trainer (free) user", async () => {
    const { adapters } = makeAdapters(makeSub());
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ClientsContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("clients-gate")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("feature-gate-prompt-trainer_clients"),
    ).toBeTruthy();
    // The hook's upgrade chain points free → basic, so we expect the
    // primary CTA to wire up; this is the deny path that requires an
    // upgrade prompt rather than a "Coming Soon" placeholder.
    expect(screen.queryByTestId("clients-coming-soon")).toBeNull();
  });

  it("renders the FeatureGatePrompt for a premium (non-trainer) user", async () => {
    const { adapters } = makeAdapters(
      makeSub({
        tierName: "premium",
        workoutLimit: null,
        aiAccess: true,
        gymBuddyAccess: true,
        isTrainerTier: false,
      }),
    );
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ClientsContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("clients-gate")).toBeTruthy(),
    );
  });

  it("renders the live roster for an entitled trainer (gate passes)", async () => {
    const { adapters, api } = makeAdapters(makeTrainerSub());
    api.trainerClients = makeTrainerClients();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ClientsContainer />
      </Wrapper>,
    );
    // The roster header + an active row land once the cache-first hook
    // refreshes from the in-memory adapter.
    await waitFor(() =>
      expect(screen.getByTestId("client-row-c-priya")).toBeTruthy(),
    );
    expect(screen.getByText("Clients")).toBeTruthy();
    // Five active clients in the fixture → the eyebrow counts active only.
    expect(screen.getByText("COACHING · 5 ACTIVE")).toBeTruthy();
    expect(screen.queryByTestId("clients-gate")).toBeNull();
    expect(screen.queryByTestId("clients-coming-soon")).toBeNull();
  });

  it("opens the AddClient sheet from the header + (registering a refresh)", async () => {
    const { adapters, api } = makeAdapters(makeTrainerSub());
    api.trainerClients = makeTrainerClients();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ClientsContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("clients-invite-btn")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("clients-invite-btn"));
    const state = useAddClientSheet.getState();
    expect(state.open).toBe(true);
    expect(typeof state.onInvited).toBe("function");

    // Firing the registered callback re-pulls the roster (slot/flag refresh).
    const before = api.getTrainerClientsCalls;
    await act(async () => {
      state.onInvited?.();
    });
    await waitFor(() =>
      expect(api.getTrainerClientsCalls).toBeGreaterThan(before),
    );
  });

  it("at the client-slot cap: warns, shows the slots line, and disables invite", async () => {
    // 30→5 override puts the 5-client roster exactly at cap.
    const { adapters, api } = makeAdapters(
      makeTrainerSub({ trainerClientLimit: 5 }),
    );
    api.trainerClients = makeTrainerClients();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ClientsContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("clients-no-seats-warning")).toBeTruthy(),
    );
    expect(screen.getByText("5 of 5 client slots used")).toBeTruthy();
    // Invite affordance is disabled → pressing it does not open the sheet.
    fireEvent.press(screen.getByTestId("clients-invite-btn"));
    expect(useAddClientSheet.getState().open).toBe(false);
    // "Change subscription" routes to selection, pre-selecting the next tier
    // up (small_business → medium_enterprise).
    fireEvent.press(screen.getByTestId("clients-no-seats-upgrade"));
    expect(mockPush).toHaveBeenCalledWith(
      "/(auth)/subscription-selection?tier=medium_enterprise&cycle=monthly",
    );
  });

  it("pushes the per-client detail route on a row tap", async () => {
    const { adapters, api } = makeAdapters(makeTrainerSub());
    api.trainerClients = makeTrainerClients();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ClientsContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("client-row-c-priya")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("client-row-c-priya"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/clients/c-priya");
  });

  it("upgrade CTA from the gate routes into the Selection screen with the next-tier query params", async () => {
    // Regression cover: the deny branch must surface the upgrade
    // affordance via `useFeatureGate`'s pre-wired `onUpgrade`. We don't
    // assert the exact URL grammar here (that's tested in
    // useFeatureGate.test.tsx); we only assert the wiring fires.
    const { adapters } = makeAdapters(makeSub());
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ClientsContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("feature-gate-upgrade")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("feature-gate-upgrade"));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toMatch(/subscription-selection/);
  });
});
