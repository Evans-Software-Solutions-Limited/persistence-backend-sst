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
import { useLoadoutFlow } from "@/state/loadout-flow";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useLoadoutGate } from "@/ui/hooks/useLoadoutGate";
import { useSavedGyms } from "@/ui/hooks/useSavedGyms";
import { useWorkoutVariations } from "@/ui/hooks/useWorkoutVariations";

/**
 * Same convention as every other heavy container suite here (ProfileContainer,
 * ExerciseListContainer, SubscriptionSelectionContainer…): these mount the real
 * Tamagui provider, a React Query client and gorhom sheet machinery per case,
 * and run alongside 459 other suites on a contended CI runner, where jest's 5 s
 * default is the wrong budget for this shape. See
 * `LoadoutFlowContainer.test.tsx` for the measurement that prompted it.
 */
jest.setTimeout(20_000);

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: (...a: unknown[]) => mockRouterPush(...a), back: jest.fn() },
  useRouter: () => ({ push: mockRouterPush, back: jest.fn() }),
}));

function subscription(tierName: SubscriptionTierName): MySubscription {
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
  };
}

function makeAdapters(api: InMemoryApiAdapter): Adapters {
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
    storage: new InMemoryStorageAdapter(),
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    netInfo: {} as Adapters["netInfo"],
  };
}

/** Renders a hook and exposes its latest value. */
function harness<T>(api: InMemoryApiAdapter, useHook: () => T) {
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
      <AdapterProvider adapters={makeAdapters(api)}>
        <Probe />
      </AdapterProvider>
    </QueryClientProvider>,
  );
  return { ...utils, latest: () => seen[seen.length - 1] as T };
}

describe("useLoadoutGate", () => {
  beforeEach(() => jest.clearAllMocks());

  it("denies, and reports unresolved, before the subscription cache lands", () => {
    const api = new InMemoryApiAdapter();
    jest.spyOn(api, "getMySubscription").mockReturnValue(new Promise(() => {}));
    const { latest } = harness(api, useLoadoutGate);
    expect(latest().allowed).toBe(false);
    expect(latest().isResolved).toBe(false);
  });

  it("allows Premium+ once the subscription resolves", async () => {
    const api = new InMemoryApiAdapter();
    api.mySubscription = subscription("premium_plus");
    const { latest } = harness(api, useLoadoutGate);
    await waitFor(() => expect(latest().isResolved).toBe(true));
    expect(latest().allowed).toBe(true);
  });

  it("takes the upgrade price from the CATALOG", async () => {
    const api = new InMemoryApiAdapter();
    api.mySubscription = subscription("free");
    const tier = {
      tierName: "premium_plus",
      displayName: "Premium+",
      description: null,
      priceMonthly: 29.99,
      priceYearly: 299.99,
    } as unknown as SubscriptionTier;
    jest.spyOn(api, "getSubscriptionTiers").mockResolvedValue(ok([tier]));
    const { latest } = harness(api, useLoadoutGate);
    await waitFor(() => expect(latest().upgradePriceMonthly).toBe(29.99));
  });

  it("reports a NULL price when the tier is absent from the catalog", async () => {
    // The expected pre-launch state: `premium_plus` is seeded `is_active = false`
    // and `listActive()` only returns active rows.
    const api = new InMemoryApiAdapter();
    api.mySubscription = subscription("free");
    jest.spyOn(api, "getSubscriptionTiers").mockResolvedValue(ok([]));
    const { latest } = harness(api, useLoadoutGate);
    await waitFor(() => expect(latest().isResolved).toBe(true));
    expect(latest().upgradePriceMonthly).toBeNull();
  });

  it("counts an ERRORED subscription query as resolved, not as pending", async () => {
    const api = new InMemoryApiAdapter();
    jest
      .spyOn(api, "getMySubscription")
      .mockResolvedValue(fail({ kind: "api", code: "network", message: "" }));
    const { latest } = harness(api, useLoadoutGate);

    // ⚠ Otherwise `isResolved` cannot tell "in flight" from "failed", and the
    // entry card sits disabled with unlocked copy and no explanation — doing
    // nothing on tap — for anyone who opens a workout offline.
    await waitFor(() => expect(latest().isResolved).toBe(true));
    expect(latest().allowed).toBe(false);
  });

  it("routes to the paywall with Premium+ pre-selected", async () => {
    const api = new InMemoryApiAdapter();
    api.mySubscription = subscription("free");
    const { latest } = harness(api, useLoadoutGate);
    await waitFor(() => expect(latest().isResolved).toBe(true));
    act(() => latest().onUpgrade());
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/(auth)/subscription-selection?tier=premium_plus&cycle=monthly",
    );
  });
});

