import { act, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type {
  MySubscription,
  SubscriptionTier,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import { fail, ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { useFuelSheets } from "@/state/fuel-sheets";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  computeMealprintVerdict,
  MEALPRINT_UPGRADE_TIER,
  useMealprintGate,
} from "@/ui/hooks/useMealprintGate";
import { useMealprintEntry } from "@/ui/hooks/useMealprintEntry";
import { useMealprintPreferences } from "@/ui/hooks/useMealprintPreferences";
import { useSetMealprintPreferences } from "@/ui/hooks/useSetMealprintPreferences";
import { useMealSuggest } from "@/ui/hooks/useMealSuggest";

/**
 * Same convention as every other heavy hook/container suite here: these mount a
 * React Query client and the adapter provider per case and run alongside ~470
 * other suites on a contended runner. The package-level `testTimeout` is 20 s —
 * see the note in `package.json`'s jest block. ⚠ Do NOT add a file-level
 * `jest.setTimeout(15_000)`: a file-level call WINS over the package default, so
 * it would CAP this suite below the floor that was set deliberately (the eight
 * sub-default overrides were removed for exactly that reason).
 */

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: (...a: unknown[]) => mockRouterPush(...a), back: jest.fn() },
  useRouter: () => ({ push: mockRouterPush, back: jest.fn() }),
}));

function subscription(
  tierName: SubscriptionTierName,
  over: Partial<MySubscription> = {},
): MySubscription {
  return {
    subscriptionId: "sub-1",
    tierName,
    paymentStatus: "active",
    billingCycle: "monthly",
    startsAt: "2026-07-01T00:00:00Z",
    expiresAt: null,
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
    ...over,
  } as MySubscription;
}

function makeAdapters(
  api: InMemoryApiAdapter,
  storage = new InMemoryStorageAdapter(),
): Adapters {
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: "user-1",
    email: "u@example.com",
    expiresAt: Date.now() + 60_000,
  };
  return {
    api,
    auth: {
      getSession: jest.fn(async () => ok(session)),
      onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
        cb(session);
        return () => {};
      }),
      getAccessToken: jest.fn(async () => "t"),
    } as unknown as Adapters["auth"],
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    netInfo: {} as Adapters["netInfo"],
  };
}

function harness<T>(
  api: InMemoryApiAdapter,
  useHook: () => T,
  storage = new InMemoryStorageAdapter(),
) {
  const seen: T[] = [];
  function Probe() {
    seen.push(useHook());
    return <Text>probe</Text>;
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AdapterProvider adapters={makeAdapters(api, storage)}>
        <Probe />
      </AdapterProvider>
    </QueryClientProvider>,
  );
  return { ...utils, storage, latest: () => seen[seen.length - 1] as T };
}

// ─── computeMealprintVerdict ────────────────────────────────────────────────

