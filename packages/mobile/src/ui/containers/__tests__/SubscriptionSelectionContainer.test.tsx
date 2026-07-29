import { Alert } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type {
  MySubscription,
  SubscriptionTier,
} from "@/domain/models/subscription";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { SubscriptionSelectionContainer } from "@/ui/containers/SubscriptionSelectionContainer";

// CI runners are markedly slower than local — async `waitFor` chains
// across React Query providers + AdapterProvider can exceed Jest's
// default 5s on cold mounts. Bump the file-level timeout so the tests
// stay green on CI without papering over a real race condition.
// Local typically finishes each test in <500ms.
jest.setTimeout(20_000);

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
  // PR #73 sweep #3: container now reads deep-link query params
  // (tier/cycle/role) from useLocalSearchParams. Tests don't deep-link
  // — empty object is the right default. Individual tests that exercise
  // the deep-link path override this via jest.doMock or jest.resetModules.
  useLocalSearchParams: () => ({}),
}));

const alertSpy = jest.spyOn(Alert, "alert");

const BASIC_TIER: SubscriptionTier = {
  tierName: "premium",
  displayName: "Basic",
  description: null,
  priceMonthly: 4.99,
  priceYearly: 49.99,
  currency: "GBP",
  features: {},
  workoutLimit: 10,
  aiAccess: true,
  aiWorkoutLimit: 1,
  gymBuddyAccess: false,
  trainerClientLimit: null,
  isTrainerTier: false,
  analyticsAccess: false,
  exportAccess: false,
  stripePriceIdMonthly: "price_basic_m",
  stripePriceIdYearly: "price_basic_y",
};

const PREMIUM_TIER: SubscriptionTier = {
  ...BASIC_TIER,
  tierName: "premium",
  displayName: "Premium",
  priceMonthly: 14.99,
  priceYearly: 149.99,
  workoutLimit: null,
  aiWorkoutLimit: 6,
  gymBuddyAccess: true,
};

function freeSub(overrides: Partial<MySubscription> = {}): MySubscription {
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
    workoutLimit: 5,
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

function makeAdapters(): {
  adapters: Adapters;
  api: InMemoryApiAdapter;
  auth: InMemoryAuthAdapter;
  netInfo: InMemoryNetInfoAdapter;
} {
  const api = new InMemoryApiAdapter();
  const auth = new InMemoryAuthAdapter();
  const netInfo = new InMemoryNetInfoAdapter();
  // BASIC_TIER intentionally excluded here — post tier-simplification the
  // catalog has exactly one consumer row (`premium`), and BASIC_TIER's
  // `tierName` is ALSO "premium" (a stale relic from before Basic was
  // dropped from the catalog — see the "BASIC_TIER dropped post
  // tier-simplification" comment further down this file). Two rows
  // sharing one `tierName` violates the real `subscription_tiers` UNIQUE
  // constraint and made `getByTestId("subscription-card-premium")` match
  // twice once M19-P0's presenter change iterates every consumer tier
  // instead of doing a single `.find()` (which silently picked whichever
  // came first). `BASIC_TIER` itself is kept only as the base object
  // `PREMIUM_TIER` spreads from.
  api.subscriptionTiers = [PREMIUM_TIER];
  api.mySubscription = freeSub();
  auth.currentSession = {
    accessToken: "tok",
    refreshToken: "rtok",
    userId: "u-1",
    email: "x@y.com",
    expiresAt: Date.now() + 3600_000,
  };
  const adapters: Adapters = {
    api,
    auth,
    storage: new InMemoryStorageAdapter(),
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    netInfo,
  };
  return { adapters, api, auth, netInfo };
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
    <QueryClientProvider client={queryClient}>
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockPush.mockReset();
  mockBack.mockReset();
  alertSpy.mockReset();
});

afterAll(() => {
  alertSpy.mockRestore();
});

