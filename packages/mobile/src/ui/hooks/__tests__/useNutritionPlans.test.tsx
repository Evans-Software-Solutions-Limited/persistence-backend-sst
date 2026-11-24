import { act, renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type {
  NutritionPlan,
  PlanFromCoach,
} from "@/domain/models/nutritionPlans";
import type { UserMeal } from "@/domain/models/userMeals";
import {
  emptyPlanMeal,
  newDraftPlan,
  planItemCustom,
  addItemToMeal,
} from "@/domain/services/nutritionPlans.service";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  usePlansShoppingList,
  useNutritionPlans,
} from "@/ui/hooks/useNutritionPlans";

const mockProcessSyncQueue = jest.fn();
jest.mock("@/application/commands/sync.command", () => ({
  processSyncQueue: (...a: unknown[]) => mockProcessSyncQueue(...a),
}));

const USER = "athlete-1";

function setup(signedIn = true) {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: USER,
    email: "a@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    getSession: jest.fn(async () => ok(signedIn ? session : null)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(signedIn ? session : null);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  const adapters: Adapters = {
    api,
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    netInfo: {} as Adapters["netInfo"],
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
  );
  return { api, storage, wrapper };
}

function plan(id: string, ownerId: string, kcal = 500): NutritionPlan {
  const p = newDraftPlan({
    id,
    ownerId,
    name: "Training day",
    now: "2026-11-20T00:00:00.000Z",
    meals: [emptyPlanMeal(`${id}-m1`, "Lunch", "lunch", 0)],
  });
  return {
    ...addItemToMeal(
      p,
      `${id}-m1`,
      planItemCustom(`${id}-i1`, "Wrap", {
        kcal,
        proteinG: 30,
        carbsG: 50,
        fatG: 10,
      }),
    ),
    revision: 1,
  };
}

const fromCoach = (p: NutritionPlan, over: Partial<PlanFromCoach> = {}) => ({
  plan: p,
  coach: { id: "coach-1", name: "Ellie Hart", avatarUrl: null },
  assignmentId: "a1",
  note: null,
  status: "sent" as const,
  sentAt: "2026-11-21T00:00:00.000Z",
  addedAt: null,
  updatedSinceSeen: true,
  ...over,
});

const lunch: UserMeal = {
  id: "um-l",
  name: "Lunch",
  logSlot: "lunch",
  sortOrder: 0,
  defaultKey: "lunch",
  clientRequestId: null,
  archivedAt: null,
  updatedAt: "t",
};

beforeEach(() => {
  mockProcessSyncQueue.mockReset();
  mockProcessSyncQueue.mockResolvedValue({});
});