describe("computeMealprintVerdict", () => {
  it("denies an unresolved (null) subscription", () => {
    // Denied is the safe answer — the alternative is flashing the entry point as
    // unlocked and then 402-ing. Consumers tell this apart from a real denial via
    // `isResolved`.
    expect(computeMealprintVerdict(null)).toBe(false);
  });

  it("allows an active premium_plus", () => {
    expect(computeMealprintVerdict(subscription("premium_plus"))).toBe(true);
  });

  it("allows a TRIALING premium_plus", () => {
    expect(
      computeMealprintVerdict(
        subscription("premium_plus", { paymentStatus: "trialing" }),
      ),
    ).toBe(true);
  });

  it("allows a cancelled premium_plus whose expiry is still in the future", () => {
    // The user paid through that date and the server honours it, so a paywall
    // here would be wrong.
    expect(
      computeMealprintVerdict(
        subscription("premium_plus", {
          paymentStatus: "cancelled",
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      ),
    ).toBe(true);
  });

  it("denies a cancelled premium_plus once the expiry has passed", () => {
    expect(
      computeMealprintVerdict(
        subscription("premium_plus", {
          paymentStatus: "cancelled",
          expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
        }),
      ),
    ).toBe(false);
  });

  it("denies a cancelled premium_plus with an unparseable expiry", () => {
    expect(
      computeMealprintVerdict(
        subscription("premium_plus", {
          paymentStatus: "cancelled",
          expiresAt: "not-a-date",
        }),
      ),
    ).toBe(false);
  });

  it("denies a cancelled premium_plus with no expiry at all", () => {
    expect(
      computeMealprintVerdict(
        subscription("premium_plus", {
          paymentStatus: "cancelled",
          expiresAt: null,
        }),
      ),
    ).toBe(false);
  });

  it("denies free and premium", () => {
    expect(computeMealprintVerdict(subscription("free"))).toBe(false);
    expect(computeMealprintVerdict(subscription("premium"))).toBe(false);
  });

  it("denies the entry coach rung but allows the three paid coach tiers (spec-29 Phase 2 — now tracks Loadout exactly)", () => {
    // `20260805120000_coach_ladder_restructure.sql` made mealprint_access track
    // loadout_access exactly: the entry rung `individual_trainer` (Start Up
    // Coach) has neither suite feature; the three PAID coach tiers carry both.
    expect(computeMealprintVerdict(subscription("individual_trainer"))).toBe(
      false,
    );
    expect(computeMealprintVerdict(subscription("start_up_coach_plus"))).toBe(
      true,
    );
    expect(computeMealprintVerdict(subscription("coach"))).toBe(true);
    expect(computeMealprintVerdict(subscription("coach_pro"))).toBe(true);
  });

  it("denies an expired/past_due premium_plus", () => {
    expect(
      computeMealprintVerdict(
        subscription("premium_plus", { paymentStatus: "past_due" }),
      ),
    ).toBe(false);
  });
});

// ─── useMealprintGate ──────────────────────────────────────────────────────

describe("useMealprintGate", () => {
  beforeEach(() => jest.clearAllMocks());

  it("reports unresolved while /subscriptions/me is in flight", () => {
    const api = new InMemoryApiAdapter();
    jest.spyOn(api, "getMySubscription").mockReturnValue(new Promise(() => {}));
    const { latest } = harness(api, useMealprintGate);
    expect(latest().isResolved).toBe(false);
    expect(latest().allowed).toBe(false);
  });

  it("counts an ERRORED query as resolved, so consumers fall through to locked", async () => {
    // Otherwise opening the screen offline leaves the entry card muted with
    // unlocked copy and no explanation — the Loadout regression.
    const api = new InMemoryApiAdapter();
    jest
      .spyOn(api, "getMySubscription")
      .mockResolvedValue(
        fail({ kind: "api", code: "network", message: "offline" }),
      );
    const { latest } = harness(api, useMealprintGate);
    await waitFor(() => expect(latest().isResolved).toBe(true));
    expect(latest().allowed).toBe(false);
  });

  it("allows premium_plus once resolved", async () => {
    const api = new InMemoryApiAdapter();
    api.mySubscription = subscription("premium_plus");
    const { latest } = harness(api, useMealprintGate);
    await waitFor(() => expect(latest().isResolved).toBe(true));
    expect(latest().allowed).toBe(true);
  });

  it("reads the upgrade price from the CATALOG, and tolerates its absence", async () => {
    const api = new InMemoryApiAdapter();
    api.mySubscription = subscription("free");
    jest.spyOn(api, "getSubscriptionTiers").mockResolvedValue(ok([]));
    const { latest } = harness(api, useMealprintGate);
    await waitFor(() => expect(latest().isResolved).toBe(true));
    // ⚠ Null is the EXPECTED value before launch: premium_plus ships
    // is_active=false, so `listActive()` returns no row for it.
    expect(latest().upgradePriceMonthly).toBeNull();
  });

  it("takes the real price when the catalog carries premium_plus", async () => {
    const api = new InMemoryApiAdapter();
    api.mySubscription = subscription("free");
    jest.spyOn(api, "getSubscriptionTiers").mockResolvedValue(
      ok([
        {
          tierName: "premium_plus",
          displayName: "Premium+",
          description: null,
          priceMonthly: 29.99,
          priceYearly: 299.99,
        } as unknown as SubscriptionTier,
      ]),
    );
    const { latest } = harness(api, useMealprintGate);
    await waitFor(() => expect(latest().upgradePriceMonthly).toBe(29.99));
  });

  it("upsells PREMIUM_PLUS, carrying the user's billing cycle", async () => {
    const api = new InMemoryApiAdapter();
    api.mySubscription = subscription("free", { billingCycle: "yearly" });
    const { latest } = harness(api, useMealprintGate);
    await waitFor(() => expect(latest().isResolved).toBe(true));
    act(() => latest().onUpgrade());
    expect(mockRouterPush).toHaveBeenCalledWith(
      `/(auth)/subscription-selection?tier=${MEALPRINT_UPGRADE_TIER}&cycle=yearly`,
    );
  });

  it("⚠ upsells premium_plus to a COACH too, not the cheapest trainer tier", async () => {
    // The backend had to add `PREMIUM_PLUS_ONLY_FEATURES` because
    // `pickUpgradeTier` returned `individual_trainer` for a personal_trainer
    // before looking at the feature — selling a £14.99 tier that still locks them
    // out. The client verdict must not reintroduce that.
    const api = new InMemoryApiAdapter();
    api.mySubscription = subscription("individual_trainer", {
      role: "personal_trainer",
      isTrainerTier: true,
    });
    const { latest } = harness(api, useMealprintGate);
    await waitFor(() => expect(latest().isResolved).toBe(true));
    expect(latest().allowed).toBe(false);
    act(() => latest().onUpgrade());
    expect(mockRouterPush).toHaveBeenCalledWith(
      expect.stringContaining("tier=premium_plus"),
    );
  });

  it("refetch() CANCELS both queries before reissuing", async () => {
    // ⚠ The trap: TanStack gates `cancelRefetch` on `state.data !== undefined`, so
    // on a first fetch that never settled a bare `refetch()` hands back the same
    // hung promise and issues nothing. The explicit cancel is what unsticks it —
    // and it has to cover BOTH halves, because the gate is only as unstuck as its
    // slowest query.
    const api = new InMemoryApiAdapter();
    const subSpy = jest
      .spyOn(api, "getMySubscription")
      .mockReturnValue(new Promise(() => {}));
    const tiersSpy = jest
      .spyOn(api, "getSubscriptionTiers")
      .mockReturnValue(new Promise(() => {}));

    const { latest } = harness(api, useMealprintGate);
    await waitFor(() => expect(subSpy).toHaveBeenCalledTimes(1));
    const tiersBefore = tiersSpy.mock.calls.length;

    await act(async () => {
      latest().refetch();
      await Promise.resolve();
    });

    await waitFor(() => expect(subSpy.mock.calls.length).toBeGreaterThan(1));
    expect(tiersSpy.mock.calls.length).toBeGreaterThan(tiersBefore);
  });
});

// ─── useMealprintPreferences ───────────────────────────────────────────────

describe("useMealprintPreferences", () => {
  it("issues NO request when disabled (the default), but still reads the cache", async () => {
    // ⚠ The launch fan-out rule: the Fuel entry card lives on a tab, so an eager
    // default would add a request to every cold launch.
    const api = new InMemoryApiAdapter();
    const spy = jest.spyOn(api, "getMealprintPreferences");
    const storage = new InMemoryStorageAdapter();
    storage.cacheMealprintPreferences("user-1", {
      ...api.mealprintPreferences,
      mealsPerDay: 5,
      isDefault: false,
    });

    const { latest } = harness(api, () => useMealprintPreferences(), storage);
    await waitFor(() => expect(latest().data?.mealsPerDay).toBe(5));
    expect(spy).not.toHaveBeenCalled();
  });

  it("fetches and caches when enabled", async () => {
    const api = new InMemoryApiAdapter();
    api.mealprintPreferences = {
      ...api.mealprintPreferences,
      mealsPerDay: 6,
      effortLevel: "high_maintenance",
      isDefault: false,
    };
    const { latest, storage } = harness(api, () =>
      useMealprintPreferences(true),
    );
    await waitFor(() => expect(latest().data?.mealsPerDay).toBe(6));
    expect(storage.getCachedMealprintPreferences("user-1")?.effortLevel).toBe(
      "high_maintenance",
    );
  });

  it("surfaces the 404-free default row with isDefault true", async () => {
    const api = new InMemoryApiAdapter();
    const { latest } = harness(api, () => useMealprintPreferences(true));
    await waitFor(() => expect(latest().data).not.toBeNull());
    expect(latest().data?.isDefault).toBe(true);
    expect(latest().data?.mealsPerDay).toBe(4);
  });
});

// ─── useSetMealprintPreferences ────────────────────────────────────────────

describe("useSetMealprintPreferences", () => {
  it("writes the optimistic row and resolves with it", async () => {
    const api = new InMemoryApiAdapter();
    const { latest, storage } = harness(api, useSetMealprintPreferences);
    let saved: Awaited<ReturnType<typeof latest>["mutate"]> extends never
      ? never
      : unknown;
    await act(async () => {
      saved = await latest().mutate({
        dietaryPatterns: ["vegetarian"],
        avoidAllergens: ["milk"],
        avoidFoods: [],
        likedFoods: [],
        mealsPerDay: 5,
        effortLevel: "quick",
        locale: "en-GB",
      });
    });
    expect(saved).toMatchObject({ mealsPerDay: 5, isDefault: false });
    expect(storage.getCachedMealprintPreferences("user-1")?.mealsPerDay).toBe(
      5,
    );
  });
});

// ─── useMealSuggest ────────────────────────────────────────────────────────

describe("useMealSuggest", () => {
  const input = { shape: "either" as const, date: "2026-08-03" };

  it("starts idle and moves to ready with the result", async () => {
    const api = new InMemoryApiAdapter();
    api.mealSuggestResult = {
      suggestions: [
        {
          name: "Yoghurt & berries",
          reason: "protein",
          items: [],
          kcal: 190,
          proteinG: 25,
          carbsG: 20,
          fatG: 1,
          containsUnverified: false,
          partialEnforcementOnly: false,
        },
      ],
      emptyReason: null,
      remaining: { kcal: 620, proteinG: 42, carbsG: 60, fatG: 20 },
      containsUnverified: false,
      partialEnforcementOnly: false,
      labelCheckRequired: true,
    };
    const { latest } = harness(api, useMealSuggest);
    expect(latest().stage).toBe("idle");
    await act(async () => {
      await latest().run(input);
    });
    expect(latest().stage).toBe("ready");
    expect(latest().result?.suggestions).toHaveLength(1);
    expect(latest().result?.labelCheckRequired).toBe(true);
  });

  it("treats an EMPTY no_candidates result as a success, not a failure", async () => {
    // ⚠ The expected staging state until the Open Food Facts re-seed lands: the
    // tag columns are NULL on every seeded row and `avoidanceFilter` treats NULL
    // as unknown-and-unsafe, so any allergen chip empties the pool. Surfacing it
    // as an error would render a generic failure for a state the sheet can
    // explain precisely — and it consumed no daily ceiling.
    const api = new InMemoryApiAdapter();
    const { latest } = harness(api, useMealSuggest);
    await act(async () => {
      await latest().run(input);
    });
    expect(latest().stage).toBe("ready");
    expect(latest().failure).toBeNull();
    expect(latest().result?.emptyReason).toBe("no_candidates");
  });

  it("classifies 429 as NOT retryable and names the reset", async () => {
    // "Try again" is wrong advice for the rest of the day.
    const api = new InMemoryApiAdapter();
    api.nextMealSuggestError = { status: 429, message: "ai_daily_limit" };
    const { latest } = harness(api, useMealSuggest);
    await act(async () => {
      await latest().run(input);
    });
    expect(latest().stage).toBe("error");
    expect(latest().failure?.retryable).toBe(false);
    expect(latest().failure?.entitlementDenied).toBe(false);
    expect(latest().failure?.message).toMatch(/reset tomorrow/i);
  });

  it("classifies 402 as an entitlement denial", async () => {
    const api = new InMemoryApiAdapter();
    api.nextMealSuggestError = { status: 402, message: "entitlement" };
    const { latest } = harness(api, useMealSuggest);
    await act(async () => {
      await latest().run(input);
    });
    expect(latest().failure?.entitlementDenied).toBe(true);
    expect(latest().failure?.retryable).toBe(false);
  });

  it("classifies 422 as retryable", async () => {
    const api = new InMemoryApiAdapter();
    api.nextMealSuggestError = { status: 422, message: "ai_unreadable" };
    const { latest } = harness(api, useMealSuggest);
    await act(async () => {
      await latest().run(input);
    });
    expect(latest().failure?.retryable).toBe(true);
  });

  it("classifies 503 as retryable and does NOT suggest rephrasing", async () => {
    // A provider outage is not a prompt problem, and that mis-copy already exists
    // twice in this codebase — do not add a third.
    const api = new InMemoryApiAdapter();
    api.nextMealSuggestError = { status: 503, message: "ai_unavailable" };
    const { latest } = harness(api, useMealSuggest);
    await act(async () => {
      await latest().run(input);
    });
    expect(latest().failure?.retryable).toBe(true);
    expect(latest().failure?.message).not.toMatch(/rephras/i);
  });

  it("falls back to a transport message for a network failure", async () => {
    const api = new InMemoryApiAdapter();
    jest
      .spyOn(api, "suggestMeals")
      .mockResolvedValue(
        fail({ kind: "api", code: "network", message: "offline" }),
      );
    const { latest } = harness(api, useMealSuggest);
    await act(async () => {
      await latest().run(input);
    });
    expect(latest().failure?.message).toMatch(/connection/i);
    expect(latest().failure?.retryable).toBe(true);
  });

  it("REJECTS a concurrent run rather than billing two inferences", async () => {
    // Every call that reaches the provider writes a usage row, so an impatient
    // double-tap must not spend two of twenty.
    const api = new InMemoryApiAdapter();
    let release: (() => void) | null = null;
    // The spy REPLACES the fake's own bookkeeping, so assert on the spy's call
    // count rather than `suggestMealsCalls` (which this implementation never
    // touches).
    const spy = jest.spyOn(api, "suggestMeals").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve(ok({ ...api.mealSuggestResult, emptyReason: null }));
        }),
    );
    const { latest } = harness(api, useMealSuggest);

    await act(async () => {
      void latest().run(input);
      await Promise.resolve();
    });
    await act(async () => {
      void latest().run(input);
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
      await Promise.resolve();
    });
  });

  it("retry() re-sends the same shape and steer", async () => {
    const api = new InMemoryApiAdapter();
    const { latest } = harness(api, useMealSuggest);
    await act(async () => {
      await latest().run({
        shape: "snack",
        date: "2026-08-03",
        steer: "sweet",
      });
    });
    await act(async () => {
      await latest().retry();
    });
    expect(api.suggestMealsCalls).toHaveLength(2);
    expect(api.suggestMealsCalls[1]).toEqual({
      shape: "snack",
      date: "2026-08-03",
      steer: "sweet",
    });
  });

  it("retry() is a no-op before any run", async () => {
    const api = new InMemoryApiAdapter();
    const { latest } = harness(api, useMealSuggest);
    await act(async () => {
      await latest().retry();
    });
    expect(api.suggestMealsCalls).toHaveLength(0);
    expect(latest().stage).toBe("idle");
  });

  it("reset() clears the stage, result and remembered input", async () => {
    const api = new InMemoryApiAdapter();
    const { latest } = harness(api, useMealSuggest);
    await act(async () => {
      await latest().run(input);
    });
    act(() => latest().reset());
    expect(latest().stage).toBe("idle");
    expect(latest().result).toBeNull();
    expect(latest().failure).toBeNull();
    await act(async () => {
      await latest().retry();
    });
    // A retry after a reset must not resurrect the previous input.
    expect(api.suggestMealsCalls).toHaveLength(1);
  });
});

