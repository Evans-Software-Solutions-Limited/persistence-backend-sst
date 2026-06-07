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
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
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
  payments: MockPaymentsAdapter;
  netInfo: InMemoryNetInfoAdapter;
} {
  const api = new InMemoryApiAdapter();
  const auth = new InMemoryAuthAdapter();
  const payments = new MockPaymentsAdapter();
  const netInfo = new InMemoryNetInfoAdapter();
  api.subscriptionTiers = [BASIC_TIER, PREMIUM_TIER];
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
    payments,
    netInfo,
  };
  return { adapters, api, auth, payments, netInfo };
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

  it("buy flow: tap premium → mounts payment form → ready → creates sub → routes to /(auth)/success", async () => {
    const { adapters, api, payments } = makeAdapters();
    payments.setNextCollectResponse({
      ok: true,
      paymentMethodId: "pm_buy",
    });
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSelectionContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );

    await act(async () => {
      // Simulate the user tapping the Subscribe CTA on the premium card.
      fireEvent.press(
        screen.getByTestId("subscription-card-premium-subscribe"),
      );
    });

    await waitFor(() => expect(api.createSubscriptionCalls).toBe(1));
    expect(api.lastCreateSubscriptionInput).toMatchObject({
      tierName: "premium",
      billingCycle: "monthly",
      paymentMethodId: "pm_buy",
      useTrial: true,
      // One client idempotency token per Subscribe attempt (spec 17).
      idempotencyKey: expect.stringMatching(/^sub-create-/),
    });
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/(auth)/success"),
    );
  });

  it("3DS flow: requiresAction=true triggers payments.confirm3DS", async () => {
    const { adapters, api, payments } = makeAdapters();
    payments.setNextCollectResponse({ ok: true, paymentMethodId: "pm_3ds" });
    api.setNextCreateSubscriptionResponse({
      requiresAction: true,
      clientSecret: "pi_3ds_secret",
    });
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSelectionContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );

    await act(async () => {
      fireEvent.press(
        screen.getByTestId("subscription-card-premium-subscribe"),
      );
    });

    await waitFor(() => expect(payments.confirm3DSCalls).toBe(1));
    expect(payments.lastConfirm3DSSecret).toBe("pi_3ds_secret");
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
  });

  it("3DS failure alerts and leaves the screen mounted", async () => {
    const { adapters, api, payments } = makeAdapters();
    payments.setNextCollectResponse({ ok: true, paymentMethodId: "pm_x" });
    payments.setNextConfirm3DSResponse({
      ok: false,
      error: { kind: "stripe_error", code: "Failed", message: "3DS denied" },
    });
    api.setNextCreateSubscriptionResponse({
      requiresAction: true,
      clientSecret: "pi_3ds_secret",
    });
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSelectionContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(
        screen.getByTestId("subscription-card-premium-subscribe"),
      );
    });
    await waitFor(() => expect(payments.confirm3DSCalls).toBe(1));
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        "Payment Authentication Failed",
        "3DS denied",
        expect.any(Array),
      ),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("Apple Pay cancel silently clears in-flight selection (no alert)", async () => {
    const { adapters, payments } = makeAdapters();
    payments.setNextCollectResponse({
      ok: false,
      error: { kind: "cancelled", code: "Canceled", message: "user dismissed" },
    });
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSelectionContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(
        screen.getByTestId("subscription-card-premium-subscribe"),
      );
    });
    // Adapter collect was called but no Payment Method Error alert.
    await waitFor(() => expect(payments.collectCalls).toBe(1));
    const errorAlertCalls = alertSpy.mock.calls.filter(
      ([title]) => title === "Payment Method Error",
    );
    expect(errorAlertCalls).toHaveLength(0);
  });

  it("Apple Pay non-cancel error alerts the user", async () => {
    const { adapters, payments } = makeAdapters();
    payments.setNextCollectResponse({
      ok: false,
      error: { kind: "stripe_error", code: "Failed", message: "Card declined" },
    });
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSelectionContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(
        screen.getByTestId("subscription-card-premium-subscribe"),
      );
    });
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        "Payment Method Error",
        "Card declined",
      ),
    );
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

  it("createSubscription error path alerts the user with the SDK message", async () => {
    const { adapters, api, payments } = makeAdapters();
    payments.setNextCollectResponse({ ok: true, paymentMethodId: "pm_x" });
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSelectionContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );
    // Flip shouldFail AFTER initial data loads so only the create call fails.
    api.shouldFail = true;
    await act(async () => {
      fireEvent.press(
        screen.getByTestId("subscription-card-premium-subscribe"),
      );
    });
    await waitFor(() =>
      expect(
        alertSpy.mock.calls.some(([title]) => title === "Subscription Error"),
      ).toBe(true),
    );
  });

  it("tapping the same tier with no changes is a no-op (no Apple Pay fired)", async () => {
    const { adapters, api, payments } = makeAdapters();
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
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("subscription-card-premium-subscribe"));
    // No payment form mounted = no Apple Pay collect call.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(payments.collectCalls).toBe(0);
  });

  it("trial-started alert fires when isTrial=true + trialEndsAt is present", async () => {
    const { adapters, api, payments } = makeAdapters();
    payments.setNextCollectResponse({ ok: true, paymentMethodId: "pm_t" });
    api.setNextCreateSubscriptionResponse({
      isTrial: true,
      trialEndsAt: "2026-06-01T00:00:00.000Z",
    });
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSelectionContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(
        screen.getByTestId("subscription-card-premium-subscribe"),
      );
    });
    await waitFor(() =>
      expect(
        alertSpy.mock.calls.some(([title]) => title === "Trial Started!"),
      ).toBe(true),
    );
  });

  it("chains scheduled + trial alerts via onPress before navigating (Inspector Brad PR #71 medium-severity find — sweep #1)", async () => {
    // Regression: previously, when a response had BOTH scheduled=true
    // and isTrial=true (the trainer-Pro downgrade-with-trial path),
    // Alert.alert fired twice synchronously and router.push fired
    // immediately after — RN serialises alerts on iOS so the second
    // queued behind the first, and the Selection container tore down
    // before either was dismissed.
    const { adapters, api, payments } = makeAdapters();
    payments.setNextCollectResponse({ ok: true, paymentMethodId: "pm_x" });
    api.setNextCreateSubscriptionResponse({
      changeType: "downgrade",
      scheduled: true,
      effectiveAt: "2026-08-01T00:00:00.000Z",
      isTrial: true,
      trialEndsAt: "2026-06-15T00:00:00.000Z",
    });
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSelectionContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(
        screen.getByTestId("subscription-card-premium-subscribe"),
      );
    });

    // First alert (Change Scheduled) is queued; second + navigation are NOT yet.
    await waitFor(() =>
      expect(
        alertSpy.mock.calls.some(([title]) => title === "Change Scheduled"),
      ).toBe(true),
    );
    expect(
      alertSpy.mock.calls.some(([title]) => title === "Trial Started!"),
    ).toBe(false);
    expect(mockPush).not.toHaveBeenCalled();

    // Dismiss the first alert via its OK button onPress.
    const firstAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Change Scheduled",
    );
    const firstOk = firstAlert?.[2]?.find((b) => b.text === "OK");
    await act(async () => {
      firstOk?.onPress?.();
    });

    // Second alert (Trial Started) now fires; navigation still deferred.
    await waitFor(() =>
      expect(
        alertSpy.mock.calls.some(([title]) => title === "Trial Started!"),
      ).toBe(true),
    );
    expect(mockPush).not.toHaveBeenCalled();

    // Dismiss the second alert — navigation finally runs.
    const secondAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Trial Started!",
    );
    const secondOk = secondAlert?.[2]?.find((b) => b.text === "OK");
    await act(async () => {
      secondOk?.onPress?.();
    });

    expect(mockPush).toHaveBeenCalledWith("/(auth)/success");
  });

  it("refuses tier tap on yearly cycle when priceYearly is null + alerts user (Inspector Brad PR #71 medium-severity find — sweep #1)", async () => {
    // Regression: previously, tapping a tier card on the yearly cycle
    // when the tier had no Stripe yearly price would render £0 in the
    // Apple Pay sheet (via `priceYearly ?? 0`) and then 400 from the
    // backend after the biometric tap. Guard the tap at the container.
    const { adapters, api, payments } = makeAdapters();
    payments.setNextCollectResponse({ ok: true, paymentMethodId: "pm_y" });
    // Premium with no yearly price — single-tier catalog (BASIC_TIER
    // dropped post tier-simplification).
    api.subscriptionTiers = [
      { ...PREMIUM_TIER, priceYearly: null, stripePriceIdYearly: null },
    ];
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSelectionContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );

    // Toggle to yearly via the billing-cycle control.
    fireEvent.press(screen.getByTestId("billing-cycle-toggle"));

    await act(async () => {
      fireEvent.press(
        screen.getByTestId("subscription-card-premium-subscribe"),
      );
    });

    // Alert was shown; no Apple Pay collection; no create call.
    expect(
      alertSpy.mock.calls.some(([title]) => title === "Yearly not available"),
    ).toBe(true);
    expect(payments.collectCalls).toBe(0);
    expect(api.createSubscriptionCalls).toBe(0);
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
      BASIC_TIER,
      PREMIUM_TIER,
      {
        ...BASIC_TIER,
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
      BASIC_TIER,
      PREMIUM_TIER,
      {
        ...BASIC_TIER,
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

    it("offline + tap tier → alert + Apple Pay does NOT mount + no createSubscription (AC 11.2 + 11.4)", async () => {
      const { adapters, api, payments, netInfo } = makeAdapters();
      netInfo.setConnected(false);
      render(
        <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
          <SubscriptionSelectionContainer />
        </Wrapper>,
      );
      await waitFor(() =>
        expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
      );
      // Confirm banner is up.
      await waitFor(() =>
        expect(screen.getByTestId("subscription-offline-banner")).toBeTruthy(),
      );

      await act(async () => {
        fireEvent.press(
          screen.getByTestId("subscription-card-premium-subscribe"),
        );
      });

      // Alert was shown; no Apple Pay sheet; no create.
      expect(
        alertSpy.mock.calls.some(([title]) => title === "You're offline"),
      ).toBe(true);
      expect(payments.collectCalls).toBe(0);
      expect(api.createSubscriptionCalls).toBe(0);
    });

    it("offline → online transition then tap tier → Apple Pay mounts normally", async () => {
      const { adapters, api, payments, netInfo } = makeAdapters();
      netInfo.setConnected(false);
      payments.setNextCollectResponse({
        ok: true,
        paymentMethodId: "pm_rec",
      });
      render(
        <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
          <SubscriptionSelectionContainer />
        </Wrapper>,
      );
      await waitFor(() =>
        expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
      );
      await waitFor(() =>
        expect(screen.getByTestId("subscription-offline-banner")).toBeTruthy(),
      );

      // Reconnect.
      await act(async () => {
        netInfo.setConnected(true);
      });

      await act(async () => {
        fireEvent.press(
          screen.getByTestId("subscription-card-premium-subscribe"),
        );
      });

      await waitFor(() => expect(api.createSubscriptionCalls).toBe(1));
      expect(payments.collectCalls).toBeGreaterThan(0);
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

    it("3DS pre-flight: offline between createSubscription + 3DS → alert + 3DS not invoked (AC 11.5)", async () => {
      const { adapters, api, payments, netInfo } = makeAdapters();
      payments.setNextCollectResponse({ ok: true, paymentMethodId: "pm_x" });
      api.setNextCreateSubscriptionResponse({
        requiresAction: true,
        clientSecret: "pi_3ds_secret",
      });
      // Custom: flip offline DURING createSubscription. The mutation
      // resolves with requiresAction=true; before we hand off to 3DS,
      // the container re-reads online status.
      const originalCreate = api.createSubscription.bind(api);
      jest
        .spyOn(api, "createSubscription")
        .mockImplementation(async (input) => {
          const result = await originalCreate(input);
          netInfo.setConnected(false);
          return result;
        });

      render(
        <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
          <SubscriptionSelectionContainer />
        </Wrapper>,
      );
      await waitFor(() =>
        expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
      );
      await act(async () => {
        fireEvent.press(
          screen.getByTestId("subscription-card-premium-subscribe"),
        );
      });

      await waitFor(() =>
        expect(
          alertSpy.mock.calls.some(([title]) => title === "You're offline"),
        ).toBe(true),
      );
      expect(payments.confirm3DSCalls).toBe(0);
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

    it("3DS mid-flight throw → connection-lost alert + state resets (AC 11.5)", async () => {
      const { adapters, api, payments } = makeAdapters();
      payments.setNextCollectResponse({ ok: true, paymentMethodId: "pm_y" });
      api.setNextCreateSubscriptionResponse({
        requiresAction: true,
        clientSecret: "pi_3ds_secret",
      });
      // confirm3DS THROWS (not Result.err) — simulates the Stripe SDK
      // throwing when the device loses connectivity during the
      // challenge sheet.
      jest
        .spyOn(payments, "confirm3DS")
        .mockRejectedValueOnce(new Error("network unreachable"));

      render(
        <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
          <SubscriptionSelectionContainer />
        </Wrapper>,
      );
      await waitFor(() =>
        expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
      );
      await act(async () => {
        fireEvent.press(
          screen.getByTestId("subscription-card-premium-subscribe"),
        );
      });

      await waitFor(() =>
        expect(
          alertSpy.mock.calls.some(
            ([title, message]) =>
              title === "You're offline" &&
              typeof message === "string" &&
              message.includes("Connection lost"),
          ),
        ).toBe(true),
      );
      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});