describe("SubscriptionSelectionContainer", () => {
  it("renders tier cards once the tier query resolves", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSelectionContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );
    expect(screen.getByTestId("subscription-card-premium")).toBeTruthy();
  });

  // The Stripe Apple Pay rail was removed in full (App Review Guideline 2.1 —
  // it linked PassKit into the binary while being unreachable on iOS). This
  // non-iOS surface is now a catalogue: tapping a paid tier explains where to
  // buy instead of starting a purchase, and no subscription is ever created.
  it("tapping a paid tier explains purchasing is App-Store-only and creates nothing", async () => {
    const { adapters, api } = makeAdapters();
    const createSpy = jest.spyOn(api, "createSubscription");
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSelectionContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("subscription-card-premium"));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toBe("Not available on this device");
    expect(alertSpy.mock.calls[0][1]).toContain("App Store");
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("tapping the tier you already hold says nothing (Inspector Brad)", async () => {
    const { adapters, api } = makeAdapters();
    api.mySubscription = freeSub({
      subscriptionId: "us_1",
      tierName: "premium",
      paymentStatus: "active",
      billingCycle: "monthly",
    });
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSelectionContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );
    // SubscriptionCard stays pressable when `isCurrent` — without the guard a
    // subscriber tapping their own "Current Plan" is told to go and buy it.
    fireEvent.press(screen.getByTestId("subscription-card-premium"));
    expect(alertSpy).not.toHaveBeenCalled();
  });

  // (Downgrade-scheduled test removed during tier simplification — the
  // direct same-screen downgrade flow only exists on the trainer track
  // now, and the SubscriptionManagementContainer tests cover the
  // scheduled-change response handling end-to-end on the Management
  // screen which is the primary surface for tier transitions.)

  it("cancel flow: tap → confirm modal → confirm → calls cancelSubscription + success alert with router.back on OK", async () => {
    const { adapters, api } = makeAdapters();
    api.mySubscription = freeSub({
      subscriptionId: "us_1",
      tierName: "premium",
      paymentStatus: "active",
      billingCycle: "monthly",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSelectionContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("cancel-subscription-button")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("cancel-subscription-button"));
    await waitFor(() =>
      expect(screen.getByTestId("cancel-subscription-modal")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("cancel-modal-confirm"));
    });
    await waitFor(() => expect(api.cancelSubscriptionCalls).toBe(1));
    expect(api.lastCancelSubscription?.input).toEqual({
      cancelImmediately: false,
      // One client idempotency token per Cancel confirmation (spec 17).
      idempotencyKey: expect.stringMatching(/^sub-cancel-/),
    });
    // Success alert fires; clicking OK routes back.
    await waitFor(() => {
      const ok = alertSpy.mock.calls.find(
        ([title]) => title === "Subscription Cancelled",
      );
      expect(ok).toBeTruthy();
    });
    const successAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Subscription Cancelled",
    );
    const okButton = successAlert?.[2]?.find((b) => b.text === "OK");
    okButton?.onPress?.();
    expect(mockBack).toHaveBeenCalled();
  });

  it("cancel modal dismiss closes the modal without firing cancelSubscription", async () => {
    const { adapters, api } = makeAdapters();
    api.mySubscription = freeSub({
      subscriptionId: "us_1",
      tierName: "premium",
      paymentStatus: "active",
      billingCycle: "monthly",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSelectionContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("cancel-subscription-button")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("cancel-subscription-button"));
    await waitFor(() =>
      expect(screen.getByTestId("cancel-subscription-modal")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("cancel-modal-dismiss"));
    expect(api.cancelSubscriptionCalls).toBe(0);
  });

  it("cancel error path alerts the user", async () => {
    const { adapters, api } = makeAdapters();
    api.mySubscription = freeSub({
      subscriptionId: "us_1",
      tierName: "premium",
      paymentStatus: "active",
      billingCycle: "monthly",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSelectionContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("cancel-subscription-button")).toBeTruthy(),
    );
    api.shouldFail = true;
    fireEvent.press(screen.getByTestId("cancel-subscription-button"));
    await waitFor(() =>
      expect(screen.getByTestId("cancel-subscription-modal")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("cancel-modal-confirm"));
    });
    await waitFor(() =>
      expect(alertSpy.mock.calls.some(([title]) => title === "Error")).toBe(
        true,
      ),
    );
  });

  it("retry button reloads the tiers query", async () => {
    const { adapters } = makeAdapters();
    // Need a fresh adapter with shouldFail to put screen into error state.
    const freshApi = new InMemoryApiAdapter();
    freshApi.shouldFail = true;
    adapters.api = freshApi;
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSelectionContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("subscription-selection-error")).toBeTruthy(),
    );
    // Unset shouldFail + seed tiers, then tap retry — query refetches.
    freshApi.shouldFail = false;
    freshApi.subscriptionTiers = [BASIC_TIER];
    freshApi.mySubscription = freeSub();
    await act(async () => {
      fireEvent.press(screen.getByTestId("subscription-selection-retry"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );
  });

  it("back button calls router.back", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSelectionContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("subscription-selection-back")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("subscription-selection-back"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("auto-defaults role toggle to 'trainer' when profile.role is personal_trainer", async () => {
    const { adapters, api } = makeAdapters();
    api.mySubscription = freeSub({ role: "personal_trainer" });
    api.subscriptionTiers = [
      PREMIUM_TIER,
      {
        ...PREMIUM_TIER,
        tierName: "individual_trainer",
        isTrainerTier: true,
        trainerClientLimit: 10,
        displayName: "Individual Trainer (Standard)",
      },
    ];
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSelectionContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("trainer-subscription-card-individual_trainer"),
      ).toBeTruthy(),
    );
  });

  it("auto-defaults role toggle to 'trainer' when profile.role is physiotherapist", async () => {
    const { adapters, api } = makeAdapters();
    api.mySubscription = freeSub({ role: "physiotherapist" });
    // Add trainer tiers so we can detect the toggle landed correctly.
    api.subscriptionTiers = [
      PREMIUM_TIER,
      {
        ...PREMIUM_TIER,
        tierName: "individual_trainer",
        isTrainerTier: true,
        trainerClientLimit: 10,
      },
    ];
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSelectionContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId(/^trainer-subscription-card/)).toBeTruthy(),
    );
  });

  it("billing cycle auto-defaults from current sub when set", async () => {
    const { adapters, api } = makeAdapters();
    api.mySubscription = freeSub({
      subscriptionId: "us_y",
      tierName: "premium",
      paymentStatus: "active",
      billingCycle: "yearly",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSelectionContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );
    // Yearly card prices are rendered for both basic and premium when
    // billing cycle defaults to yearly.
    await waitFor(() =>
      expect(screen.getAllByText(/\/year/).length).toBeGreaterThan(0),
    );
  });

  it("renders the cancel button + Current status card when on a paid tier with active sub", async () => {
    const { adapters, api } = makeAdapters();
    api.mySubscription = freeSub({
      subscriptionId: "us_1",
      tierName: "premium",
      paymentStatus: "active",
      billingCycle: "monthly",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSelectionContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("cancel-subscription-button")).toBeTruthy(),
    );
    expect(screen.getByTestId("current-subscription-status-card")).toBeTruthy();
  });

  // M10.5 — offline + slow-network UX
  describe("M10.5 — offline + slow-network UX", () => {
    it("renders the offline banner when netInfo reports disconnected (AC 11.1)", async () => {
      const { adapters, netInfo } = makeAdapters();
      netInfo.setConnected(false);
      render(
        <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
          <SubscriptionSelectionContainer />
        </Wrapper>,
      );
      await waitFor(() =>
        expect(screen.getByTestId("subscription-offline-banner")).toBeTruthy(),
      );
      // Cached tiers + cards still render.
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy();
    });

    it("offline + tap cancel → alert + no cancelSubscription (AC 11.2 + 11.4)", async () => {
      const { adapters, api, netInfo } = makeAdapters();
      api.mySubscription = freeSub({
        subscriptionId: "us_1",
        tierName: "premium",
        paymentStatus: "active",
        billingCycle: "monthly",
        expiresAt: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      });
      render(
        <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
          <SubscriptionSelectionContainer />
        </Wrapper>,
      );
      await waitFor(() =>
        expect(screen.getByTestId("cancel-subscription-button")).toBeTruthy(),
      );
      // Now go offline and tap cancel.
      await act(async () => {
        netInfo.setConnected(false);
      });
      fireEvent.press(screen.getByTestId("cancel-subscription-button"));
      await waitFor(() =>
        expect(screen.getByTestId("cancel-subscription-modal")).toBeTruthy(),
      );
      await act(async () => {
        fireEvent.press(screen.getByTestId("cancel-modal-confirm"));
      });
      expect(
        alertSpy.mock.calls.some(([title]) => title === "You're offline"),
      ).toBe(true);
      expect(api.cancelSubscriptionCalls).toBe(0);
    });

    it("slow-network indicator appears after 8s while query is loading (AC 11.3)", async () => {
      jest.useFakeTimers();
      try {
        const { adapters } = makeAdapters();
        // Stall the tiers query by returning a never-resolving promise.
        const api = adapters.api as InMemoryApiAdapter;
        jest
          .spyOn(api, "getSubscriptionTiers")
          .mockImplementation(() => new Promise(() => {}));
        jest
          .spyOn(api, "getMySubscription")
          .mockImplementation(() => new Promise(() => {}));
        render(
          <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
            <SubscriptionSelectionContainer />
          </Wrapper>,
        );
        // Loading state up; slow-loading indicator NOT yet (under 8s).
        await waitFor(() =>
          expect(
            screen.getByTestId("subscription-selection-loading"),
          ).toBeTruthy(),
        );
        expect(
          screen.queryByTestId("subscription-selection-slow-loading"),
        ).toBeNull();
        // Advance past the 8s threshold.
        act(() => {
          jest.advanceTimersByTime(8000);
        });
        await waitFor(() =>
          expect(
            screen.getByTestId("subscription-selection-slow-loading"),
          ).toBeTruthy(),
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
