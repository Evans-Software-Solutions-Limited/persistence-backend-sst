import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TamaguiProvider } from "@tamagui/core";
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
import { ClientsContainer } from "@/ui/containers/ClientsContainer";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
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
    <TamaguiProvider config={config} defaultTheme="dark">
      <QueryClientProvider client={queryClient}>
        <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
      </QueryClientProvider>
    </TamaguiProvider>
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

beforeEach(() => {
  mockPush.mockReset();
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

  it("renders the M8 Coming Soon placeholder for a trainer-standard user", async () => {
    const { adapters } = makeAdapters(
      makeSub({
        tierName: "individual_trainer",
        isTrainerTier: true,
        role: "personal_trainer",
        workoutLimit: null,
        trainerClientLimit: 5,
      }),
    );
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ClientsContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("clients-coming-soon")).toBeTruthy(),
    );
    expect(screen.getByText("Clients")).toBeTruthy();
    expect(
      screen.getByText(/Trainer client management arrives in milestone M8/i),
    ).toBeTruthy();
    expect(screen.queryByTestId("clients-gate")).toBeNull();
  });

  it("renders the M8 Coming Soon placeholder for a trainer-pro user", async () => {
    const { adapters } = makeAdapters(
      makeSub({
        tierName: "individual_trainer",
        isTrainerTier: true,
        role: "personal_trainer",
        workoutLimit: null,
        aiAccess: true,
        gymBuddyAccess: true,
        trainerClientLimit: null,
      }),
    );
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ClientsContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("clients-coming-soon")).toBeTruthy(),
    );
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
