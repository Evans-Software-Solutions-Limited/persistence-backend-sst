import { act, render, waitFor } from "@testing-library/react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { MealPlan } from "@/domain/models/mealprint";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { PlanTodayProps } from "@/ui/presenters/mealprint/PlanTodayPresenter";
import { PlanTodayContainer } from "../PlanTodayContainer";

const mockProbe: { last: PlanTodayProps | null } = { last: null };
jest.mock("@/ui/presenters/mealprint/PlanTodayPresenter", () => ({
  PlanTodayPresenter: (props: PlanTodayProps) => {
    mockProbe.last = props;
    return null;
  },
}));

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: jest.fn(), back: (...a: unknown[]) => mockBack(...a) },
}));

const SESSION: AuthSession = {
  accessToken: "t",
  refreshToken: "r",
  userId: "user-1",
  email: "u@example.com",
  expiresAt: Date.now() + 60_000,
};

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

function fixturePlan(over: Partial<MealPlan> = {}): MealPlan {
  return {
    id: "plan-1",
    userId: "user-1",
    status: "active",
    planDate: new Date().toISOString().slice(0, 10),
    groupId: null,
    mealsPerDay: 1,
    effortLevel: "balanced",
    targetKcal: 2200,
    targetProteinG: 160,
    targetCarbsG: 220,
    targetFatG: 70,
    source: "ai",
    createdByUserId: null,
    createdAt: null,
    acceptedAt: null,
    meals: [
      {
        id: "meal-1",
        sortOrder: 0,
        label: "Chicken & rice bowl",
        logSlot: "dinner",
        recipeId: null,
        mealId: null,
        items: null,
        kcal: 600,
        proteinG: 45,
        carbsG: 60,
        fatG: 15,
        aiReason: null,
        state: "planned",
        loggedEntryId: null,
      },
    ],
    ...over,
  };
}

async function mount(
  seed?: (api: InMemoryApiAdapter, storage: InMemoryStorageAdapter) => void,
) {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  seed?.(api, storage);
  const utils = render(
    <AdapterProvider adapters={makeAdapters(api, storage)}>
      <PlanTodayContainer />
    </AdapterProvider>,
  );
  await waitFor(() => expect(mockProbe.last).not.toBeNull());
  return { ...utils, api, storage, probe: () => mockProbe.last! };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockProbe.last = null;
});