describe("useNutritionPlans", () => {
  it("reads in full first, then only what changed since", async () => {
    const { api, wrapper } = setup();
    api.nutritionPlans = {
      mine: [plan("p1", USER)],
      fromCoaches: [fromCoach(plan("c1", "coach-1"))],
      deletedIds: [],
      asOf: "2026-11-23T10:00:00.000Z",
    };
    const hook = renderHook(() => useNutritionPlans(false), { wrapper });
    expect(hook.result.current.isLoading).toBe(true);
    await act(async () => {
      await hook.result.current.refresh();
    });
    expect(hook.result.current.cache.mine.map((p) => p.id)).toEqual(["p1"]);
    expect(hook.result.current.isLoading).toBe(false);

    // The coach edits c1; the delta carries it and deletes p1.
    api.nutritionPlans = {
      mine: [],
      fromCoaches: [fromCoach(plan("c1", "coach-1", 800))],
      deletedIds: ["p1"],
      asOf: "2026-11-23T11:00:00.000Z",
    };
    await act(async () => {
      await hook.result.current.refresh();
    });
    expect(api.nutritionPlansCalls).toEqual([null, "2026-11-23T10:00:00.000Z"]);
    expect(hook.result.current.cache.mine).toEqual([]);
    expect(hook.result.current.cache.fromCoaches[0]!.plan.totals.kcal).toBe(
      800,
    );
  });

  it("a plan created offline survives a read that doesn't have it yet", async () => {
    const { wrapper } = setup();
    const hook = renderHook(() => useNutritionPlans(false), { wrapper });
    await act(async () => {
      await hook.result.current.create({ ...plan("x", USER), id: "local-a" });
    });
    await act(async () => {
      await hook.result.current.refresh();
    });
    expect(hook.result.current.cache.mine.map((p) => p.id)).toEqual([
      "local-a",
    ]);
    expect(mockProcessSyncQueue).toHaveBeenCalled();
  });

  it("edits, duplicates, answers a coach and deletes through the queue", async () => {
    const { api, storage, wrapper } = setup();
    api.nutritionPlans = {
      mine: [plan("p1", USER)],
      fromCoaches: [fromCoach(plan("c1", "coach-1"))],
      deletedIds: [],
      asOf: "t",
    };
    const hook = renderHook(() => useNutritionPlans(false), { wrapper });
    await act(async () => {
      await hook.result.current.refresh();
    });
    const h = () => hook.result.current;
    await act(async () => {
      await h().save({ ...h().cache.mine[0]!, name: "Renamed" });
    });
    expect(h().cache.mine[0]!.name).toBe("Renamed");
    let copy: NutritionPlan | null = null;
    await act(async () => {
      copy = await h().duplicate(h().cache.fromCoaches[0]!.plan);
    });
    expect(copy!.sourcePlanId).toBe("c1");
    await act(async () => {
      await h().answerCoachPlan("c1", true);
      await h().markSeen("c1");
    });
    expect(h().cache.fromCoaches[0]).toMatchObject({
      status: "added",
      updatedSinceSeen: false,
    });
    await act(async () => {
      await h().remove("p1");
    });
    expect(h().cache.mine.map((p) => p.id)).toEqual([copy!.id]);

    // A conflict note can be cleared.
    act(() => {
      storage.cacheNutritionPlans(USER, {
        ...h().cache,
        conflictPlanIds: ["x"],
      });
      h().clearConflict("x");
    });
    expect(h().cache.conflictPlanIds).toEqual([]);
  });

  it("adds a plan meal to today offline, from the cache", async () => {
    const { storage, wrapper } = setup();
    mockProcessSyncQueue.mockRejectedValue(new Error("offline"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const hook = renderHook(() => useNutritionPlans(false), { wrapper });
    let n = 0;
    await act(async () => {
      n = (
        await hook.result.current.addToDay(
          plan("p1", USER),
          null,
          [lunch],
          "2026-11-23T12:00:00.000Z",
        )
      ).length;
    });
    expect(n).toBe(1);
    expect(storage.getCachedFuelToday(USER, "2026-11-23")!.consumed.kcal).toBe(
      500,
    );
    expect(storage.getPendingMutations()).toHaveLength(1);
    spy.mockRestore();
  });

  it("does nothing without a signed-in user", async () => {
    const { wrapper } = setup(false);
    const hook = renderHook(() => useNutritionPlans(false), { wrapper });
    const h = hook.result.current;
    await act(async () => {
      expect(await h.create(plan("x", USER))).toBeNull();
      expect(await h.save(plan("x", USER))).toBeNull();
      expect(await h.duplicate(plan("x", USER))).toBeNull();
      await h.remove("x");
      await h.answerCoachPlan("x", true);
      await h.markSeen("x");
      h.clearConflict("x");
      expect(await h.addToDay(plan("x", USER), null, [], "t")).toEqual([]);
    });
    expect(mockProcessSyncQueue).not.toHaveBeenCalled();
  });
});

describe("usePlansShoppingList", () => {
  it("reads the list, keeps this phone's ticks, and adds a plan", async () => {
    const { api, wrapper } = setup();
    api.plansShopping = {
      aisles: [
        {
          aisle: "Meat & fish",
          items: [{ id: "chicken", name: "Chicken breast", quantity: "450 g" }],
        },
      ],
      totalItems: 1,
      plans: [],
      asOf: "t",
    };
    const hook = renderHook(() => usePlansShoppingList(false), { wrapper });
    act(() => hook.result.current.toggleTick("chicken"));
    await act(async () => {
      await hook.result.current.refresh();
    });
    expect(hook.result.current.value.ticked).toEqual(["chicken"]);
    expect(hook.result.current.value.list!.totalItems).toBe(1);

    await act(async () => {
      await hook.result.current.setPlanIncluded("p1", true);
    });
    expect(
      hook.result.current.value.list!.plans.map((p) => p.nutritionPlanId),
    ).toEqual(["p1"]);
  });

  it("a plan toggled while the list is being read survives that read, and the list is read again (Inspector Brad #554)", async () => {
    jest.useFakeTimers();
    const { api, storage, wrapper } = setup();
    // The drain sends B's add and the server acknowledges it.
    mockProcessSyncQueue.mockImplementation(async () => {
      for (const e of storage.getPendingMutations())
        storage.markMutationCompleted(e.id);
      return {};
    });
    const stale = await api.getPlansShoppingList();
    let release: () => void = () => {};
    let requested: () => void = () => {};
    const getSent = new Promise<void>((r) => (requested = r));
    const spy = jest
      .spyOn(api, "getPlansShoppingList")
      .mockImplementationOnce(async () => {
        requested();
        await new Promise<void>((r) => (release = r));
        return stale; // the server's list from before B was added
      });
    const hook = renderHook(() => usePlansShoppingList(false), { wrapper });
    let first: Promise<boolean> = Promise.resolve(true);
    act(() => {
      first = hook.result.current.refresh();
    });
    await act(async () => {
      await getSent;
    });
    // B is toggled while that read is outstanding; its own refresh is dropped.
    api.plansShopping = {
      ...api.plansShopping,
      plans: [{ nutritionPlanId: "B", mealPlanId: null, addedAt: "t" }],
    };
    await act(async () => {
      await hook.result.current.setPlanIncluded("B", true);
    });
    await act(async () => {
      release();
      await first;
    });
    expect(
      hook.result.current.value.list!.plans.map((p) => p.nutritionPlanId),
    ).toEqual(["B"]);
    // A follow-up read picks up B's aisles.
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    await act(async () => {});
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    jest.useRealTimers();
  });

  it("does nothing without a signed-in user", async () => {
    const { wrapper } = setup(false);
    const hook = renderHook(() => usePlansShoppingList(false), { wrapper });
    act(() => hook.result.current.toggleTick("x"));
    await act(async () => {
      await hook.result.current.setPlanIncluded("p1", true);
    });
    expect(hook.result.current.value).toEqual({ list: null, ticked: [] });
  });
});
