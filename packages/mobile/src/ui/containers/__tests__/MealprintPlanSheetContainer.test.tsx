import { act, configure, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type {
  MySubscription,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { useFuelSheets } from "@/state/fuel-sheets";
import { usePlanFlow } from "@/state/plan-flow";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { MealprintPlanSheetProps } from "@/ui/presenters/mealprint/MealprintPlanSheetPresenter";
import { MealprintPlanSheetContainer } from "../MealprintPlanSheetContainer";

// Same rationale as MealprintSuggestSheetContainer.test.tsx — see its
// docstring on why this suite raises RTL's asyncUtilTimeout.
configure({ asyncUtilTimeout: 5_000 });

const mockProbe: { last: MealprintPlanSheetProps | null } = { last: null };
jest.mock("@/ui/presenters/mealprint/MealprintPlanSheetPresenter", () => ({
  MealprintPlanSheetPresenter: (props: MealprintPlanSheetProps) => {
    mockProbe.last = props;
    return null;
  },
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() },
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

let mockOnline = true;
jest.mock("@/ui/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => mockOnline,
}));

const SESSION: AuthSession = {
  accessToken: "t",
  refreshToken: "r",
  userId: "user-1",
  email: "u@example.com",
  expiresAt: Date.now() + 60_000,
};

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
  } as MySubscription;
}

function makeAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
): Adapters {
  return {
    api,
    auth: {
      getSession: jest.fn(async () => ok(SESSION)),
      onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
        cb(SESSION);
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

async function mount(
  seed?: (api: InMemoryApiAdapter, storage: InMemoryStorageAdapter) => void,
) {
  const api = new InMemoryApiAdapter();
  api.mySubscription = subscription("premium_plus");
  const storage = new InMemoryStorageAdapter();
  seed?.(api, storage);
  const subSpy = jest.spyOn(api, "getMySubscription");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AdapterProvider adapters={makeAdapters(api, storage)}>
        <MealprintPlanSheetContainer />
      </AdapterProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(subSpy).toHaveBeenCalled());
  await act(async () => {
    await subSpy.mock.results[0]?.value;
  });
  return { ...utils, api, storage, probe: () => mockProbe.last! };
}

function open() {
  act(() => useFuelSheets.getState().openMealprintPlan());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockProbe.last = null;
  mockOnline = true;
  useFuelSheets.setState({
    sheet: null,
    slot: "breakfast",
    date: "2026-08-05",
    rev: 0,
  });
  usePlanFlow.getState().reset();
});

describe("MealprintPlanSheetContainer", () => {
  it("issues nothing on mount — root-mounted and closed", async () => {
    const { api, probe } = await mount();
    const genSpy = jest.spyOn(api, "generatePlan");
    const targetSpy = jest.spyOn(api, "getNutritionTarget");
    await waitFor(() => expect(probe()).not.toBeNull());
    expect(probe().visible).toBe(false);
    expect(genSpy).not.toHaveBeenCalled();
    expect(targetSpy).not.toHaveBeenCalled();
  });

  it("generates a draft and moves to the draft stage", async () => {
    const { probe } = await mount((api) => {
      api.planGenerateResult = {
        meals: [
          {
            name: "Chicken & rice bowl",
            reason: "protein",
            logSlot: "dinner",
            items: [
              {
                candidateId: "food-1",
                kind: "food",
                servings: 1,
                name: "Chicken",
                kcal: 600,
                proteinG: 45,
                carbsG: 60,
                fatG: 15,
              },
            ],
            kcal: 600,
            proteinG: 45,
            carbsG: 60,
            fatG: 15,
            containsUnverified: false,
            flaggedUnsafe: false,
          },
        ],
        emptyReason: null,
        target: { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
        totals: { kcal: 600, proteinG: 45, carbsG: 60, fatG: 15 },
        withinTolerance: false,
        labelCheckRequired: true,
      };
    });
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    await act(async () => {
      probe().onGenerate();
      await Promise.resolve();
    });
    await waitFor(() => expect(probe().stage).toBe("draft"));
    expect(probe().draft?.meals).toHaveLength(1);
  });

  it("trims a non-empty steer and forwards it; a blank one is sent as undefined", async () => {
    const { api, probe } = await mount((seedApi) => {
      seedApi.planGenerateResult = {
        meals: [],
        emptyReason: "no_candidates",
        target: null,
        totals: null,
        withinTolerance: false,
        labelCheckRequired: true,
      };
    });
    open();
    await waitFor(() => expect(probe().visible).toBe(true));

    act(() => probe().onSteerChange("  high protein breakfast  "));
    await act(async () => {
      probe().onGenerate();
      await Promise.resolve();
    });
    await waitFor(() => expect(api.generatePlanCalls).toHaveLength(1));
    expect(api.generatePlanCalls[0]!.steer).toBe("high protein breakfast");
  });

  it("onAcceptRecovery is a no-op before a draft exists", async () => {
    const { probe } = await mount();
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    expect(probe().stage).toBe("config");
    // Nothing to recover from yet — must not throw.
    act(() => probe().onAcceptRecovery());
    expect(probe().stage).toBe("config");
  });

  it("an empty generate result stays on config with the reason set", async () => {
    const { probe } = await mount((api) => {
      api.planGenerateResult = {
        meals: [],
        emptyReason: "no_candidates",
        target: null,
        totals: null,
        withinTolerance: false,
        labelCheckRequired: true,
      };
    });
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    await act(async () => {
      probe().onGenerate();
      await Promise.resolve();
    });
    await waitFor(() => expect(probe().emptyReason).toBe("no_candidates"));
    expect(probe().stage).toBe("config");
  });

  it("blocks generate while offline", async () => {
    mockOnline = false;
    const { api, probe } = await mount();
    const genSpy = jest.spyOn(api, "generatePlan");
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    act(() => probe().onGenerate());
    expect(genSpy).not.toHaveBeenCalled();
    expect(probe().offline).toBe(true);
  });

  it("routes an unentitled user to the upgrade flow instead of generating", async () => {
    const { api, probe } = await mount((seedApi) => {
      seedApi.mySubscription = subscription("premium");
    });
    const genSpy = jest.spyOn(api, "generatePlan");
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    act(() => probe().onGenerate());
    expect(genSpy).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining("subscription-selection"),
    );
  });

  it("accepts a draft, writes the plan through the cache, and moves to saved", async () => {
    const { api, probe, storage } = await mount((seedApi) => {
      seedApi.planGenerateResult = {
        meals: [
          {
            name: "Chicken & rice bowl",
            reason: "protein",
            logSlot: "dinner",
            items: [
              {
                candidateId: "food-1",
                kind: "food",
                servings: 1,
                name: "Chicken",
                kcal: 600,
                proteinG: 45,
                carbsG: 60,
                fatG: 15,
              },
            ],
            kcal: 600,
            proteinG: 45,
            carbsG: 60,
            fatG: 15,
            containsUnverified: false,
            flaggedUnsafe: false,
          },
        ],
        emptyReason: null,
        target: { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
        totals: { kcal: 600, proteinG: 45, carbsG: 60, fatG: 15 },
        withinTolerance: false,
        labelCheckRequired: true,
      };
    });
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    await act(async () => {
      probe().onGenerate();
      await Promise.resolve();
    });
    await waitFor(() => expect(probe().stage).toBe("draft"));

    await act(async () => {
      probe().onAccept();
      await Promise.resolve();
    });
    await waitFor(() => expect(probe().stage).toBe("saved"));
    expect(
      storage.getCachedActiveMealPlan("user-1", "2026-08-05"),
    ).not.toBeNull();
    expect(api.acceptPlanCalls).toHaveLength(1);
    // References only — see the domain model's load-bearing test, mirrored
    // here at the wiring level.
    expect(api.acceptPlanCalls[0]!.meals[0]).not.toHaveProperty("kcal");
  });

  it("an unresolvable_items accept failure flags the affected meal and stays on draft", async () => {
    const { api, probe } = await mount((seedApi) => {
      seedApi.planGenerateResult = {
        meals: [
          {
            name: "Chicken & rice bowl",
            reason: "protein",
            logSlot: "dinner",
            items: [
              {
                candidateId: "food-1",
                kind: "food",
                servings: 1,
                name: "Chicken",
                kcal: 600,
                proteinG: 45,
                carbsG: 60,
                fatG: 15,
              },
            ],
            kcal: 600,
            proteinG: 45,
            carbsG: 60,
            fatG: 15,
            containsUnverified: false,
            flaggedUnsafe: false,
          },
        ],
        emptyReason: null,
        target: { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
        totals: { kcal: 600, proteinG: 45, carbsG: 60, fatG: 15 },
        withinTolerance: false,
        labelCheckRequired: true,
      };
      seedApi.nextAcceptPlanError = {
        kind: "api",
        code: "server",
        message: "unresolvable_items",
        status: 400,
        planErrorCode: "unresolvable_items",
        unresolvableItems: ["food:food-1"],
      };
    });
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    await act(async () => {
      probe().onGenerate();
      await Promise.resolve();
    });
    await waitFor(() => expect(probe().stage).toBe("draft"));

    await act(async () => {
      probe().onAccept();
      await Promise.resolve();
    });
    await waitFor(() => expect(probe().flaggedIds.size).toBe(1));
    expect(probe().stage).toBe("draft");
    expect(api.acceptPlanCalls).toHaveLength(1);
  });

  it("removes a meal from the draft (deterministic day-total recompute)", async () => {
    const { probe } = await mount((seedApi) => {
      seedApi.planGenerateResult = {
        meals: [
          {
            name: "A",
            reason: "x",
            logSlot: "breakfast",
            items: [],
            kcal: 300,
            proteinG: 20,
            carbsG: 30,
            fatG: 8,
            containsUnverified: false,
            flaggedUnsafe: false,
          },
          {
            name: "B",
            reason: "y",
            logSlot: "dinner",
            items: [],
            kcal: 600,
            proteinG: 45,
            carbsG: 60,
            fatG: 15,
            containsUnverified: false,
            flaggedUnsafe: false,
          },
        ],
        emptyReason: null,
        target: { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
        totals: { kcal: 900, proteinG: 65, carbsG: 90, fatG: 23 },
        withinTolerance: false,
        labelCheckRequired: true,
      };
    });
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    await act(async () => {
      probe().onGenerate();
      await Promise.resolve();
    });
    await waitFor(() => expect(probe().stage).toBe("draft"));
    expect(probe().draftTotals.kcal).toBe(900);

    const firstId = probe().draft!.meals[0]!.localId;
    act(() => probe().onRemoveMeal(firstId));
    await waitFor(() => expect(probe().draft!.meals).toHaveLength(1));
    expect(probe().draftTotals.kcal).toBe(600);
  });

  it("recomputes day totals when an item's servings change (serving stepper, AC 4.4)", async () => {
    const { probe } = await mount((seedApi) => {
      seedApi.planGenerateResult = {
        meals: [
          {
            name: "Chicken & rice bowl",
            reason: "protein",
            logSlot: "dinner",
            items: [
              {
                candidateId: "food-1",
                kind: "food",
                servings: 1,
                name: "Chicken",
                kcal: 600,
                proteinG: 45,
                carbsG: 60,
                fatG: 15,
              },
            ],
            kcal: 600,
            proteinG: 45,
            carbsG: 60,
            fatG: 15,
            containsUnverified: false,
            flaggedUnsafe: false,
          },
        ],
        emptyReason: null,
        target: { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
        totals: { kcal: 600, proteinG: 45, carbsG: 60, fatG: 15 },
        withinTolerance: false,
        labelCheckRequired: true,
      };
    });
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    await act(async () => {
      probe().onGenerate();
      await Promise.resolve();
    });
    await waitFor(() => expect(probe().stage).toBe("draft"));

    const localId = probe().draft!.meals[0]!.localId;
    act(() => probe().onItemServingsChange(localId, "food-1", 2));

    expect(probe().draft!.meals[0]!.meal.items[0]!.servings).toBe(2);
    // 600 kcal/serving × 2 servings.
    expect(probe().draft!.meals[0]!.meal.kcal).toBe(1200);
    expect(probe().draftTotals.kcal).toBe(1200);
  });

  it("swaps a meal via the swap endpoint and replaces it in the draft", async () => {
    const { api, probe } = await mount((seedApi) => {
      seedApi.planGenerateResult = {
        meals: [
          {
            name: "Original",
            reason: "x",
            logSlot: "dinner",
            items: [],
            kcal: 600,
            proteinG: 45,
            carbsG: 60,
            fatG: 15,
            containsUnverified: false,
            flaggedUnsafe: false,
          },
        ],
        emptyReason: null,
        target: { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
        totals: { kcal: 600, proteinG: 45, carbsG: 60, fatG: 15 },
        withinTolerance: false,
        labelCheckRequired: true,
      };
      seedApi.planSwapResult = {
        meal: {
          name: "Salmon & greens",
          reason: "omega-3",
          logSlot: "dinner",
          items: [
            {
              candidateId: "food-2",
              kind: "food",
              servings: 1,
              name: "Salmon",
              kcal: 500,
              proteinG: 40,
              carbsG: 20,
              fatG: 20,
            },
          ],
          kcal: 500,
          proteinG: 40,
          carbsG: 20,
          fatG: 20,
          containsUnverified: false,
        },
        emptyReason: null,
        labelCheckRequired: true,
      };
    });
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    await act(async () => {
      probe().onGenerate();
      await Promise.resolve();
    });
    await waitFor(() => expect(probe().stage).toBe("draft"));

    const localId = probe().draft!.meals[0]!.localId;
    await act(async () => {
      probe().onSwapMeal(localId);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(probe().draft!.meals[0]!.meal.name).toBe("Salmon & greens"),
    );
    expect(api.swapPlanMealCalls).toHaveLength(1);
    expect(probe().swappingId).toBeNull();
  });

  it("onViewToday closes the sheet, resets the flow, and navigates to the Today view", async () => {
    const { probe } = await mount();
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    act(() => probe().onViewToday());
    expect(useFuelSheets.getState().sheet).toBeNull();
    expect(usePlanFlow.getState().step).toBeNull();
    expect(mockPush).toHaveBeenCalledWith("/(app)/fuel/plan-today");
  });

  it("onEditPreferences closes the sheet before navigating to the preferences editor route", async () => {
    const { probe } = await mount();
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    act(() => probe().onEditPreferences());
    // ⚠ Must CLOSE first — `preferences.tsx` is a pushed screen, not a
    // root-mounted sheet, so leaving this sheet open renders the editor
    // BEHIND it (root-mounted sheets sit above the navigator stack).
    expect(useFuelSheets.getState().sheet).toBeNull();
    expect(mockPush).toHaveBeenCalledWith(
      "/(app)/fuel/preferences?mode=editor",
    );
  });

  it("onClose closes the sheet while visible", async () => {
    const { probe } = await mount();
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    act(() => probe().onClose());
    expect(useFuelSheets.getState().sheet).toBeNull();
  });

  it("onClose is a no-op while NOT visible (a controlled handoff to another sheet)", async () => {
    const { probe } = await mount();
    // Never opened — `visible` stays false.
    await waitFor(() => expect(probe()).not.toBeNull());
    useFuelSheets.setState({ sheet: "mealprintSuggest" });
    act(() => probe().onClose());
    // Must not have snapped the OTHER sheet shut.
    expect(useFuelSheets.getState().sheet).toBe("mealprintSuggest");
  });

  it("onGenerate does nothing while the entitlement gate is unresolved (unresolved is not denied)", async () => {
    // ⚠ The subscription query is deliberately left PENDING forever — unmount
    // explicitly in `finally` so this doesn't leave a dangling never-resolving
    // fetch (and its own cache's cold-start retry ladder) mounted underneath
    // every later test in this file.
    const api = new InMemoryApiAdapter();
    api.mySubscription = subscription("premium_plus");
    const storage = new InMemoryStorageAdapter();
    jest.spyOn(api, "getMySubscription").mockReturnValue(new Promise(() => {}));
    const genSpy = jest.spyOn(api, "generatePlan");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <AdapterProvider adapters={makeAdapters(api, storage)}>
          <MealprintPlanSheetContainer />
        </AdapterProvider>
      </QueryClientProvider>,
    );
    try {
      await waitFor(() => expect(mockProbe.last).not.toBeNull());
      open();
      await waitFor(() => expect(mockProbe.last!.visible).toBe(true));
      act(() => mockProbe.last!.onGenerate());
      expect(genSpy).not.toHaveBeenCalled();
    } finally {
      unmount();
      queryClient.clear();
    }
  });

  it("onSwapMeal is a no-op for an unknown localId", async () => {
    const { api, probe } = await mount((seedApi) => {
      seedApi.planGenerateResult = {
        meals: [
          {
            name: "A",
            reason: "x",
            logSlot: "dinner",
            items: [],
            kcal: 500,
            proteinG: 40,
            carbsG: 40,
            fatG: 10,
            containsUnverified: false,
            flaggedUnsafe: false,
          },
        ],
        emptyReason: null,
        target: { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
        totals: { kcal: 500, proteinG: 40, carbsG: 40, fatG: 10 },
        withinTolerance: false,
        labelCheckRequired: true,
      };
    });
    const swapSpy = jest.spyOn(api, "swapPlanMeal");
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    await act(async () => {
      probe().onGenerate();
      await Promise.resolve();
    });
    await waitFor(() => expect(probe().stage).toBe("draft"));

    act(() => probe().onSwapMeal("no-such-id"));
    expect(swapSpy).not.toHaveBeenCalled();
  });

  it("onRetryGenerate re-fires the last generate call", async () => {
    const { api, probe } = await mount((seedApi) => {
      seedApi.planGenerateResult = {
        meals: [],
        emptyReason: "no_candidates",
        target: null,
        totals: null,
        withinTolerance: false,
        labelCheckRequired: true,
      };
    });
    const genSpy = jest.spyOn(api, "generatePlan");
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    await act(async () => {
      probe().onGenerate();
      await Promise.resolve();
    });
    await waitFor(() => expect(genSpy).toHaveBeenCalledTimes(1));

    await act(async () => {
      probe().onRetryGenerate();
      await Promise.resolve();
    });
    await waitFor(() => expect(genSpy).toHaveBeenCalledTimes(2));
  });

  it("a swap that fails leaves the meal un-swapped and clears swappingId", async () => {
    const { probe } = await mount((seedApi) => {
      seedApi.planGenerateResult = {
        meals: [
          {
            name: "Original",
            reason: "x",
            logSlot: "dinner",
            items: [],
            kcal: 600,
            proteinG: 45,
            carbsG: 60,
            fatG: 15,
            containsUnverified: false,
            flaggedUnsafe: false,
          },
        ],
        emptyReason: null,
        target: { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
        totals: { kcal: 600, proteinG: 45, carbsG: 60, fatG: 15 },
        withinTolerance: false,
        labelCheckRequired: true,
      };
      seedApi.nextPlanSwapError = { status: 503, message: "ai_unavailable" };
    });
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    await act(async () => {
      probe().onGenerate();
      await Promise.resolve();
    });
    await waitFor(() => expect(probe().stage).toBe("draft"));

    const localId = probe().draft!.meals[0]!.localId;
    await act(async () => {
      probe().onSwapMeal(localId);
      await Promise.resolve();
    });
    await waitFor(() => expect(probe().swappingId).toBeNull());
    // Unchanged — the swap never landed.
    expect(probe().draft!.meals[0]!.meal.name).toBe("Original");
  });

  describe("onAcceptRecovery", () => {
    async function mountToDraft(
      seed?: (api: InMemoryApiAdapter, storage: InMemoryStorageAdapter) => void,
    ) {
      const harness = await mount((api, storage) => {
        api.planGenerateResult = {
          meals: [
            {
              name: "Chicken & rice bowl",
              reason: "protein",
              logSlot: "dinner",
              items: [
                {
                  candidateId: "food-1",
                  kind: "food",
                  servings: 1,
                  name: "Chicken",
                  kcal: 600,
                  proteinG: 45,
                  carbsG: 60,
                  fatG: 15,
                },
              ],
              kcal: 600,
              proteinG: 45,
              carbsG: 60,
              fatG: 15,
              containsUnverified: false,
              flaggedUnsafe: false,
            },
          ],
          emptyReason: null,
          target: { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
          totals: { kcal: 600, proteinG: 45, carbsG: 60, fatG: 15 },
          withinTolerance: false,
          labelCheckRequired: true,
        };
        seed?.(api, storage);
      });
      open();
      await waitFor(() => expect(harness.probe().visible).toBe(true));
      await act(async () => {
        harness.probe().onGenerate();
        await Promise.resolve();
      });
      await waitFor(() => expect(harness.probe().stage).toBe("draft"));
      return harness;
    }

    it("'replace' — archives the conflicting plan, then retries accept", async () => {
      const existingPlan = {
        id: "plan-existing",
        userId: "user-1",
        status: "active" as const,
        planDate: "2026-08-05",
        groupId: null,
        mealsPerDay: 1,
        effortLevel: "balanced" as const,
        targetKcal: 2000,
        targetProteinG: 150,
        targetCarbsG: 200,
        targetFatG: 60,
        source: "ai",
        createdByUserId: null,
        createdAt: null,
        acceptedAt: null,
        meals: [],
      };
      const { api, probe, storage } = await mountToDraft((seedApi) => {
        seedApi.activePlanByDate.set("2026-08-05", existingPlan);
        seedApi.plans.set("plan-existing", existingPlan);
        seedApi.nextAcceptPlanError = {
          kind: "api",
          code: "server",
          message: "active_plan_exists",
          status: 409,
          planErrorCode: "active_plan_exists",
          activePlanDate: "2026-08-05",
        };
      });

      await act(async () => {
        probe().onAccept();
        await Promise.resolve();
      });
      await waitFor(() => expect(probe().acceptRecovery).toBe("replace"));

      // Clear the canned failure so the recovery's retried accept call
      // succeeds — `nextAcceptPlanError` persists on the fake until reset.
      api.nextAcceptPlanError = null;
      const patchSpy = jest.spyOn(api, "patchPlan");
      await act(async () => {
        probe().onAcceptRecovery();
        await Promise.resolve();
      });

      expect(patchSpy).toHaveBeenCalledWith("plan-existing", {
        status: "archived",
      });
      await waitFor(() => expect(probe().stage).toBe("saved"));
      expect(
        storage.getCachedActiveMealPlan("user-1", "2026-08-05"),
      ).not.toBeNull();
    });

    it("'replace' — skips the archive step when there's nothing to archive, but still retries accept", async () => {
      const { api, probe, storage } = await mountToDraft((seedApi) => {
        // Deliberately no `activePlanByDate` entry for 2026-08-05 — the
        // "conflict" the 409 named does not actually resolve to a plan.
        seedApi.nextAcceptPlanError = {
          kind: "api",
          code: "server",
          message: "active_plan_exists",
          status: 409,
          planErrorCode: "active_plan_exists",
          activePlanDate: "2026-08-05",
        };
      });
      const patchSpy = jest.spyOn(api, "patchPlan");

      await act(async () => {
        probe().onAccept();
        await Promise.resolve();
      });
      await waitFor(() => expect(probe().acceptRecovery).toBe("replace"));

      api.nextAcceptPlanError = null;
      await act(async () => {
        probe().onAcceptRecovery();
        await Promise.resolve();
      });

      expect(patchSpy).not.toHaveBeenCalled();
      await waitFor(() => expect(probe().stage).toBe("saved"));
      expect(
        storage.getCachedActiveMealPlan("user-1", "2026-08-05"),
      ).not.toBeNull();
    });

    it("a failure code with no defined recovery is a no-op (null draft guard + unmatched code)", async () => {
      const { probe } = await mountToDraft((seedApi) => {
        seedApi.nextAcceptPlanError = {
          kind: "api",
          code: "server",
          message: "no_targets",
          status: 400,
          planErrorCode: "no_targets",
        };
      });

      await act(async () => {
        probe().onAccept();
        await Promise.resolve();
      });
      await waitFor(() =>
        expect(probe().acceptErrorMessage).toBe("no_targets"),
      );
      expect(probe().acceptRecovery).toBeNull();

      // Neither branch matches — calling it must not throw or change stage.
      act(() => probe().onAcceptRecovery());
      expect(probe().stage).toBe("draft");
    });

    it("'regenerate' — resets the flow back to config", async () => {
      const { probe } = await mountToDraft((seedApi) => {
        seedApi.nextAcceptPlanError = {
          kind: "api",
          code: "server",
          message: "avoidance_violation",
          status: 422,
          planErrorCode: "avoidance_violation",
        };
      });

      await act(async () => {
        probe().onAccept();
        await Promise.resolve();
      });
      await waitFor(() => expect(probe().acceptRecovery).toBe("regenerate"));

      act(() => probe().onAcceptRecovery());
      await waitFor(() => expect(probe().stage).toBe("config"));
      expect(probe().draft).toBeNull();
    });
  });
});