// ─── useMealprintEntry ─────────────────────────────────────────────────────

describe("useMealprintEntry", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useFuelSheets.setState({ sheet: null });
  });

  it("is `pending` while the subscription is in flight, and does NOT show a padlock state", () => {
    // ⚠ The state this exists for: `computeMealprintVerdict` denies a null
    // subscription by design, so during the cold-start round trip a paying
    // Premium+ user is indistinguishable from a free one — and Fuel is a TAB, so
    // rendering `locked` here sells the feature to its owner on every launch.
    const api = new InMemoryApiAdapter();
    jest.spyOn(api, "getMySubscription").mockReturnValue(new Promise(() => {}));
    const { latest } = harness(api, useMealprintEntry);
    expect(latest().state).toBe("pending");
  });

  it("becomes `stalled` after the resolve timeout, NOT `locked`", async () => {
    // Showing the paywall because the network hung is exactly the mistake
    // `pending` exists to prevent, so the timeout must not fall through to it.
    jest.useFakeTimers();
    try {
      const api = new InMemoryApiAdapter();
      jest
        .spyOn(api, "getMySubscription")
        .mockReturnValue(new Promise(() => {}));
      const { latest } = harness(api, useMealprintEntry);
      expect(latest().state).toBe("pending");
      await act(async () => {
        jest.advanceTimersByTime(8_001);
      });
      expect(latest().state).toBe("stalled");
    } finally {
      jest.useRealTimers();
    }
  });

  it("onRetry re-arms the clock as well as reissuing — so it is not decorative", async () => {
    // ⚠ Clearing `stalled` alone left the user back on an unbounded spinner with
    // no way to reach the retry again, because the timer effect keys on
    // `isResolved`, which had not changed.
    jest.useFakeTimers();
    try {
      const api = new InMemoryApiAdapter();
      const spy = jest
        .spyOn(api, "getMySubscription")
        .mockReturnValue(new Promise(() => {}));
      const { latest } = harness(api, useMealprintEntry);
      await act(async () => {
        jest.advanceTimersByTime(8_001);
      });
      expect(latest().state).toBe("stalled");

      await act(async () => {
        latest().onRetry();
        await Promise.resolve();
      });
      expect(latest().state).toBe("pending");
      expect(spy.mock.calls.length).toBeGreaterThan(1);

      // …and the clock is re-armed, so a second hang is recoverable too.
      await act(async () => {
        jest.advanceTimersByTime(8_001);
      });
      expect(latest().state).toBe("stalled");
    } finally {
      jest.useRealTimers();
    }
  });

  it("is `locked` for a non-entitled tier once resolved", async () => {
    const api = new InMemoryApiAdapter();
    api.mySubscription = subscription("premium");
    const { latest } = harness(api, useMealprintEntry);
    await waitFor(() => expect(latest().state).toBe("locked"));
  });

  it("is `unlocked` for premium_plus", async () => {
    const api = new InMemoryApiAdapter();
    api.mySubscription = subscription("premium_plus");
    const { latest } = harness(api, useMealprintEntry);
    await waitFor(() => expect(latest().state).toBe("unlocked"));
  });

  it("needsSetup when the cache is empty (fresh install) and opens the WIZARD", async () => {
    const api = new InMemoryApiAdapter();
    api.mySubscription = subscription("premium_plus");
    const { latest } = harness(api, useMealprintEntry);
    await waitFor(() => expect(latest().state).toBe("unlocked"));
    expect(latest().needsSetup).toBe(true);
    act(() => latest().onPress());
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/(app)/fuel/preferences?mode=wizard",
    );
    expect(useFuelSheets.getState().sheet).toBeNull();
  });

  it("needsSetup when the cached row is the server DEFAULT", async () => {
    const api = new InMemoryApiAdapter();
    api.mySubscription = subscription("premium_plus");
    const storage = new InMemoryStorageAdapter();
    storage.cacheMealprintPreferences("user-1", {
      ...api.mealprintPreferences,
      isDefault: true,
    });
    const { latest } = harness(api, useMealprintEntry, storage);
    await waitFor(() => expect(latest().state).toBe("unlocked"));
    expect(latest().needsSetup).toBe(true);
  });

  it("opens the SUGGEST SHEET once preferences have been saved", async () => {
    const api = new InMemoryApiAdapter();
    api.mySubscription = subscription("premium_plus");
    const storage = new InMemoryStorageAdapter();
    storage.cacheMealprintPreferences("user-1", {
      ...api.mealprintPreferences,
      dietaryPatterns: ["vegan"],
      isDefault: false,
    });
    const { latest } = harness(api, useMealprintEntry, storage);
    await waitFor(() => expect(latest().needsSetup).toBe(false));
    act(() => latest().onPress());
    expect(useFuelSheets.getState().sheet).toBe("mealprintSuggest");
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("onPlanMyDay opens the plan config sheet", async () => {
    const api = new InMemoryApiAdapter();
    api.mySubscription = subscription("premium_plus");
    const { latest } = harness(api, useMealprintEntry);
    await waitFor(() => expect(latest().state).toBe("unlocked"));
    act(() => latest().onPlanMyDay());
    expect(useFuelSheets.getState().sheet).toBe("mealprintPlan");
  });

  it("planProgress is null with no active plan, and non-null with one — spec-26 Phase 2", async () => {
    const api = new InMemoryApiAdapter();
    api.mySubscription = subscription("premium_plus");
    const { latest } = harness(api, () => useMealprintEntry(null));
    await waitFor(() => expect(latest().state).toBe("unlocked"));
    expect(latest().planProgress).toBeNull();

    const plan = {
      id: "plan-1",
      userId: "user-1",
      status: "active" as const,
      planDate: "2026-08-05",
      groupId: null,
      mealsPerDay: 2,
      effortLevel: "balanced" as const,
      targetKcal: 2000,
      targetProteinG: 150,
      targetCarbsG: 200,
      targetFatG: 60,
      source: "ai",
      createdByUserId: null,
      createdAt: null,
      acceptedAt: null,
      meals: [
        {
          id: "meal-1",
          sortOrder: 0,
          label: "Breakfast bowl",
          logSlot: "breakfast" as const,
          recipeId: null,
          mealId: null,
          items: null,
          kcal: 400,
          proteinG: 30,
          carbsG: 40,
          fatG: 10,
          aiReason: null,
          state: "logged" as const,
          loggedEntryId: "entry-1",
        },
        {
          id: "meal-2",
          sortOrder: 1,
          label: "Chicken & rice",
          logSlot: "dinner" as const,
          recipeId: null,
          mealId: null,
          items: null,
          kcal: 600,
          proteinG: 45,
          carbsG: 60,
          fatG: 15,
          aiReason: null,
          state: "planned" as const,
          loggedEntryId: null,
        },
      ],
    };
    const { latest: latestWithPlan } = harness(api, () =>
      useMealprintEntry(plan),
    );
    await waitFor(() => expect(latestWithPlan().planProgress).not.toBeNull());
    expect(latestWithPlan().planProgress).toEqual({
      loggedCount: 1,
      totalCount: 2,
      nextMealLabel: "Chicken & rice",
      nextMealKcal: 600,
    });

    // An active plan takes priority over the suggest sheet on press.
    act(() => latestWithPlan().onPress());
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/fuel/plan-today");
  });
});

