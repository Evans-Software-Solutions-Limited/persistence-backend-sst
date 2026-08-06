import type {
  MySubscription,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import React from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useTrainSegment } from "@/ui/hooks/useTrainSegment";
import {
  computeWorkoutTotalCapVerdict,
  useWorkoutTotalCapGate,
} from "../useWorkoutTotalCapGate";

// `useWorkoutTotalCapGate` imports the expo-router singleton for
// navigation — unmocked, requiring it pulls in RN's dev-server plumbing.
const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
}));

function makeAdapters(): Adapters {
  return {
    api: new InMemoryApiAdapter(),
    auth: new InMemoryAuthAdapter(),
    storage: new InMemoryStorageAdapter(),
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
  };
}

function wrap(adapters: Adapters, client: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
      </QueryClientProvider>
    );
  };
}

function sub(
  tierName: SubscriptionTierName,
  workoutLimit: number | null,
): MySubscription {
  return {
    subscriptionId: tierName === "free" ? null : "sub-1",
    tierName,
    paymentStatus: "active",
    billingCycle: tierName === "free" ? null : "monthly",
    startsAt: "2026-07-01T00:00:00Z",
    expiresAt: null,
    cancelledAt: null,
    trialEndsAt: null,
    externalSubscriptionId: null,
    tierDisplayName: tierName,
    tierDescription: null,
    workoutLimit,
    aiAccess: tierName !== "free",
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

describe("computeWorkoutTotalCapVerdict", () => {
  it("is false for a paid tier regardless of count (limit === null, unlimited)", () => {
    expect(computeWorkoutTotalCapVerdict("premium", 50, null)).toBe(false);
  });

  it("is false for a free user UNDER the limit", () => {
    expect(computeWorkoutTotalCapVerdict("free", 2, 3)).toBe(false);
  });

  it("is false for a free user sitting at EXACTLY the limit (strictly-over, not at-or-over)", () => {
    expect(computeWorkoutTotalCapVerdict("free", 3, 3)).toBe(false);
  });

  it("is true for a free user STRICTLY OVER the limit", () => {
    expect(computeWorkoutTotalCapVerdict("free", 4, 3)).toBe(true);
  });

  it("is false when the tier is not resolved yet (null tierName)", () => {
    expect(computeWorkoutTotalCapVerdict(null, 20, 3)).toBe(false);
  });

  it("is false for a non-free tier even with a huge count (defensive — non-free tiers carry limit=null)", () => {
    expect(computeWorkoutTotalCapVerdict("premium_plus", 999, null)).toBe(
      false,
    );
  });

  it("is false for a free tier with limit=null (catalog drift — free configured unlimited)", () => {
    expect(computeWorkoutTotalCapVerdict("free", 40, null)).toBe(false);
  });
});

describe("useWorkoutTotalCapGate", () => {
  beforeEach(() => {
    mockRouterPush.mockClear();
    useTrainSegment.setState({
      segment: "Exercises",
      pendingCreate: false,
    } as never);
  });

  /**
   * `useAuth()` learns the session from `auth.onAuthStateChange`, subscribed
   * at mount — NOT by polling `getSession()` reactively. So every fixture
   * below signs in via the real `InMemoryAuthAdapter` flow FIRST and reads
   * back the userId it actually assigned, then caches storage under that
   * exact id. Spying on `getSession()` alone (without a real sign-in) leaves
   * `useAuth().session` null and the whole gate permanently unresolved —
   * the trap this comment exists to stop a future edit from re-introducing.
   */
  async function signedInUserId(auth: InMemoryAuthAdapter): Promise<string> {
    await auth.signInWithEmail("u@example.com", "pw");
    const sessionResult = await auth.getSession();
    if (!sessionResult.ok || !sessionResult.value) {
      throw new Error("test fixture: sign-in did not produce a session");
    }
    return sessionResult.value.userId;
  }

  it("is NOT over-limit while the subscription query is unresolved (fail-open, not fail-closed)", async () => {
    const auth = new InMemoryAuthAdapter();
    await auth.signInWithEmail("u@example.com", "pw");
    const api = new InMemoryApiAdapter();
    // Never resolves — models a slow/hung network. Blocking a legitimate
    // paying user from starting a workout on a slow connection would be a
    // worse failure mode than briefly under-enforcing (the server's
    // `evaluateWorkoutTotalCapLock` 402 is the backstop).
    jest
      .spyOn(api, "getMySubscription")
      .mockImplementation(() => new Promise(() => {}));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, unmount } = renderHook(() => useWorkoutTotalCapGate(), {
      wrapper: wrap({ ...makeAdapters(), api, auth }, client),
    });

    expect(result.current.isOverLimit).toBe(false);
    unmount();
    client.clear();
  });

  it("is over-limit for a free user whose cached TOTAL count exceeds the tier's workoutLimit", async () => {
    const auth = new InMemoryAuthAdapter();
    const userId = await signedInUserId(auth);

    const api = new InMemoryApiAdapter();
    api.mySubscription = sub("free", 3);
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutsList(userId, "mine", [], { used: 4, limit: 3 });
    storage.cacheWorkoutsList(userId, "assigned", [], null);
    storage.cacheWorkoutsList(userId, "default", [], null);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, unmount } = renderHook(() => useWorkoutTotalCapGate(), {
      wrapper: wrap({ ...makeAdapters(), api, auth, storage }, client),
    });

    await waitFor(() => expect(result.current.isResolved).toBe(true));
    expect(result.current.isOverLimit).toBe(true);
    expect(result.current.used).toBe(4);
    expect(result.current.limit).toBe(3);

    unmount();
    client.clear();
  });

  it("is NOT over-limit for a free user at exactly the limit", async () => {
    const auth = new InMemoryAuthAdapter();
    const userId = await signedInUserId(auth);

    const api = new InMemoryApiAdapter();
    api.mySubscription = sub("free", 3);
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutsList(userId, "mine", [], { used: 3, limit: 3 });
    storage.cacheWorkoutsList(userId, "assigned", [], null);
    storage.cacheWorkoutsList(userId, "default", [], null);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, unmount } = renderHook(() => useWorkoutTotalCapGate(), {
      wrapper: wrap({ ...makeAdapters(), api, auth, storage }, client),
    });

    await waitFor(() => expect(result.current.isResolved).toBe(true));
    expect(result.current.isOverLimit).toBe(false);

    unmount();
    client.clear();
  });

  it("is NOT over-limit for a paid tier regardless of count (unlimited)", async () => {
    const auth = new InMemoryAuthAdapter();
    const userId = await signedInUserId(auth);

    const api = new InMemoryApiAdapter();
    api.mySubscription = sub("premium", null);
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutsList(userId, "mine", [], { used: 40, limit: null });
    storage.cacheWorkoutsList(userId, "assigned", [], null);
    storage.cacheWorkoutsList(userId, "default", [], null);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, unmount } = renderHook(() => useWorkoutTotalCapGate(), {
      wrapper: wrap({ ...makeAdapters(), api, auth, storage }, client),
    });

    await waitFor(() => expect(result.current.isResolved).toBe(true));
    expect(result.current.isOverLimit).toBe(false);

    unmount();
    client.clear();
  });

  it("onLocked pushes the resolution screen", async () => {
    const auth = new InMemoryAuthAdapter();
    await auth.signInWithEmail("u@example.com", "pw");
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, unmount } = renderHook(() => useWorkoutTotalCapGate(), {
      wrapper: wrap({ ...makeAdapters(), auth }, client),
    });

    act(() => result.current.onLocked());
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/workout-limit-locked");

    unmount();
    client.clear();
  });

  it("onGoToWorkouts pins the Train hub to the Workouts segment before navigating", async () => {
    const auth = new InMemoryAuthAdapter();
    await auth.signInWithEmail("u@example.com", "pw");
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, unmount } = renderHook(() => useWorkoutTotalCapGate(), {
      wrapper: wrap({ ...makeAdapters(), auth }, client),
    });

    act(() => result.current.onGoToWorkouts());
    expect(useTrainSegment.getState().segment).toBe("Workouts");
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/(tabs)/train");

    unmount();
    client.clear();
  });

  it("onUpgrade pushes the paywall with Premium pre-selected", async () => {
    const auth = new InMemoryAuthAdapter();
    await auth.signInWithEmail("u@example.com", "pw");
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, unmount } = renderHook(() => useWorkoutTotalCapGate(), {
      wrapper: wrap({ ...makeAdapters(), auth }, client),
    });

    act(() => result.current.onUpgrade());
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/(auth)/subscription-selection?tier=premium&cycle=monthly",
    );

    unmount();
    client.clear();
  });
});
