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
import { usePendingInvite } from "@/state/pending-invite";
import type {
  MySubscription,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useUserMode } from "@/state/user-mode";
import {
  SubscriptionSuccessContainer,
  getSubscriptionBenefits,
  getSuccessMessage,
} from "@/ui/containers/SubscriptionSuccessContainer";

const mockReplace = jest.fn();
let mockSearchParams: Record<string, string | undefined> = {};
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockSearchParams,
}));

function makeAdapters(sub: MySubscription | null): {
  adapters: Adapters;
  api: InMemoryApiAdapter;
} {
  const api = new InMemoryApiAdapter();
  const auth = new InMemoryAuthAdapter();
  api.mySubscription = sub;
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

const SUB_PREMIUM: MySubscription = {
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

beforeEach(() => {
  mockReplace.mockReset();
  mockSearchParams = {};
  useUserMode.setState({
    mode: "athlete",
    isTrainerEligible: false,
    isEligibilityKnown: false,
  });
});

describe("SubscriptionSuccessContainer", () => {
  it("renders premium-tier message + benefits and routes to home", async () => {
    const { adapters } = makeAdapters(SUB_PREMIUM);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSuccessContainer />
      </Wrapper>,
    );
    // Container defaults to "premium" until the useMySubscription query
    // resolves — wait for the premium copy to appear.
    await waitFor(() =>
      expect(
        screen.getByText(/premium subscription is now active/),
      ).toBeTruthy(),
    );
    expect(screen.getByText("Subscription Activated!")).toBeTruthy();
    expect(screen.getByText("Unlimited Workouts")).toBeTruthy();
    fireEvent.press(screen.getByTestId("success-go-home"));
    expect(mockReplace).toHaveBeenCalledWith("/(app)/(tabs)");
  });

  it("redeems a stashed invite code on go-home (new-user carry-through-signup, device-QA #2)", async () => {
    usePendingInvite.getState().setPendingCode("AB23CD");
    const { adapters } = makeAdapters(SUB_PREMIUM);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSuccessContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("success-go-home")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("success-go-home"));
    expect(mockReplace).toHaveBeenCalledWith(
      "/(app)/accept-invite?code=AB23CD",
    );
    usePendingInvite.getState().reset();
  });

  it("shows Manage Clients CTA on trainer tiers and routes appropriately", async () => {
    const trainerSub: MySubscription = {
      ...SUB_PREMIUM,
      tierName: "individual_trainer",
      isTrainerTier: true,
    };
    const { adapters } = makeAdapters(trainerSub);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSuccessContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("success-manage-clients")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("success-manage-clients"));
    // Under Option 3 the Clients tab is only visible in coach mode, so the
    // CTA must enter coach mode (eligible + switched) BEFORE navigating —
    // otherwise the just-paid trainer lands on a hidden tab. The navigate is
    // awaited via switchTo().finally, so assert via waitFor.
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/(app)/(tabs)/clients"),
    );
    expect(useUserMode.getState().isTrainerEligible).toBe(true);
    expect(useUserMode.getState().mode).toBe("coach");
  });

  it("prefers the purchased-tier route param over a stale subscription query (iOS webhook race)", async () => {
    // Simulate the IAP race: the RC webhook hasn't upserted user_subscriptions
    // yet, so /subscriptions/me still reports free. The success screen must
    // still render the purchased trainer tier (from the route param) and show
    // the Manage Clients CTA — not the stale free content.
    mockSearchParams = { tier: "individual_trainer" };
    const freeSub: MySubscription = {
      ...SUB_PREMIUM,
      tierName: "free",
      isTrainerTier: false,
      role: "user",
    };
    const { adapters } = makeAdapters(freeSub);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSuccessContainer />
      </Wrapper>,
    );
    expect(screen.getByText(/trainer subscription is now active/)).toBeTruthy();
    expect(screen.getByTestId("success-manage-clients")).toBeTruthy();
  });

  it.each(["not-a-real-tier", "toString", "constructor"])(
    "ignores an unrecognised tier param (%s) and falls back to the query",
    async (badTier) => {
      // "toString"/"constructor" guard the own-property check — a naive
      // `raw in KNOWN_TIER_NAMES` would match inherited Object.prototype keys.
      mockSearchParams = { tier: badTier };
      const { adapters } = makeAdapters(SUB_PREMIUM);
      render(
        <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
          <SubscriptionSuccessContainer />
        </Wrapper>,
      );
      await waitFor(() =>
        expect(
          screen.getByText(/premium subscription is now active/),
        ).toBeTruthy(),
      );
      expect(screen.queryByTestId("success-manage-clients")).toBeNull();
    },
  );

  it("falls back to generic messaging when no subscription is loaded yet", async () => {
    // Post tier-simplification: defensive fallback is 'free' (basic
    // no longer exists). The free message is the generic copy.
    const { adapters } = makeAdapters(null);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSuccessContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByText("Subscription Activated!")).toBeTruthy(),
    );
    expect(screen.getByText(/subscription is now active/)).toBeTruthy();
  });
});

describe("getSubscriptionBenefits", () => {
  it("returns base benefit for premium", () => {
    expect(getSubscriptionBenefits("premium")).toHaveLength(1);
  });

  it("adds Client Management for any trainer / business / enterprise tier", () => {
    const tiers: SubscriptionTierName[] = [
      "individual_trainer",
      "small_business",
      "medium_enterprise",
    ];
    for (const tier of tiers) {
      const benefits = getSubscriptionBenefits(tier);
      expect(benefits.some((b) => b.title === "Client Management")).toBe(true);
    }
  });

  it("adds AI Analytics for any trainer tier (post tier-simplification — all trainer tiers carry the former Pro entitlements)", () => {
    const benefits = getSubscriptionBenefits("individual_trainer");
    expect(benefits.some((b) => b.title === "AI Analytics & Gym Buddy")).toBe(
      true,
    );
  });
});

describe("getSuccessMessage", () => {
  it("returns trainer-specific copy for trainer tiers", () => {
    expect(getSuccessMessage("individual_trainer")).toMatch(
      /trainer subscription is now active/,
    );
    expect(getSuccessMessage("small_business")).toMatch(/trainer subscription/);
  });

  it("returns premium copy for premium", () => {
    expect(getSuccessMessage("premium")).toMatch(/premium subscription/);
  });

  it("returns generic fallback for free", () => {
    expect(getSuccessMessage("free")).toMatch(/subscription is now active/);
  });
});