describe("useSavedGyms", () => {
  beforeEach(() => jest.clearAllMocks());

  it("does not fetch while disabled", async () => {
    const api = new InMemoryApiAdapter();
    const spy = jest.spyOn(api, "getSavedGyms");
    const { latest } = harness(api, () => useSavedGyms(false));
    await waitFor(() => expect(latest().isLoading).toBe(false));
    expect(spy).not.toHaveBeenCalled();
  });

  it("REFETCHES each time it is re-enabled, not once per mount", async () => {
    const api = new InMemoryApiAdapter();
    const spy = jest.spyOn(api, "getSavedGyms");

    function Probe({ enabled }: { readonly enabled: boolean }) {
      useSavedGyms(enabled);
      return <Text>probe</Text>;
    }
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrap = (enabled: boolean) => (
      <QueryClientProvider client={queryClient}>
        <AdapterProvider adapters={makeAdapters(api)}>
          <Probe enabled={enabled} />
        </AdapterProvider>
      </QueryClientProvider>
    );

    const { rerender } = render(wrap(true));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    // ⚠ `LoadoutFlowContainer` is mounted at the layout root for the whole
    // session, so a per-MOUNT latch would fetch once, the first time the flow
    // ever opened, and never again — freezing the list that also feeds the swap
    // sheet's containment context.
    rerender(wrap(false));
    rerender(wrap(true));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it("loads once and reports the list", async () => {
    const api = new InMemoryApiAdapter();
    api.savedGyms = [
      {
        id: "gym-1",
        name: "Hotel gym",
        equipmentTypeIds: ["eq-1"],
        createdAt: null,
        updatedAt: null,
      },
    ];
    const { latest } = harness(api, () => useSavedGyms(true));
    await waitFor(() => expect(latest().gyms).toHaveLength(1));
    expect(latest().isLoading).toBe(false);
  });

  it("surfaces a read failure without wiping the list state", async () => {
    const api = new InMemoryApiAdapter();
    jest
      .spyOn(api, "getSavedGyms")
      .mockResolvedValue(fail({ kind: "api", code: "network", message: "" }));
    const { latest } = harness(api, () => useSavedGyms(true));
    await waitFor(() => expect(latest().error).not.toBeNull());
    expect(latest().isLoading).toBe(false);
  });

  it("returns a mutation error WITHOUT writing it to the list's error", async () => {
    const api = new InMemoryApiAdapter();
    api.savedGyms = [
      {
        id: "gym-1",
        name: "Hotel gym",
        equipmentTypeIds: ["eq-1"],
        createdAt: null,
        updatedAt: null,
      },
    ];
    const { latest } = harness(api, () => useSavedGyms(true));
    await waitFor(() => expect(latest().gyms).toHaveLength(1));

    let error: unknown;
    await act(async () => {
      error = await latest().create({
        name: "hotel gym",
        equipmentTypeIds: ["eq-2"],
      });
    });

    // A recoverable duplicate name must not blank a perfectly good list.
    expect(error).toEqual(
      expect.objectContaining({ loadoutCode: "SAVED_GYM_NAME_TAKEN" }),
    );
    expect(latest().error).toBeNull();
    expect(latest().gyms).toHaveLength(1);
  });

  it("re-reads after a successful mutation rather than splicing locally", async () => {
    const api = new InMemoryApiAdapter();
    const { latest } = harness(api, () => useSavedGyms(true));
    await waitFor(() => expect(latest().isLoading).toBe(false));

    await act(async () => {
      await latest().create({ name: "Garage", equipmentTypeIds: ["eq-1"] });
    });

    // The server owns `updatedAt` and the duplicate-name comparison, so a
    // locally-patched row would drift from the next open.
    await waitFor(() => expect(latest().gyms).toHaveLength(1));
    expect(latest().gyms[0].name).toBe("Garage");
  });

  it("removes a gym", async () => {
    const api = new InMemoryApiAdapter();
    api.savedGyms = [
      {
        id: "gym-1",
        name: "Hotel gym",
        equipmentTypeIds: ["eq-1"],
        createdAt: null,
        updatedAt: null,
      },
    ];
    const { latest } = harness(api, () => useSavedGyms(true));
    await waitFor(() => expect(latest().gyms).toHaveLength(1));

    await act(async () => {
      await latest().remove("gym-1");
    });
    await waitFor(() => expect(latest().gyms).toHaveLength(0));
  });
});

describe("useWorkoutVariations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useLoadoutFlow.setState({ rev: 0 });
  });

  it("does not fetch for a null workout", async () => {
    const api = new InMemoryApiAdapter();
    const spy = jest.spyOn(api, "getWorkoutVariations");
    const { latest } = harness(api, () => useWorkoutVariations(null));
    await waitFor(() => expect(latest().isLoading).toBe(false));
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not fetch for an optimistic local- id (no server row yet)", async () => {
    const api = new InMemoryApiAdapter();
    const spy = jest.spyOn(api, "getWorkoutVariations");
    const { latest } = harness(api, () => useWorkoutVariations("local-abc"));
    await waitFor(() => expect(latest().isLoading).toBe(false));
    expect(spy).not.toHaveBeenCalled();
  });

  it("lists the parent's variations", async () => {
    const api = new InMemoryApiAdapter();
    await api.createWorkoutVariation("w-1", {
      name: "Upper Body · Hotel gym",
      exercises: [{ exerciseId: "ex-1", sortOrder: 1 }],
    });
    const { latest } = harness(api, () => useWorkoutVariations("w-1"));
    await waitFor(() => expect(latest().variations).toHaveLength(1));
  });

  it("re-reads when the flow's `rev` bumps after a save", async () => {
    const api = new InMemoryApiAdapter();
    const spy = jest.spyOn(api, "getWorkoutVariations");
    const { latest } = harness(api, () => useWorkoutVariations("w-1"));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    // `rev` is the ONLY coupling between the root-mounted flow and this list.
    act(() => useLoadoutFlow.getState().saved());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(latest().error).toBeNull();
  });

  it("keeps the settled rows on screen while a `rev` bump re-reads", async () => {
    const api = new InMemoryApiAdapter();
    await api.createWorkoutVariation("w-1", {
      name: "Upper Body · Hotel gym",
      exercises: [{ exerciseId: "ex-1", sortOrder: 1 }],
    });
    const { latest } = harness(api, () => useWorkoutVariations("w-1"));
    await waitFor(() => expect(latest().variations).toHaveLength(1));

    // A never-settling re-read holds the hook in its post-bump state. `rev` only
    // means "a save landed, re-read" — the rows are still this workout's, and
    // blanking them unmounts `SavedSetupsSection` entirely, so dismissing the
    // flow quickly lands the user on workout detail with no Saved setups
    // section at all, right after saving one.
    jest
      .spyOn(api, "getWorkoutVariations")
      .mockReturnValue(new Promise(() => {}) as never);
    act(() => useLoadoutFlow.getState().saved());

    expect(latest().variations).toHaveLength(1);
  });

  it("discards a response for a workout the user has navigated away from", async () => {
    const api = new InMemoryApiAdapter();
    let resolveFirst: ((value: unknown) => void) | null = null;
    jest
      .spyOn(api, "getWorkoutVariations")
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve)) as never,
      )
      .mockResolvedValue(ok([]));

    function Probe({ workoutId }: { readonly workoutId: string }) {
      const state = useWorkoutVariations(workoutId);
      seen.push(state);
      return <Text>probe</Text>;
    }
    const seen: ReturnType<typeof useWorkoutVariations>[] = [];
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AdapterProvider adapters={makeAdapters(api)}>
          <Probe workoutId="w-1" />
        </AdapterProvider>
      </QueryClientProvider>,
    );

    rerender(
      <QueryClientProvider client={queryClient}>
        <AdapterProvider adapters={makeAdapters(api)}>
          <Probe workoutId="w-2" />
        </AdapterProvider>
      </QueryClientProvider>,
    );

    // w-1's slow response lands AFTER the switch. Variations are all named after
    // their parent, so painting w-1's list under w-2 reads as real data rather
    // than as a glitch.
    await act(async () => {
      resolveFirst?.(
        ok([
          {
            id: "v-stale",
            name: "Upper Body · Hotel gym",
            description: null,
            parentWorkoutId: "w-1",
            variationKind: "loadout",
            sourceGymId: null,
            sourceGymName: null,
            sourceEquipmentTypeIds: null,
            estimatedDurationMinutes: null,
            swapCount: 0,
            createdAt: null,
            updatedAt: null,
          },
        ]),
      );
    });

    const latest = seen[seen.length - 1];
    expect(latest.variations).toEqual([]);
  });

  it("records a read failure without throwing", async () => {
    const api = new InMemoryApiAdapter();
    jest
      .spyOn(api, "getWorkoutVariations")
      .mockResolvedValue(fail({ kind: "api", code: "network", message: "" }));
    const { latest } = harness(api, () => useWorkoutVariations("w-1"));
    await waitFor(() => expect(latest().error).not.toBeNull());
    expect(latest().variations).toEqual([]);
    expect(latest().isLoading).toBe(false);
  });
});
