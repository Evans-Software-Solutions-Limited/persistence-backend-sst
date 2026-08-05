import type {
  MySubscription,
  SubscriptionStatus,
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
import { computeLoadoutVerdict, useLoadoutGate } from "../useLoadoutGate";

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

// `useLoadoutGate.ts` imports the expo-router singleton for its upgrade route.
// Unmocked, requiring it here pulls in React Native's dev-server plumbing and the
// suite fails to load before a single assertion runs.
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: jest.fn(), back: jest.fn() },
}));

/**
 * The verdict mirrors migration `20260725194527_premium_plus_tier` because
 * `/subscriptions/me` does not (yet) return `loadout_access`. These tests are
 * therefore the only thing holding the client and the catalog in agreement —
 * see the hook's docstring for why that is acceptable and what retires it.
 */

function sub(
  tierName: SubscriptionTierName,
  paymentStatus: SubscriptionStatus = "active",
  expiresAt: string | null = null,
): MySubscription {
  return {
    subscriptionId: "sub-1",
    tierName,
    paymentStatus,
    billingCycle: "monthly",
    startsAt: "2026-07-01T00:00:00Z",
    expiresAt,
    cancelledAt: null,
    trialEndsAt: null,
    externalSubscriptionId: null,
    tierDisplayName: tierName,
    tierDescription: null,
    workoutLimit: null,
    aiAccess: true,
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

describe("computeLoadoutVerdict", () => {
  it("denies when the subscription cache hasn't resolved", () => {
    // Denied rather than allowed: the alternative flashes the entry point as
    // unlocked and then 402s on the first request.
    expect(computeLoadoutVerdict(null)).toBe(false);
  });

  it.each<[SubscriptionTierName, boolean]>([
    ["free", false],
    ["premium", false],
    ["premium_plus", true],
    // ⚠ Spec-29 Phase 2 (2026-08-05): `individual_trainer` (Start Up Coach) is
    // the entry coach rung and deliberately has NO suite — that split is the
    // whole point of the coach-ladder restructure (AC 1.3). The three PAID
    // coach tiers carry `loadout_access` instead.
    ["individual_trainer", false],
    ["start_up_coach_plus", true],
    ["coach", true],
    ["coach_pro", true],
  ])("mirrors the catalog for %s → %s", (tier, expected) => {
    expect(computeLoadoutVerdict(sub(tier))).toBe(expected);
  });

  it("allows a trialing Premium+ subscription", () => {
    expect(computeLoadoutVerdict(sub("premium_plus", "trialing"))).toBe(true);
  });

  it.each<SubscriptionStatus>([
    "past_due",
    "incomplete",
    "incomplete_expired",
    "unpaid",
  ])("denies an entitled tier on a %s subscription", (status) => {
    expect(computeLoadoutVerdict(sub("premium_plus", status))).toBe(false);
  });

  it("ALLOWS cancelled-but-still-paid-through — the user paid for this window", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(
      computeLoadoutVerdict(sub("premium_plus", "cancelled", future)),
    ).toBe(true);
  });

  it("denies cancelled once expiresAt has passed", () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(computeLoadoutVerdict(sub("premium_plus", "cancelled", past))).toBe(
      false,
    );
  });

  it("denies cancelled with a null or unparseable expiresAt", () => {
    expect(computeLoadoutVerdict(sub("premium_plus", "cancelled", null))).toBe(
      false,
    );
    expect(
      computeLoadoutVerdict(sub("premium_plus", "cancelled", "not-a-date")),
    ).toBe(false);
  });

  it("still denies a NON-entitled tier that is cancelled-but-paid-through", () => {
    // The status window doesn't grant access the tier never had — a mutation
    // that dropped the tier check would otherwise pass every other test here.
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(computeLoadoutVerdict(sub("premium", "cancelled", future))).toBe(
      false,
    );
  });
});

/**
 * ⚠ The seam that hid a no-op through two review rounds.
 *
 * `GymsSegmentContainer`'s test mocks this whole hook, so it can only prove the
 * container CALLS `refetch` — never that `refetch` does anything. And the
 * something it has to do is subtle: TanStack gates `cancelRefetch` on
 * `state.data !== undefined`, so on a cold-start fetch that never settled — the
 * only state a "Try again" is ever reachable from — a bare `refetch()` hands back
 * the same hung promise and issues nothing. This exercises the real hook against a
 * genuinely never-settling `getMySubscription`.
 */
describe("useLoadoutGate.refetch against a HUNG first fetch", () => {
  it("abandons the dead request and issues a new one", async () => {
    const api = new InMemoryApiAdapter();
    const auth = new InMemoryAuthAdapter();
    await auth.signInWithEmail("u@example.com", "pw");

    let calls = 0;
    // Held so the fixture can settle them on the way out. A promise nothing ever
    // resolves is an open handle, and jest waits on it rather than exiting.
    const hung: ((v: unknown) => void)[] = [];
    jest.spyOn(api, "getMySubscription").mockImplementation(() => {
      calls += 1;
      // Never settles on its own — a half-open socket, which is why there is no
      // timeout to lean on and no rejection for `isResolved` to see.
      return new Promise((resolve) => hung.push(resolve)) as never;
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, unmount } = renderHook(() => useLoadoutGate(), {
      wrapper: wrap({ ...makeAdapters(), api, auth }, client),
    });

    try {
      await waitFor(() => expect(calls).toBe(1));
      expect(result.current.isResolved).toBe(false);

      act(() => result.current.refetch());

      // ⚠ 2, not 1. A bare `refetch()` leaves this at 1 forever, which is exactly
      // what shipped twice: the retry button looked wired and reissued nothing.
      await waitFor(() => expect(calls).toBe(2));
    } finally {
      unmount();
      client.clear();
      hung.forEach((resolve) => resolve(null));
    }
  });

  /**
   * ⚠ The tiers half is a SEPARATE query with the same trap, and symmetry with a
   * tested sibling is not a test. Reverting its two lines to a bare
   * `refetchTiers()` left the whole suite green right up until this case existed.
   */
  it("reissues the CATALOG too when that is the half that hung", async () => {
    const api = new InMemoryApiAdapter();
    const auth = new InMemoryAuthAdapter();
    await auth.signInWithEmail("u@example.com", "pw");

    let calls = 0;
    const hung: ((v: unknown) => void)[] = [];
    jest.spyOn(api, "getSubscriptionTiers").mockImplementation(() => {
      calls += 1;
      return new Promise((resolve) => hung.push(resolve)) as never;
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, unmount } = renderHook(() => useLoadoutGate(), {
      wrapper: wrap({ ...makeAdapters(), api, auth }, client),
    });

    try {
      await waitFor(() => expect(calls).toBe(1));
      act(() => result.current.refetch());
      // A hung catalog would otherwise leave the upsell sheet with no price
      // until the tree remounts.
      await waitFor(() => expect(calls).toBe(2));
    } finally {
      unmount();
      client.clear();
      hung.forEach((resolve) => resolve(null));
    }
  });
});