describe("useSetMealprintPreferences — edge paths", () => {
  const INPUT = {
    dietaryPatterns: [] as never[],
    avoidAllergens: [] as never[],
    avoidFoods: [],
    likedFoods: [],
    mealsPerDay: 4 as const,
    effortLevel: "balanced" as const,
    locale: "en-GB" as const,
  };

  it("answers null and writes NOTHING when there is no session", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const seen: ReturnType<typeof useSetMealprintPreferences>[] = [];
    function Probe() {
      seen.push(useSetMealprintPreferences());
      return <Text>probe</Text>;
    }
    const adapters = makeAdapters(api, storage);
    (adapters.auth as unknown as { getSession: jest.Mock }).getSession =
      jest.fn(async () => ok(null));
    (
      adapters.auth as unknown as { onAuthStateChange: jest.Mock }
    ).onAuthStateChange = jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(null);
      return () => {};
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AdapterProvider adapters={adapters}>
          <Probe />
        </AdapterProvider>
      </QueryClientProvider>,
    );

    let result: unknown = "unset";
    await act(async () => {
      result = await seen[seen.length - 1]!.mutate(INPUT);
    });
    expect(result).toBeNull();
    expect(storage.getPendingMutations()).toHaveLength(0);
    expect(storage.getCachedMealprintPreferences("user-1")).toBeNull();
  });

  it("still resolves with the optimistic row when the drain throws", async () => {
    // ⚠ The mutation is already durable in the queue and the worker retries, so a
    // failed flush must not surface as a failed save — the drain is a nudge, not the
    // commit.
    const previousFetch = (globalThis as Record<string, unknown>).fetch;
    (globalThis as Record<string, unknown>).fetch = jest.fn(async () => {
      throw new Error("socket hung up");
    });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const api = new InMemoryApiAdapter();
      const { latest, storage } = harness(api, useSetMealprintPreferences);
      let result: unknown = "unset";
      await act(async () => {
        result = await latest().mutate({ ...INPUT, mealsPerDay: 5 });
      });
      expect(result).toMatchObject({ mealsPerDay: 5 });
      expect(storage.getCachedMealprintPreferences("user-1")?.mealsPerDay).toBe(
        5,
      );
    } finally {
      errorSpy.mockRestore();
      (globalThis as Record<string, unknown>).fetch = previousFetch;
    }
  });
});

