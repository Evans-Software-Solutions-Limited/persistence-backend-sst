import { Alert, Linking } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import { MockPurchasesAdapter } from "@/adapters/purchases/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type {
  MySubscription,
  SubscriptionTier,
} from "@/domain/models/subscription";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  APP_STORE_SUBSCRIPTIONS_URL,
  IOSPurchaseFlowContainer,
} from "@/ui/containers/IOSPurchaseFlowContainer";

jest.setTimeout(20_000);

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

const alertSpy = jest.spyOn(Alert, "alert");
const openURLSpy = jest
  .spyOn(Linking, "openURL")
  .mockResolvedValue(true as never);

const PREMIUM: SubscriptionTier = {
  tierName: "premium",
  displayName: "Premium",
  description: null,
  priceMonthly: 9.99,
  priceYearly: 99.99,
  currency: "GBP",
  features: {},
  workoutLimit: null,
  aiAccess: true,
  aiWorkoutLimit: 6,
  gymBuddyAccess: true,
  trainerClientLimit: null,
  isTrainerTier: false,
  analyticsAccess: false,
  exportAccess: false,
  stripePriceIdMonthly: null,
  stripePriceIdYearly: null,
};

function freeSub(overrides: Partial<MySubscription> = {}): MySubscription {
  return {
    subscriptionId: null,
    tierName: "free",
    paymentStatus: "active",
    billingCycle: null,
    startsAt: new Date().toISOString(),
    expiresAt: null,
    cancelledAt: null,
    trialEndsAt: null,
    externalSubscriptionId: null,
    tierDisplayName: "Free",
    tierDescription: null,
    workoutLimit: 3,
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

function makeAdapters(sub: MySubscription = freeSub()): {
  adapters: Adapters;
  purchases: MockPurchasesAdapter;
} {
  const api = new InMemoryApiAdapter();
  const auth = new InMemoryAuthAdapter();
  const purchases = new MockPurchasesAdapter();
  api.subscriptionTiers = [PREMIUM];
  api.mySubscription = sub;
  purchases.packages = [
    {
      packageId: "$rc_monthly",
      productId: "app.persistence.premium.monthly",
      tier: "premium",
      billingCycle: "monthly",
      priceString: "£9.99",
      introTrialDays: null,
    },
  ];
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
    payments: new MockPaymentsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
    purchases,
  };
  return { adapters, purchases };
}

function qc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderContainer(adapters: Adapters) {
  return render(
    <QueryClientProvider client={qc()}>
      <AdapterProvider adapters={adapters}>
        <IOSPurchaseFlowContainer />
      </AdapterProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockPush.mockReset();
  mockBack.mockReset();
  alertSpy.mockReset();
  openURLSpy.mockClear();
});

afterAll(() => {
  alertSpy.mockRestore();
  openURLSpy.mockRestore();
});

describe("IOSPurchaseFlowContainer", () => {
  it("renders the premium card once queries resolve", async () => {
    const { adapters } = makeAdapters();
    renderContainer(adapters);
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );
  });

  it("shows no trial banner when RevenueCat reports the product intro-ineligible", async () => {
    const { adapters, purchases } = makeAdapters();
    purchases.introEligibility = { "app.persistence.premium.monthly": false };
    renderContainer(adapters);
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );
    expect(screen.queryByText(/free trial/i)).toBeNull();
  });

  it("shows NO trial banner when eligible but no real offer is surfaced (introTrialDays null → never guess a duration)", async () => {
    // Brad's production scenario: RevenueCat says eligible but the ASC intro
    // offer isn't surfacing (introTrialDays null). We must show nothing rather
    // than a guessed number.
    const { adapters, purchases } = makeAdapters();
    purchases.introEligibility = { "app.persistence.premium.monthly": true };
    renderContainer(adapters);
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );
    expect(screen.queryByText(/free trial/i)).toBeNull();
  });

  it("shows the trial banner with the REAL derived period when eligible and the product carries an offer", async () => {
    const { adapters, purchases } = makeAdapters();
    purchases.packages = [
      {
        packageId: "$rc_monthly",
        productId: "app.persistence.premium.monthly",
        tier: "premium",
        billingCycle: "monthly",
        priceString: "£9.99",
        introTrialDays: 7, // real Apple offer surfaced by RevenueCat
      },
    ];
    purchases.introEligibility = { "app.persistence.premium.monthly": true };
    renderContainer(adapters);
    await waitFor(() =>
      expect(screen.getByText("7-day free trial")).toBeTruthy(),
    );
  });

  it("contact sales: Medium Enterprise on yearly opens a sales mailto instead of purchasing", async () => {
    const { adapters, purchases } = makeAdapters();
    const ME: SubscriptionTier = {
      ...PREMIUM,
      tierName: "medium_enterprise",
      displayName: "Medium Enterprise",
      isTrainerTier: true,
      priceYearly: null,
    };
    (adapters.api as InMemoryApiAdapter).subscriptionTiers = [PREMIUM, ME];
    purchases.packages = [
      {
        packageId: "$rc_me_monthly",
        productId: "app.persistence.medium_enterprise.monthly",
        tier: "medium_enterprise",
        billingCycle: "monthly",
        priceString: "£199.99",
        introTrialDays: null,
      },
    ];
    renderContainer(adapters);

    await waitFor(() =>
      expect(screen.getByTestId("role-toggle-trainer")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("role-toggle-trainer"));
    fireEvent.press(screen.getByTestId("billing-cycle-toggle")); // → yearly

    await waitFor(() => expect(screen.getByText("Contact Sales")).toBeTruthy());
    fireEvent.press(screen.getByTestId("trainer-card-medium_enterprise-pro"));

    expect(openURLSpy).toHaveBeenCalledWith(
      expect.stringContaining("mailto:admin@evans-software-solutions.com"),
    );
    expect(purchases.purchaseCalls).toHaveLength(0);
  });

  it("purchase flow: tap premium → purchases the package → routes to success", async () => {
    const { adapters, purchases } = makeAdapters();
    purchases.nextPurchaseResponse = {
      ok: true,
      entitlements: [
        {
          entitlementId: "premium",
          tier: "premium",
          productId: "app.persistence.premium.monthly",
          expiresAt: null,
        },
      ],
    };
    renderContainer(adapters);
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(
        screen.getByTestId("subscription-card-premium-subscribe"),
      );
    });
    await waitFor(() =>
      expect(purchases.purchaseCalls).toEqual(["$rc_monthly"]),
    );
    // The purchased tier is threaded to the success screen so it renders the
    // correct plan immediately (the RC webhook lags the /subscriptions/me read).
    expect(mockPush).toHaveBeenCalledWith("/(auth)/success?tier=premium");
  });

  it("deferred (Ask to Buy) purchase shows a pending notice, not an error, and does not navigate", async () => {
    const { adapters, purchases } = makeAdapters();
    purchases.nextPurchaseResponse = {
      ok: false,
      error: {
        kind: "pending",
        code: "PAYMENT_PENDING_ERROR",
        message: "The payment is pending.",
      },
    };
    renderContainer(adapters);
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(
        screen.getByTestId("subscription-card-premium-subscribe"),
      );
    });
    await waitFor(() => expect(purchases.purchaseCalls).toHaveLength(1));
    expect(alertSpy).toHaveBeenCalledWith(
      "Purchase Pending",
      expect.stringContaining("awaiting approval"),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("alerts (no crash) when a tier has no Apple product for the cycle", async () => {
    const { adapters, purchases } = makeAdapters();
    purchases.packages = []; // no packages configured yet
    renderContainer(adapters);
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(
        screen.getByTestId("subscription-card-premium-subscribe"),
      );
    });
    expect(alertSpy).toHaveBeenCalledWith(
      "Not available",
      expect.stringContaining("isn't available"),
    );
    expect(purchases.purchaseCalls).toEqual([]);
  });

  it("purchase cancellation is silent (no alert)", async () => {
    const { adapters, purchases } = makeAdapters();
    purchases.nextPurchaseResponse = {
      ok: false,
      error: { kind: "cancelled", code: null, message: "Purchase cancelled." },
    };
    renderContainer(adapters);
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(
        screen.getByTestId("subscription-card-premium-subscribe"),
      );
    });
    await waitFor(() => expect(purchases.purchaseCalls).toHaveLength(1));
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("restore: bridges the restored tier to the success screen (no free-tier lag)", async () => {
    const { adapters, purchases } = makeAdapters();
    purchases.nextRestoreResponse = {
      ok: true,
      entitlements: [
        {
          entitlementId: "premium",
          tier: "premium",
          productId: null,
          expiresAt: null,
        },
      ],
    };
    renderContainer(adapters);
    await waitFor(() =>
      expect(screen.getByTestId("ios-purchase-restore")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("ios-purchase-restore"));
    });
    await waitFor(() => expect(purchases.restoreCalls).toBe(1));
    // Navigates to success with the restored tier rather than showing an alert
    // that would leave the paywall on the stale free tier during the webhook race.
    expect(mockPush).toHaveBeenCalledWith("/(auth)/success?tier=premium");
    expect(alertSpy).not.toHaveBeenCalledWith(
      "Purchases Restored",
      expect.any(String),
    );
  });

  it("restore: falls back to an alert when the restored entitlement maps to no known tier", async () => {
    const { adapters, purchases } = makeAdapters();
    purchases.nextRestoreResponse = {
      ok: true,
      entitlements: [
        {
          entitlementId: "legacy_unknown",
          tier: null,
          productId: null,
          expiresAt: null,
        },
      ],
    };
    renderContainer(adapters);
    await waitFor(() =>
      expect(screen.getByTestId("ios-purchase-restore")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("ios-purchase-restore"));
    });
    await waitFor(() => expect(purchases.restoreCalls).toBe(1));
    expect(mockPush).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      "Purchases Restored",
      expect.any(String),
    );
  });

  it("restore: nothing-to-restore surfaces its own alert", async () => {
    const { adapters, purchases } = makeAdapters();
    purchases.nextRestoreResponse = { ok: true, entitlements: [] };
    renderContainer(adapters);
    await waitFor(() =>
      expect(screen.getByTestId("ios-purchase-restore")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("ios-purchase-restore"));
    });
    await waitFor(() => expect(purchases.restoreCalls).toBe(1));
    expect(alertSpy).toHaveBeenCalledWith(
      "Nothing to Restore",
      expect.any(String),
    );
  });

  it("manage in App Store opens Apple's subscriptions page (paid tier)", async () => {
    const { adapters } = makeAdapters(
      freeSub({
        subscriptionId: "us-1",
        tierName: "premium",
        billingCycle: "monthly",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        externalSubscriptionId: "rc_u-1",
      }),
    );
    renderContainer(adapters);
    await waitFor(() =>
      expect(screen.getByTestId("ios-purchase-manage")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("ios-purchase-manage"));
    expect(openURLSpy).toHaveBeenCalledWith(APP_STORE_SUBSCRIPTIONS_URL);
  });

  it("back navigates away", async () => {
    const { adapters } = makeAdapters();
    renderContainer(adapters);
    await waitFor(() =>
      expect(screen.getByTestId("ios-purchase-back")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("ios-purchase-back"));
    expect(mockBack).toHaveBeenCalled();
  });
});
