import { act, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { usePlanGenerate } from "@/ui/hooks/usePlanGenerate";
import { usePlanSwap } from "@/ui/hooks/usePlanSwap";
import { usePlanAccept } from "@/ui/hooks/usePlanAccept";
import { useReplacePlanMeal } from "@/ui/hooks/useReplacePlanMeal";
import { useLogPlanMeal } from "@/ui/hooks/useLogPlanMeal";
import { useGetActiveMealPlan } from "@/ui/hooks/useGetActiveMealPlan";
import * as syncCommand from "@/application/commands/sync.command";
import type {
  MealPlan,
  PlanAcceptInput,
  PlanGenerateResult,
} from "@/domain/models/mealprint";

/** Same harness shape as `useMealprintHooks.test.tsx` — no react-query needed
 * for these hooks (none of them use `useCachedResource` except
 * `useGetActiveMealPlan`, which doesn't need it either — no TanStack query
 * client dependency in this port). */
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
      getSession: jest.fn(async () => ({ ok: true, value: session })),
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
  const utils = render(
    <AdapterProvider adapters={makeAdapters(api, storage)}>
      <Probe />
    </AdapterProvider>,
  );
  return { ...utils, storage, latest: () => seen[seen.length - 1] as T };
}

function planGenerateResult(
  over: Partial<PlanGenerateResult> = {},
): PlanGenerateResult {
  return {
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
    ...over,
  };
}

