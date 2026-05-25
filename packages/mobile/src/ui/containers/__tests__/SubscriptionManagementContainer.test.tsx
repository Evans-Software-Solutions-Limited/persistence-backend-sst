import { Alert } from "react-native";
import {
  act,
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
import type {
  MySubscription,
  SubscriptionTier,
} from "@/domain/models/subscription";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { SubscriptionManagementContainer } from "@/ui/containers/SubscriptionManagementContainer";

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
}));

const alertSpy = jest.spyOn(Alert, "alert");

const BASIC_TIER: SubscriptionTier = {
  tierName: "basic",
  displayName: "Basic",
  description: null,
  priceMonthly: 7.99,
  priceYearly: 79.99,
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
  priceMonthly: 12.99,
  priceYearly: 129.99,
  workoutLimit: null,
  gymBuddyAccess: true,
  aiWorkoutLimit: 6,
};
const TRAINER_PRO_TIER: SubscriptionTier = {
  ...BASIC_TIER,
  tierName: "individual_trainer_pro",
  displayName: "Individual Trainer Pro",
  priceMonthly: 14.99,
  priceYearly: 149.99,
  isTrainerTier: true,
  trainerClientLimit: 5,
  workoutLimit: null,
};
const DEFAULT_TIERS: SubscriptionTier[] = [
  BASIC_TIER,
  PREMIUM_TIER,
  TRAINER_PRO_TIER,
];

function makeAdapters(
  sub: MySubscription | null,
  tiers: SubscriptionTier[] = DEFAULT_TIERS,
): {
  adapters: Adapters;
  api: InMemoryApiAdapter;
  netInfo: InMemoryNetInfoAdapter;
} {
  const api = new InMemoryApiAdapter();
  const auth = new InMemoryAuthAdapter();
  const netInfo = new InMemoryNetInfoAdapter();
  api.mySubscription = sub;
  api.subscriptionTiers = tiers;
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
    netInfo,
  };
  return { adapters, api, netInfo };
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

const PREMIUM_SUB: MySubscription = {
  subscriptionId: "us_1",
  tierName: "premium",
  paymentStatus: "active",
  billingCycle: "monthly",
  startsAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-07-01T00:00:00.000Z",
  cancelledAt: null,
  trialEndsAt: null,
  externalSubscriptionId: "sub_1",
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
  isEligibleForUserTrial: false,
  isEligibleForTrainerTrial: false,
  scheduledChange: null,
};

const BASIC_SUB: MySubscription = {
  ...PREMIUM_SUB,
  tierName: "basic",
  tierDisplayName: "Basic",
};

beforeEach(() => {
  mockBack.mockReset();
  alertSpy.mockReset();
});

afterAll(() => {
  alertSpy.mockRestore();
});

// Drives the confirmation flow: presses the picker switch for `targetTier`,
// then taps the resolved confirmation button on the resulting Alert.
async function pressSwitchAndConfirm(targetTier: string) {
  await act(async () => {
    fireEvent.press(
      screen.getByTestId(`management-picker-switch-${targetTier}`),
    );
  });
  // Container picks confirm-button text by direction: "Upgrade" for up,
  // "Confirm" for down/cross-track. Cover both.
  const lastAlert = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
  const buttons = (lastAlert?.[2] ?? []) as Array<{
    text?: string;
    style?: string;
    onPress?: () => void | Promise<void>;
  }>;
  const confirmButton =
    buttons.find((b) => b.text === "Upgrade") ??
    buttons.find((b) => b.text === "Confirm");
  await act(async () => {
    await confirmButton?.onPress?.();
  });
}

