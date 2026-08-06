import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { MySubscription } from "@/domain/models/subscription";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { WorkoutLimitLockedContainer } from "@/ui/containers/WorkoutLimitLockedContainer";

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
}));

function freeSub(workoutLimit: number | null): MySubscription {
  return {
    subscriptionId: null,
    tierName: "free",
    paymentStatus: "active",
    billingCycle: null,
    startsAt: "2026-01-01T00:00:00Z",
    expiresAt: null,
    cancelledAt: null,
    trialEndsAt: null,
    externalSubscriptionId: null,
    tierDisplayName: "Free",
    tierDescription: null,
    workoutLimit,
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
  };
}

async function renderContainer(opts: { used: number; limit: number | null }) {
  const auth = new InMemoryAuthAdapter();
  await auth.signInWithEmail("u@example.com", "pw");
  const sessionResult = await auth.getSession();
  if (!sessionResult.ok || !sessionResult.value) {
    throw new Error("test fixture: sign-in did not produce a session");
  }
  const userId = sessionResult.value.userId;

  const api = new InMemoryApiAdapter();
  api.mySubscription = freeSub(opts.limit);
  const storage = new InMemoryStorageAdapter();
  storage.cacheWorkoutsList(userId, "mine", [], {
    used: opts.used,
    limit: opts.limit,
  });
  storage.cacheWorkoutsList(userId, "assigned", [], null);
  storage.cacheWorkoutsList(userId, "default", [], null);

  const adapters: Adapters = {
    api,
    auth,
    storage,
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AdapterProvider adapters={adapters}>
        <WorkoutLimitLockedContainer />
      </AdapterProvider>
    </QueryClientProvider>,
  );
}

describe("WorkoutLimitLockedContainer", () => {
  beforeEach(() => {
    mockRouterPush.mockClear();
  });

  it("renders the live count/limit from useWorkoutTotalCapGate", async () => {
    await renderContainer({ used: 5, limit: 3 });
    await waitFor(() =>
      expect(screen.getByText("You have 5 workouts")).toBeTruthy(),
    );
    expect(
      screen.getByText(
        "Free includes 3 — remove 2 workouts or upgrade to keep them all.",
      ),
    ).toBeTruthy();
  });

  it("wires the Upgrade button to the paywall route", async () => {
    await renderContainer({ used: 5, limit: 3 });
    await waitFor(() =>
      expect(screen.getByTestId("workout-limit-locked-upgrade")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("workout-limit-locked-upgrade"));
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/(auth)/subscription-selection?tier=premium&cycle=monthly",
    );
  });

  it("wires the Go to My Workouts button to the Train tab", async () => {
    await renderContainer({ used: 5, limit: 3 });
    await waitFor(() =>
      expect(
        screen.getByTestId("workout-limit-locked-go-to-workouts"),
      ).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("workout-limit-locked-go-to-workouts"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/(tabs)/train");
  });
});