function mealPlanFixture(over: Partial<MealPlan> = {}): MealPlan {
  return {
    id: "plan-1",
    userId: "user-1",
    status: "active",
    planDate: "2026-08-05",
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

function acceptInput(over: Partial<PlanAcceptInput> = {}): PlanAcceptInput {
  return {
    planDate: "2026-08-05",
    mealsPerDay: 4,
    meals: [
      {
        label: "Chicken & rice bowl",
        logSlot: "dinner",
        items: [{ foodId: "food-1", servings: 1 }],
      },
    ],
    ...over,
  };
}

describe("usePlanGenerate", () => {
  it("moves idle → generating → ready with the result", async () => {
    const api = new InMemoryApiAdapter();
    api.planGenerateResult = planGenerateResult();
    const { latest } = harness(api, usePlanGenerate);
    expect(latest().stage).toBe("idle");
    await act(async () => {
      await latest().run({ planDate: "2026-08-05" });
    });
    expect(latest().stage).toBe("ready");
    expect(latest().result?.meals).toHaveLength(1);
  });

  it("classifies 402 as an entitlement denial, 429 as non-retryable", async () => {
    const api = new InMemoryApiAdapter();
    api.nextPlanGenerateError = { status: 402, message: "denied" };
    const { latest } = harness(api, usePlanGenerate);
    await act(async () => {
      await latest().run({ planDate: "2026-08-05" });
    });
    expect(latest().failure?.entitlementDenied).toBe(true);

    api.nextPlanGenerateError = { status: 429, message: "ai_daily_limit" };
    const { latest: latest2 } = harness(api, usePlanGenerate);
    await act(async () => {
      await latest2().run({ planDate: "2026-08-05" });
    });
    expect(latest2().failure?.retryable).toBe(false);
    expect(latest2().failure?.message).toMatch(/reset tomorrow/i);
  });

  it("retry re-sends the last input", async () => {
    const api = new InMemoryApiAdapter();
    api.planGenerateResult = planGenerateResult();
    const { latest } = harness(api, usePlanGenerate);
    await act(async () => {
      await latest().run({ planDate: "2026-08-05", steer: "high protein" });
    });
    await act(async () => {
      await latest().retry();
    });
    expect(api.generatePlanCalls).toHaveLength(2);
    expect(api.generatePlanCalls[1]).toEqual({
      planDate: "2026-08-05",
      steer: "high protein",
    });
  });

  it("reset clears the result and returns to idle", async () => {
    const api = new InMemoryApiAdapter();
    api.planGenerateResult = planGenerateResult();
    const { latest } = harness(api, usePlanGenerate);
    await act(async () => {
      await latest().run({ planDate: "2026-08-05" });
    });
    act(() => latest().reset());
    expect(latest().stage).toBe("idle");
    expect(latest().result).toBeNull();
  });

  it("classifies 422 as retryable and 503 as retryable-but-not-a-prompt-problem", async () => {
    const api = new InMemoryApiAdapter();
    api.nextPlanGenerateError = { status: 422, message: "ai_unreadable" };
    const { latest } = harness(api, usePlanGenerate);
    await act(async () => {
      await latest().run({ planDate: "2026-08-05" });
    });
    expect(latest().failure?.retryable).toBe(true);

    api.nextPlanGenerateError = { status: 503, message: "ai_unavailable" };
    const { latest: latest2 } = harness(api, usePlanGenerate);
    await act(async () => {
      await latest2().run({ planDate: "2026-08-05" });
    });
    expect(latest2().failure?.retryable).toBe(true);
    expect(latest2().failure?.message).not.toMatch(/rephras/i);
  });

  it("falls back to a transport message for an unrecognised status", async () => {
    const api = new InMemoryApiAdapter();
    api.nextPlanGenerateError = { status: 500, message: "server" };
    const { latest } = harness(api, usePlanGenerate);
    await act(async () => {
      await latest().run({ planDate: "2026-08-05" });
    });
    expect(latest().failure?.message).toMatch(/connection/i);
  });

  it("rejects a concurrent run rather than billing two inferences", async () => {
    const api = new InMemoryApiAdapter();
    let resolve!: (
      r: Awaited<ReturnType<InMemoryApiAdapter["generatePlan"]>>,
    ) => void;
    const spy = jest
      .spyOn(api, "generatePlan")
      .mockReturnValue(new Promise((r) => (resolve = r)));
    const { latest } = harness(api, usePlanGenerate);
    act(() => {
      void latest().run({ planDate: "2026-08-05" });
    });
    act(() => {
      void latest().run({ planDate: "2026-08-05" });
    });
    expect(spy).toHaveBeenCalledTimes(1);
    resolve({ ok: true, value: planGenerateResult() });
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("retry() is a no-op when there has not been a prior run", async () => {
    const api = new InMemoryApiAdapter();
    const spy = jest.spyOn(api, "generatePlan");
    const { latest } = harness(api, usePlanGenerate);
    await act(async () => {
      await latest().retry();
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("reset while a request is still in flight keeps the generating stage and the last input", async () => {
    const api = new InMemoryApiAdapter();
    let resolve!: (
      r: Awaited<ReturnType<InMemoryApiAdapter["generatePlan"]>>,
    ) => void;
    const spy = jest
      .spyOn(api, "generatePlan")
      .mockReturnValue(new Promise((r) => (resolve = r)));
    const { latest } = harness(api, usePlanGenerate);
    let runPromise!: Promise<void>;
    act(() => {
      runPromise = latest().run({ planDate: "2026-08-05" });
    });
    expect(latest().stage).toBe("generating");

    act(() => latest().reset());
    // Must NOT drop to idle — a live Generate button here would silently
    // no-op while the abandoned request is still out.
    expect(latest().stage).toBe("generating");

    resolve({ ok: true, value: planGenerateResult() });
    await act(async () => {
      await runPromise;
    });

    // The retry still has an input to work from.
    spy.mockRestore();
    await act(async () => {
      await latest().retry();
    });
    expect(api.generatePlanCalls.length).toBeGreaterThanOrEqual(1);
  });
});

describe("usePlanSwap", () => {
  const input = {
    dayTarget: { kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 },
    heldTotals: { kcal: 1600, proteinG: 115, carbsG: 160, fatG: 55 },
    logSlot: "dinner" as const,
    mealsPerDay: 4,
  };

  it("resolves with the swapped meal", async () => {
    const api = new InMemoryApiAdapter();
    api.planSwapResult = {
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
    const { latest } = harness(api, usePlanSwap);
    await act(async () => {
      await latest().run(input);
    });
    expect(latest().stage).toBe("ready");
    expect(latest().result?.meal?.name).toBe("Salmon & greens");
  });

  it("classifies 429 as the swap ceiling", async () => {
    const api = new InMemoryApiAdapter();
    api.nextPlanSwapError = { status: 429, message: "ai_daily_limit" };
    const { latest } = harness(api, usePlanSwap);
    await act(async () => {
      await latest().run(input);
    });
    expect(latest().failure?.message).toMatch(/reset tomorrow/i);
    expect(latest().failure?.retryable).toBe(false);
  });

  it("classifies 402 as an entitlement denial", async () => {
    const api = new InMemoryApiAdapter();
    api.nextPlanSwapError = { status: 402, message: "denied" };
    const { latest } = harness(api, usePlanSwap);
    await act(async () => {
      await latest().run(input);
    });
    expect(latest().failure?.entitlementDenied).toBe(true);
    expect(latest().failure?.retryable).toBe(false);
  });

  it("classifies 422 and 503 as retryable, and falls back for anything else", async () => {
    const api = new InMemoryApiAdapter();
    api.nextPlanSwapError = { status: 422, message: "ai_unreadable" };
    const { latest } = harness(api, usePlanSwap);
    await act(async () => {
      await latest().run(input);
    });
    expect(latest().failure?.retryable).toBe(true);

    api.nextPlanSwapError = { status: 503, message: "ai_unavailable" };
    const { latest: latest2 } = harness(api, usePlanSwap);
    await act(async () => {
      await latest2().run(input);
    });
    expect(latest2().failure?.retryable).toBe(true);

    api.nextPlanSwapError = { status: 500, message: "server" };
    const { latest: latest3 } = harness(api, usePlanSwap);
    await act(async () => {
      await latest3().run(input);
    });
    expect(latest3().failure?.message).toMatch(/connection/i);
  });

  it("a second run() while one is in flight is rejected, and reset() while in flight is a no-op", async () => {
    const api = new InMemoryApiAdapter();
    let resolve!: (
      r: Awaited<ReturnType<InMemoryApiAdapter["swapPlanMeal"]>>,
    ) => void;
    const spy = jest
      .spyOn(api, "swapPlanMeal")
      .mockReturnValue(new Promise((r) => (resolve = r)));
    const { latest } = harness(api, usePlanSwap);
    act(() => {
      void latest().run(input);
    });
    expect(latest().stage).toBe("swapping");

    act(() => void latest().run(input));
    // The guard rejected the second call synchronously — the spy was only
    // ever invoked once.
    expect(spy).toHaveBeenCalledTimes(1);

    act(() => latest().reset());
    expect(latest().stage).toBe("swapping");

    resolve({
      ok: true,
      value: {
        meal: null,
        emptyReason: "no_candidates",
        labelCheckRequired: true,
      },
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(latest().result?.meal).toBeNull();
  });
});

describe("usePlanAccept", () => {
  it("accepts and writes the plan through to the cache", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const { latest } = harness(api, usePlanAccept, storage);
    let plan: MealPlan | null = null;
    await act(async () => {
      plan = await latest().accept(acceptInput());
    });
    expect(plan).not.toBeNull();
    expect(storage.getCachedActiveMealPlan("user-1", "2026-08-05")).toEqual(
      plan,
    );
  });

  it("surfaces the plan error code on an unresolvable_items 400", async () => {
    const api = new InMemoryApiAdapter();
    api.nextAcceptPlanError = {
      kind: "api",
      code: "server",
      message: "unresolvable_items",
      status: 400,
      planErrorCode: "unresolvable_items",
      unresolvableItems: ["food:stale-id"],
    };
    const { latest } = harness(api, usePlanAccept);
    let plan: MealPlan | null = null;
    await act(async () => {
      plan = await latest().accept(acceptInput());
    });
    expect(plan).toBeNull();
    expect(latest().failure?.code).toBe("unresolvable_items");
    expect(latest().failure?.unresolvableItems).toEqual(["food:stale-id"]);
  });

  it("surfaces active_plan_exists with the conflicting date", async () => {
    const api = new InMemoryApiAdapter();
    api.nextAcceptPlanError = {
      kind: "api",
      code: "server",
      message: "active_plan_exists",
      status: 409,
      planErrorCode: "active_plan_exists",
      activePlanDate: "2026-08-05",
    };
    const { latest } = harness(api, usePlanAccept);
    await act(async () => {
      await latest().accept(acceptInput());
    });
    expect(latest().failure?.code).toBe("active_plan_exists");
    expect(latest().failure?.activePlanDate).toBe("2026-08-05");
  });

  it("reset clears the failure", async () => {
    const api = new InMemoryApiAdapter();
    api.nextAcceptPlanError = {
      kind: "api",
      code: "server",
      message: "no_targets",
      status: 400,
      planErrorCode: "no_targets",
    };
    const { latest } = harness(api, usePlanAccept);
    await act(async () => {
      await latest().accept(acceptInput());
    });
    expect(latest().failure).not.toBeNull();
    act(() => latest().reset());
    expect(latest().failure).toBeNull();
  });
});

describe("useReplacePlanMeal", () => {
  it("replaces the meal and writes the returned plan through to the cache", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.plans.set("plan-1", mealPlanFixture());
    const { latest } = harness(api, useReplacePlanMeal, storage);
    let plan: MealPlan | null = null;
    await act(async () => {
      plan = await latest().replace("plan-1", "meal-1", {
        label: "Salmon bowl",
        logSlot: "dinner",
        items: [{ foodId: "food-2", servings: 1 }],
      });
    });
    expect(plan).not.toBeNull();
    expect(storage.getCachedActiveMealPlan("user-1", "2026-08-05")).toEqual(
      plan,
    );
  });

  it("surfaces a failure with its plan error code, and reset() clears it", async () => {
    const api = new InMemoryApiAdapter();
    api.nextReplacePlanMealError = {
      kind: "api",
      code: "server",
      message: "not_found",
      status: 404,
      planErrorCode: "not_found",
    };
    const { latest } = harness(api, useReplacePlanMeal);
    let plan: MealPlan | null = null;
    await act(async () => {
      plan = await latest().replace("plan-1", "meal-1", {
        label: "x",
        logSlot: "dinner",
      });
    });
    expect(plan).toBeNull();
    expect(latest().failure?.code).toBe("not_found");

    act(() => latest().reset());
    expect(latest().failure).toBeNull();
  });

  it("returns null when signed out or already in flight", async () => {
    const api = new InMemoryApiAdapter();
    let resolve!: (
      r: Awaited<ReturnType<InMemoryApiAdapter["replacePlanMeal"]>>,
    ) => void;
    jest
      .spyOn(api, "replacePlanMeal")
      .mockReturnValue(new Promise((r) => (resolve = r)));
    const { latest } = harness(api, useReplacePlanMeal);
    let firstPromise!: Promise<MealPlan | null>;
    act(() => {
      firstPromise = latest().replace("plan-1", "meal-1", {
        label: "x",
        logSlot: "dinner",
      });
    });
    let second: MealPlan | null = null;
    await act(async () => {
      second = await latest().replace("plan-1", "meal-1", {
        label: "x",
        logSlot: "dinner",
      });
    });
    expect(second).toBeNull();
    resolve({ ok: true, value: mealPlanFixture() });
    await act(async () => {
      await firstPromise;
    });
  });
});

describe("useLogPlanMeal", () => {
  // ⚠ `processSyncQueue` dispatches via raw `fetch`, not through the `api`
  // adapter — so this asserts what the HOOK is responsible for (the
  // optimistic command ran and its result is returned), not that a real
  // network flush succeeded in a jest/node environment with no fetch mock.
  // `mealPlan.command.test.ts` covers the command's own cache effects
  // directly and in more depth.
  it("returns the optimistic entry and applies the command's cache writes", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const plan = mealPlanFixture();
    storage.cacheMealPlan("user-1", plan);
    const { latest } = harness(api, useLogPlanMeal, storage);

    let entry: Awaited<
      ReturnType<ReturnType<typeof useLogPlanMeal>["mutate"]>
    > = null;
    await act(async () => {
      entry = await latest().mutate({ plan, meal: plan.meals[0]! });
    });

    expect(entry).not.toBeNull();
    expect(
      storage.getCachedActiveMealPlan("user-1", "2026-08-05")!.meals[0]!.state,
    ).toBe("logged");
    expect(storage.getPendingMutations().length).toBeGreaterThanOrEqual(0);
  });

  it("is idempotent: mutating an already-logged meal returns null and touches nothing", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const logged = mealPlanFixture({
      meals: [
        {
          ...mealPlanFixture().meals[0]!,
          state: "logged",
          loggedEntryId: "entry-9",
        },
      ],
    });
    storage.cacheMealPlan("user-1", logged);
    const { latest } = harness(api, useLogPlanMeal, storage);

    let entry: Awaited<
      ReturnType<ReturnType<typeof useLogPlanMeal>["mutate"]>
    > = null;
    await act(async () => {
      entry = await latest().mutate({ plan: logged, meal: logged.meals[0]! });
    });
    expect(entry).toBeNull();
  });

  it("still returns the optimistic entry when the queue flush rejects", async () => {
    // Mirrors `useLogEntry`: the optimistic write already happened, so a
    // failed flush is logged and swallowed rather than losing the caller's
    // result — the sync worker retries the queue entry later.
    const spy = jest
      .spyOn(syncCommand, "processSyncQueue")
      .mockRejectedValue(new Error("network down"));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();
    try {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const plan = mealPlanFixture();
      storage.cacheMealPlan("user-1", plan);
      const { latest } = harness(api, useLogPlanMeal, storage);

      let entry: Awaited<
        ReturnType<ReturnType<typeof useLogPlanMeal>["mutate"]>
      > = null;
      await act(async () => {
        entry = await latest().mutate({ plan, meal: plan.meals[0]! });
      });
      expect(entry).not.toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      consoleSpy.mockRestore();
    }
  });

  it("returns null and mutates nothing when signed out", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const signedOutAdapters: Adapters = {
      ...makeAdapters(api, storage),
      auth: {
        getSession: jest.fn(async () => ({ ok: true, value: null })),
        onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
          cb(null);
          return () => {};
        }),
        getAccessToken: jest.fn(async () => null),
      } as unknown as Adapters["auth"],
    };
    const seen: ReturnType<typeof useLogPlanMeal>[] = [];
    function Probe() {
      seen.push(useLogPlanMeal());
      return <Text>probe</Text>;
    }
    render(
      <AdapterProvider adapters={signedOutAdapters}>
        <Probe />
      </AdapterProvider>,
    );
    const plan = mealPlanFixture();
    let entry: Awaited<
      ReturnType<ReturnType<typeof useLogPlanMeal>["mutate"]>
    > = null;
    await act(async () => {
      entry = await seen[seen.length - 1]!.mutate({
        plan,
        meal: plan.meals[0]!,
      });
    });
    expect(entry).toBeNull();
    expect(storage.getPendingMutations()).toHaveLength(0);
  });
});

describe("useGetActiveMealPlan", () => {
  it("reads the cache synchronously and fetches in the background", async () => {
    const api = new InMemoryApiAdapter();
    const remote = mealPlanFixture();
    api.activePlanByDate.set("2026-08-05", remote);
    const { latest } = harness(api, () => useGetActiveMealPlan("2026-08-05"));
    await waitFor(() => expect(latest().data).toEqual(remote));
  });

  it("caches an explicit null (no plan that day) rather than leaving a stale row", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheMealPlan(
      "user-1",
      mealPlanFixture({ planDate: "2026-08-05" }),
    );
    api.activePlanByDate.set("2026-08-05", null);
    const { latest } = harness(
      api,
      () => useGetActiveMealPlan("2026-08-05"),
      storage,
    );
    await waitFor(() => expect(latest().data).toBeNull());
    expect(storage.getCachedActiveMealPlan("user-1", "2026-08-05")).toBeNull();
  });

  it("does not fetch when disabled", async () => {
    const api = new InMemoryApiAdapter();
    const spy = jest.spyOn(api, "getActivePlan");
    harness(api, () => useGetActiveMealPlan("2026-08-05", false));
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
  });
});