describe("useMealSuggest — reset while a request is in flight (Inspector 🟠)", () => {
  const input = { shape: "either" as const, date: "2026-08-03" };

  it("⚠ stays `generating` after a reset, so the sheet cannot offer a dead Generate button", async () => {
    // `reset()` deliberately does not clear `inFlightRef` (a second run would bill
    // a second inference). Going `idle` therefore rendered a setup body with a LIVE
    // Generate button that `run` silently no-opped for up to 30 s, after which the
    // original request landed with results for inputs the reset had already wiped.
    const api = new InMemoryApiAdapter();
    let release: (() => void) | null = null;
    const spy = jest.spyOn(api, "suggestMeals").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve(ok({ ...api.mealSuggestResult, emptyReason: null }));
        }),
    );
    const { latest } = harness(api, useMealSuggest);

    await act(async () => {
      void latest().run(input);
      await Promise.resolve();
    });
    expect(latest().stage).toBe("generating");

    act(() => latest().reset());
    expect(latest().stage).toBe("generating");
    expect(latest().result).toBeNull();

    // A second run is still refused — the billing guard is intact.
    await act(async () => {
      void latest().run(input);
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(latest().stage).toBe("ready"));
  });

  it("⚠ KEEPS the in-flight request's input, so its result stays retryable", async () => {
    // The complement of the case above, and the one whose ABSENCE let the bug ship:
    // `reset()` nulled `lastInputRef` unconditionally, so the result that then
    // arrived had nothing to retry from — "Show me something else" and the error
    // stage's "Try again" both hit `if (!last) return` and did nothing. On the error
    // stage that is the sheet's ONLY button, so the user's sole escape was swiping
    // it down. The fix is a one-line ref guard that a future "simplify reset()"
    // would silently undo, which is exactly why this assertion has to exist.
    const api = new InMemoryApiAdapter();
    let release: (() => void) | null = null;
    const spy = jest.spyOn(api, "suggestMeals").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve(ok({ ...api.mealSuggestResult, emptyReason: null }));
        }),
    );
    const { latest } = harness(api, useMealSuggest);
    const original = {
      shape: "snack" as const,
      date: "2026-08-03",
      steer: "sweet",
    };

    await act(async () => {
      void latest().run(original);
      await Promise.resolve();
    });
    // The sheet is closed and reopened mid-generation.
    act(() => latest().reset());
    await act(async () => {
      release?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(latest().stage).toBe("ready"));

    await act(async () => {
      void latest().retry();
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]?.[0]).toEqual(original);
  });

  it("goes `idle` on a reset when nothing is in flight", async () => {
    const api = new InMemoryApiAdapter();
    const { latest } = harness(api, useMealSuggest);
    await act(async () => {
      await latest().run(input);
    });
    expect(latest().stage).toBe("ready");
    act(() => latest().reset());
    expect(latest().stage).toBe("idle");
  });
});