describe("PlanTodayContainer", () => {
  it("reads today's active plan and derives adherence for the presenter", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const plan = fixturePlan({ planDate: today });
    const { probe } = await mount((api, storage) => {
      storage.cacheMealPlan("user-1", plan);
      api.activePlanByDate.set(today, plan);
    });
    await waitFor(() => expect(probe().plan).not.toBeNull());
    expect(probe().totalCount).toBe(1);
    expect(probe().loggedCount).toBe(0);
  });

  it("onBack navigates back", async () => {
    const { probe } = await mount();
    act(() => probe().onBack());
    expect(mockBack).toHaveBeenCalled();
  });

  it("onLogMeal logs the meal and reflects it in the reloaded plan", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const plan = fixturePlan({ planDate: today });
    const { probe, storage } = await mount((api, storage) => {
      storage.cacheMealPlan("user-1", plan);
      api.activePlanByDate.set(today, plan);
    });
    await waitFor(() => expect(probe().plan).not.toBeNull());

    await act(async () => {
      await probe().onLogMeal(plan.meals[0]!);
    });

    await waitFor(() =>
      expect(
        storage.getCachedActiveMealPlan("user-1", today)!.meals[0]!.state,
      ).toBe("logged"),
    );
  });

  it("onDeletePlan calls the API, clears the cache and navigates back", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const plan = fixturePlan({ planDate: today });
    const { probe, storage, api } = await mount((api, storage) => {
      storage.cacheMealPlan("user-1", plan);
      api.activePlanByDate.set(today, plan);
      api.plans.set("plan-1", plan);
    });
    await waitFor(() => expect(probe().plan).not.toBeNull());
    const deleteSpy = jest.spyOn(api, "deletePlan");

    await act(async () => {
      await probe().onDeletePlan();
    });

    expect(deleteSpy).toHaveBeenCalledWith("plan-1");
    expect(storage.getCachedActiveMealPlan("user-1", today)).toBeNull();
    expect(mockBack).toHaveBeenCalled();
  });

  it("onDeletePlan is a no-op when there is no active plan", async () => {
    const { probe, api } = await mount();
    await waitFor(() => expect(probe().loading).toBe(false));
    const deleteSpy = jest.spyOn(api, "deletePlan");
    await act(async () => {
      await probe().onDeletePlan();
    });
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("a second onDeletePlan call while the first is still in flight is a no-op", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const plan = fixturePlan({ planDate: today });
    const { probe, api } = await mount((seedApi, storage) => {
      storage.cacheMealPlan("user-1", plan);
      seedApi.activePlanByDate.set(today, plan);
      seedApi.plans.set("plan-1", plan);
    });
    await waitFor(() => expect(probe().plan).not.toBeNull());
    let resolveDelete!: (
      r: Awaited<ReturnType<InMemoryApiAdapter["deletePlan"]>>,
    ) => void;
    const deleteSpy = jest
      .spyOn(api, "deletePlan")
      .mockReturnValue(new Promise((r) => (resolveDelete = r)));

    act(() => probe().onDeletePlan());
    await waitFor(() => expect(probe().deleting).toBe(true));
    act(() => probe().onDeletePlan());
    expect(deleteSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDelete({ ok: true, value: { deleted: true } });
      await Promise.resolve();
    });
    await waitFor(() => expect(probe().deleting).toBe(false));
  });

  it("swaps a meal via swap+replace and reflects the result", async () => {
    const today = new Date().toISOString().slice(0, 10);
    // TWO meals — the held-totals reduce actually runs over the OTHER one
    // (a single-meal plan filters down to an empty array, and Array.reduce
    // never invokes its callback on an empty array with an initial value).
    const held = { ...fixturePlan().meals[0]!, id: "meal-2", kcal: 300 };
    const plan = fixturePlan({
      planDate: today,
      meals: [fixturePlan().meals[0]!, held],
    });
    const { probe, storage } = await mount((api, storage) => {
      storage.cacheMealPlan("user-1", plan);
      api.activePlanByDate.set(today, plan);
      api.plans.set("plan-1", plan);
      api.planSwapResult = {
        meal: {
          name: "Salmon & greens",
          reason: "omega-3",
          logSlot: "dinner",
          items: [{ candidateId: "food-2", servings: 1, name: "Salmon" }],
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
    await waitFor(() => expect(probe().plan).not.toBeNull());

    act(() => probe().onSwapMeal(plan.meals[0]!));

    await waitFor(() =>
      expect(
        storage.getCachedActiveMealPlan("user-1", today)!.meals[0]!.label,
      ).toBe("Salmon & greens"),
    );
  });

  it("a swap that fails leaves the meal unchanged, clears the swapping id, and surfaces the failure message", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const plan = fixturePlan({ planDate: today });
    const { probe, storage } = await mount((api, storage) => {
      storage.cacheMealPlan("user-1", plan);
      api.activePlanByDate.set(today, plan);
      api.nextPlanSwapError = { status: 503, message: "ai_unavailable" };
    });
    await waitFor(() => expect(probe().plan).not.toBeNull());

    act(() => probe().onSwapMeal(plan.meals[0]!));

    await waitFor(() => expect(probe().swappingMealId).toBeNull());
    expect(
      storage.getCachedActiveMealPlan("user-1", today)!.meals[0]!.label,
    ).toBe("Chicken & rice bowl");
    // ⚠ This is the revert-verifying assertion for the "swap failures are
    // swallowed silently" bug: it fails unless `actionFailure` is threaded
    // through from `swap.failure` into the presenter prop.
    expect(probe().actionFailure).toMatch(/unavailable/i);
  });

  it("a swap that hits the daily ceiling surfaces the 429 message", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const plan = fixturePlan({ planDate: today });
    const { probe } = await mount((api, storage) => {
      storage.cacheMealPlan("user-1", plan);
      api.activePlanByDate.set(today, plan);
      api.nextPlanSwapError = { status: 429, message: "ai_daily_limit" };
    });
    await waitFor(() => expect(probe().plan).not.toBeNull());

    act(() => probe().onSwapMeal(plan.meals[0]!));

    await waitFor(() => expect(probe().swappingMealId).toBeNull());
    expect(probe().actionFailure).toMatch(/used all of today's swaps/i);
  });

  it("starting a new swap clears a previous action failure", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const plan = fixturePlan({ planDate: today });
    const { probe } = await mount((api, storage) => {
      storage.cacheMealPlan("user-1", plan);
      api.activePlanByDate.set(today, plan);
      api.nextPlanSwapError = { status: 503, message: "ai_unavailable" };
    });
    await waitFor(() => expect(probe().plan).not.toBeNull());

    act(() => probe().onSwapMeal(plan.meals[0]!));
    await waitFor(() => expect(probe().actionFailure).not.toBeNull());

    act(() => probe().onSwapMeal(plan.meals[0]!));
    expect(probe().actionFailure).toBeNull();
  });

  it("shows the empty state when there is no active plan today", async () => {
    const { probe } = await mount();
    await waitFor(() => expect(probe().loading).toBe(false));
    expect(probe().plan).toBeNull();
  });

  it("onSwapMeal is a no-op when there is no active plan to swap against", async () => {
    const { probe, api } = await mount();
    await waitFor(() => expect(probe().loading).toBe(false));
    const swapSpy = jest.spyOn(api, "swapPlanMeal");
    act(() => probe().onSwapMeal(fixturePlan().meals[0]!));
    expect(swapSpy).not.toHaveBeenCalled();
  });

  it("onLogMeal is a no-op when there is no active plan to log against", async () => {
    const { probe } = await mount();
    await waitFor(() => expect(probe().loading).toBe(false));
    await act(async () => {
      await probe().onLogMeal(fixturePlan().meals[0]!);
    });
    expect(probe().plan).toBeNull();
  });

  it("a swap whose replace call fails (unknown plan) leaves the cache untouched and surfaces a failure message", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const held = { ...fixturePlan().meals[0]!, id: "meal-2", kcal: 300 };
    const plan = fixturePlan({
      planDate: today,
      meals: [fixturePlan().meals[0]!, held],
    });
    const { probe, storage } = await mount((seedApi, seedStorage) => {
      seedStorage.cacheMealPlan("user-1", plan);
      seedApi.activePlanByDate.set(today, plan);
      seedApi.planSwapResult = {
        meal: {
          name: "Salmon & greens",
          reason: "omega-3",
          logSlot: "dinner",
          items: [{ candidateId: "food-2", servings: 1, name: "Salmon" }],
          kcal: 500,
          proteinG: 40,
          carbsG: 20,
          fatG: 20,
          containsUnverified: false,
        },
        emptyReason: null,
        labelCheckRequired: true,
      };
      // Deliberately no matching `plans.set("plan-1", plan)` — the fake's
      // `replacePlanMeal` 404s, exercising the replace-failed branch.
    });

    act(() => probe().onSwapMeal(plan.meals[0]!));
    await waitFor(() => expect(probe().swappingMealId).toBeNull());
    expect(
      storage.getCachedActiveMealPlan("user-1", today)!.meals[0]!.label,
    ).toBe("Chicken & rice bowl");
    // ⚠ Revert-verifying assertion: fails unless the replace-failure mirror
    // effect threads `replace.failure` into `actionFailure`.
    expect(probe().actionFailure).not.toBeNull();
  });

  it("a replace failure with a recognised plan error code (meal_not_found) surfaces the mapped message", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const held = { ...fixturePlan().meals[0]!, id: "meal-2", kcal: 300 };
    const plan = fixturePlan({
      planDate: today,
      meals: [fixturePlan().meals[0]!, held],
    });
    const { probe } = await mount((api, storage) => {
      storage.cacheMealPlan("user-1", plan);
      api.activePlanByDate.set(today, plan);
      api.plans.set("plan-1", plan);
      api.planSwapResult = {
        meal: {
          name: "Salmon & greens",
          reason: "omega-3",
          logSlot: "dinner",
          items: [{ candidateId: "food-2", servings: 1, name: "Salmon" }],
          kcal: 500,
          proteinG: 40,
          carbsG: 20,
          fatG: 20,
          containsUnverified: false,
        },
        emptyReason: null,
        labelCheckRequired: true,
      };
      api.nextReplacePlanMealError = {
        kind: "api",
        code: "server",
        message: "meal_not_found",
        status: 404,
        planErrorCode: "meal_not_found",
      };
    });

    act(() => probe().onSwapMeal(plan.meals[0]!));
    await waitFor(() => expect(probe().swappingMealId).toBeNull());
    expect(probe().actionFailure).toBe(
      "This meal is no longer part of your plan.",
    );
  });
});