describe("SubscriptionManagementContainer", () => {
  it("renders the management screen once data loads", async () => {
    const { adapters } = makeAdapters(BASIC_SUB);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText("Basic")).toBeTruthy());
    expect(screen.getByText("Current Plan")).toBeTruthy();
  });

  it("upgrade via picker: confirmation alert + on confirm calls createSubscription WITHOUT paymentMethodId", async () => {
    const { adapters, api } = makeAdapters(BASIC_SUB);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("management-picker-switch-premium"),
      ).toBeTruthy(),
    );
    await pressSwitchAndConfirm("premium");

    const upgradeAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Upgrade Subscription",
    );
    expect(upgradeAlert?.[1]).toMatch(/prorated/);

    expect(api.createSubscriptionCalls).toBe(1);
    expect(api.lastCreateSubscriptionInput).toEqual({
      tierName: "premium",
      billingCycle: "monthly",
      useTrial: false,
    });
    expect(api.lastCreateSubscriptionInput?.paymentMethodId).toBeUndefined();
  });

  it("downgrade via picker: confirmation + on confirm uses tier_name='basic' + scheduled-success wording", async () => {
    const { adapters, api } = makeAdapters(PREMIUM_SUB);
    api.setNextCreateSubscriptionResponse({
      changeType: "downgrade",
      scheduled: true,
      effectiveAt: "2026-07-01T00:00:00.000Z",
    });
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("management-picker-switch-basic")).toBeTruthy(),
    );
    await pressSwitchAndConfirm("basic");

    const downgradeAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Downgrade Subscription",
    );
    expect(downgradeAlert?.[1]).toMatch(/end of your current billing period/);

    expect(api.lastCreateSubscriptionInput).toEqual({
      tierName: "basic",
      billingCycle: "monthly",
      useTrial: false,
    });
    // Phase 2 — downgrade success uses "Scheduled" wording, not "Success"
    await waitFor(() => {
      expect(alertSpy.mock.calls.some(([title]) => title === "Scheduled")).toBe(
        true,
      );
    });
  });

  it("cross-track switch: premium → individual_trainer_pro fires createSubscription with trainer tier", async () => {
    const { adapters, api } = makeAdapters(PREMIUM_SUB);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("management-picker-switch-individual_trainer_pro"),
      ).toBeTruthy(),
    );
    await pressSwitchAndConfirm("individual_trainer_pro");

    // Cross-track title uses "Switch to <displayName>"
    expect(
      alertSpy.mock.calls.some(
        ([title]) =>
          typeof title === "string" &&
          title.startsWith("Switch to Individual Trainer Pro"),
      ),
    ).toBe(true);
    expect(api.lastCreateSubscriptionInput?.tierName).toBe(
      "individual_trainer_pro",
    );
  });

  it("cancel: shows trial-aware confirmation; on confirm calls cancelSubscription", async () => {
    const trialingSub = {
      ...PREMIUM_SUB,
      paymentStatus: "trialing" as const,
      trialEndsAt: "2026-06-01T00:00:00.000Z",
    };
    const { adapters, api } = makeAdapters(trialingSub);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("management-cancel-button")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("management-cancel-button"));
    });
    const cancelAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Cancel Subscription",
    );
    expect(cancelAlert?.[1]).toMatch(/trial/);
    const destructiveButton = cancelAlert?.[2]?.find(
      (b) => b.style === "destructive",
    );
    await act(async () => {
      await destructiveButton?.onPress?.();
    });
    expect(api.cancelSubscriptionCalls).toBe(1);
    expect(api.lastCancelSubscription?.subscriptionId).toBe("us_1");
  });

  it("cancel from active (non-trialing) sub: success alert uses 'subscription' wording", async () => {
    const { adapters, api } = makeAdapters(PREMIUM_SUB);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("management-cancel-button")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("management-cancel-button"));
    });
    const cancelAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Cancel Subscription",
    );
    expect(cancelAlert?.[1]).not.toMatch(/trial/);
    const destructive = cancelAlert?.[2]?.find(
      (b) => b.style === "destructive",
    );
    await act(async () => {
      await destructive?.onPress?.();
    });
    expect(api.cancelSubscriptionCalls).toBe(1);
    const successAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Subscription Cancelled",
    );
    expect(successAlert?.[1]).toMatch(/Your subscription will end/);
  });

  it("hides the cancel button when subscription is already cancelled (bug 8a guard)", async () => {
    const cancelledSub: MySubscription = {
      ...PREMIUM_SUB,
      cancelledAt: "2026-05-25T14:33:31.000Z",
    };
    const { adapters } = makeAdapters(cancelledSub);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("management-cancelled-notice")).toBeTruthy(),
    );
    expect(screen.queryByTestId("management-cancel-button")).toBeNull();
  });

  it("shows scheduled-change card + hides downgrade rows when a scheduled change is pending", async () => {
    const subWithScheduled: MySubscription = {
      ...PREMIUM_SUB,
      scheduledChange: {
        nextTierName: "basic",
        nextDisplayName: "Basic",
        effectiveAt: "2026-06-01T00:00:00.000Z",
      },
    };
    const { adapters } = makeAdapters(subWithScheduled);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("management-scheduled-card")).toBeTruthy(),
    );
    // basic (£7.99) < premium (£12.99) — downgrade — hidden
    expect(screen.queryByTestId("management-picker-row-basic")).toBeNull();
    // trainer_pro (£14.99) > premium (£12.99) — upgrade — shown
    expect(
      screen.getByTestId("management-picker-row-individual_trainer_pro"),
    ).toBeTruthy();
  });

  it("alerts the user when tier-change fails", async () => {
    const { adapters, api } = makeAdapters(BASIC_SUB);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("management-picker-switch-premium"),
      ).toBeTruthy(),
    );
    api.shouldFail = true;
    await pressSwitchAndConfirm("premium");
    await waitFor(() =>
      expect(alertSpy.mock.calls.some(([title]) => title === "Error")).toBe(
        true,
      ),
    );
  });

  it("alerts the user when cancel fails", async () => {
    const { adapters, api } = makeAdapters(PREMIUM_SUB);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("management-cancel-button")).toBeTruthy(),
    );
    api.shouldFail = true;
    await act(async () => {
      fireEvent.press(screen.getByTestId("management-cancel-button"));
    });
    const cancelAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Cancel Subscription",
    );
    const destructive = cancelAlert?.[2]?.find(
      (b) => b.style === "destructive",
    );
    await act(async () => {
      await destructive?.onPress?.();
    });
    await waitFor(() =>
      expect(alertSpy.mock.calls.some(([title]) => title === "Error")).toBe(
        true,
      ),
    );
  });

  it("uses yearly pricing path when subscription billingCycle is yearly", async () => {
    const yearlySub: MySubscription = { ...BASIC_SUB, billingCycle: "yearly" };
    const { adapters, api } = makeAdapters(yearlySub);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("management-picker-switch-premium"),
      ).toBeTruthy(),
    );
    // Yearly price (£129.99/year) renders, not monthly (£12.99/month).
    expect(screen.getByText("£129.99/year")).toBeTruthy();
    await pressSwitchAndConfirm("premium");
    expect(api.lastCreateSubscriptionInput?.billingCycle).toBe("yearly");
  });

  it("defaults billingCycle to monthly when sub has null billingCycle", async () => {
    const subNoBilling = { ...BASIC_SUB, billingCycle: null };
    const { adapters, api } = makeAdapters(subNoBilling);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("management-picker-switch-premium"),
      ).toBeTruthy(),
    );
    await pressSwitchAndConfirm("premium");
    expect(api.lastCreateSubscriptionInput?.billingCycle).toBe("monthly");
  });

  it("downgrade without effectiveAt uses fallback wording", async () => {
    const { adapters, api } = makeAdapters(PREMIUM_SUB);
    api.setNextCreateSubscriptionResponse({
      changeType: "downgrade",
      scheduled: false,
      effectiveAt: null,
    });
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("management-picker-switch-basic")).toBeTruthy(),
    );
    await pressSwitchAndConfirm("basic");
    const scheduledAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Scheduled",
    );
    expect(scheduledAlert?.[1]).toMatch(/end of your current billing period/);
  });

  it("hides picker entirely on free tier (free users go via Selection)", async () => {
    const freeSub: MySubscription = {
      ...BASIC_SUB,
      tierName: "free",
      tierDisplayName: "Free",
      subscriptionId: null,
    };
    const { adapters, api } = makeAdapters(freeSub);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText("Free")).toBeTruthy());
    expect(screen.queryByTestId("management-cancel-button")).toBeNull();
    expect(screen.queryByTestId("management-picker-card")).toBeNull();
    expect(api.cancelSubscriptionCalls).toBe(0);
  });

  it("calls router.back when back is pressed", async () => {
    const { adapters } = makeAdapters(BASIC_SUB);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText("Current Plan")).toBeTruthy());
    await waitFor(() =>
      expect(screen.getByTestId("subscription-management-back")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("subscription-management-back"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  describe("M10.5 — offline + slow-network UX", () => {
    it("renders the offline banner when netInfo reports disconnected (AC 11.1)", async () => {
      const { adapters, netInfo } = makeAdapters(BASIC_SUB);
      netInfo.setConnected(false);
      render(
        <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
          <SubscriptionManagementContainer />
        </Wrapper>,
      );
      await waitFor(() =>
        expect(screen.getByTestId("subscription-offline-banner")).toBeTruthy(),
      );
      expect(screen.getByText("Current Plan")).toBeTruthy();
    });

    it("offline + tap a picker switch → alert + no createSubscription (AC 11.2 + 11.4)", async () => {
      const { adapters, api, netInfo } = makeAdapters(BASIC_SUB);
      render(
        <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
          <SubscriptionManagementContainer />
        </Wrapper>,
      );
      await waitFor(() =>
        expect(
          screen.getByTestId("management-picker-switch-premium"),
        ).toBeTruthy(),
      );
      await act(async () => {
        netInfo.setConnected(false);
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId("management-picker-switch-premium"));
      });
      expect(
        alertSpy.mock.calls.some(([title]) => title === "You're offline"),
      ).toBe(true);
      expect(
        alertSpy.mock.calls.some(([title]) => title === "Upgrade Subscription"),
      ).toBe(false);
      expect(api.createSubscriptionCalls).toBe(0);
    });

    it("offline + tap Cancel → alert + no cancelSubscription (AC 11.2 + 11.4)", async () => {
      const { adapters, api, netInfo } = makeAdapters(PREMIUM_SUB);
      render(
        <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
          <SubscriptionManagementContainer />
        </Wrapper>,
      );
      await waitFor(() =>
        expect(screen.getByTestId("management-cancel-button")).toBeTruthy(),
      );
      await act(async () => {
        netInfo.setConnected(false);
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId("management-cancel-button"));
      });
      expect(
        alertSpy.mock.calls.some(([title]) => title === "You're offline"),
      ).toBe(true);
      expect(
        alertSpy.mock.calls.some(([title]) => title === "Cancel Subscription"),
      ).toBe(false);
      expect(api.cancelSubscriptionCalls).toBe(0);
    });

    it("slow-network indicator appears after 8s on Management while query is loading (AC 11.3)", async () => {
      jest.useFakeTimers();
      try {
        const { adapters } = makeAdapters(BASIC_SUB);
        const api = adapters.api as InMemoryApiAdapter;
        jest
          .spyOn(api, "getMySubscription")
          .mockImplementation(() => new Promise(() => {}));
        render(
          <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
            <SubscriptionManagementContainer />
          </Wrapper>,
        );
        await waitFor(() =>
          expect(
            screen.getByTestId("subscription-management-loading"),
          ).toBeTruthy(),
        );
        expect(
          screen.queryByTestId("subscription-management-slow-loading"),
        ).toBeNull();
        act(() => {
          jest.advanceTimersByTime(8000);
        });
        await waitFor(() =>
          expect(
            screen.getByTestId("subscription-management-slow-loading"),
          ).toBeTruthy(),
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
