/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ⚠ `vi.hoisted` is required, not stylistic. ES imports are hoisted above plain
 * `const` declarations, and `mealPlanService.ts` constructs its repository at
 * MODULE LOAD (`.decorate("MealPlanRepository", new MealPlanRepository())`). So
 * importing the handler runs the mock factory before a plain const would exist,
 * and the suite dies at collection with "Cannot access 'planMocks' before
 * initialization" — no tests run at all.
 */
const { planMocks, candidateMocks, prefMocks, targetMocks } = vi.hoisted(
  () => ({
    planMocks: {
      create: vi.fn(),
      get: vi.fn(),
      getActiveForDate: vi.fn(),
      listRecent: vi.fn(),
      archive: vi.fn(),
      redate: vi.fn(),
      remove: vi.fn(),
    },
    candidateMocks: { resolveByIds: vi.fn() },
    prefMocks: { get: vi.fn() },
    targetMocks: { get: vi.fn() },
  }),
);

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (h: string | undefined) =>
    !h || !h.startsWith("Bearer ")
      ? null
      : { sub: "test-user-id", email: "t@e.com", iat: 0, exp: 9999999999 },
  ),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "test-user-id" }),
}));

vi.mock("../../../../repositories/mealPlanRepository", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../repositories/mealPlanRepository")
  >("../../../../repositories/mealPlanRepository");
  return {
    ...actual,
    MealPlanRepository: vi.fn().mockImplementation(() => planMocks),
  };
});
vi.mock("../../../../repositories/mealprintCandidateRepository", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../repositories/mealprintCandidateRepository")
  >("../../../../repositories/mealprintCandidateRepository");
  return {
    ...actual,
    MealprintCandidateRepository: vi
      .fn()
      .mockImplementation(() => candidateMocks),
  };
});
vi.mock("../../../../repositories/nutritionPreferenceRepository", () => ({
  NutritionPreferenceRepository: vi.fn().mockImplementation(() => prefMocks),
}));
vi.mock("../../../../repositories/nutritionTargetRepository", () => ({
  NutritionTargetRepository: vi.fn().mockImplementation(() => targetMocks),
}));

import { nutritionPlansCreateHandler } from "../create/nutritionPlansCreateHandler";
import { nutritionPlansReadHandlers } from "../read/nutritionPlansReadHandlers";
import { ActivePlanExistsError } from "../../../../repositories/mealPlanRepository";

const PREFS = {
  userId: "test-user-id",
  dietaryPatterns: [] as string[],
  avoidAllergens: [] as string[],
  avoidFoods: [] as string[],
  likedFoods: [] as string[],
  mealsPerDay: 4,
  effortLevel: "balanced" as const,
  locale: "en-GB",
  updatedAt: null,
  isDefault: true,
};

const TARGET = {
  userId: "test-user-id",
  dailyKcal: 2200,
  proteinG: 170,
  carbsG: 240,
  fatG: 70,
  waterCups: 8,
  preset: "maintain",
  setByUserId: null,
  setByName: null,
  updatedAt: null,
};

const FOOD_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECIPE_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PLAN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function food(id: string, over: Record<string, unknown> = {}) {
  return {
    kind: "food" as const,
    id,
    name: "Greek Yogurt",
    kcal: 170,
    proteinG: 17,
    carbsG: 7,
    fatG: 1,
    servingLabel: "170 g",
    allergenTags: [] as string[] | null,
    categoryTags: [] as string[] | null,
    isOwn: false,
    ...over,
  };
}

function postBody(over: Record<string, unknown> = {}) {
  return {
    planDate: "2026-08-05",
    meals: [
      {
        label: "Meal 1 · Breakfast",
        logSlot: "breakfast",
        items: [{ foodId: FOOD_A, servings: 2 }],
      },
    ],
    ...over,
  };
}

function post(body: unknown, auth = true) {
  return new Request("http://localhost/nutrition/plans", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: "Bearer token" } : {}),
    },
  });
}

/**
 * `Response.json()` is typed `unknown` under this tsconfig, so every assertion
 * on a body needs a cast. Centralised here — vitest passes without it while
 * `bun run typecheck` fails, which is the "vitest is not a typecheck" trap.
 */
async function body(res: Response): Promise<any> {
  return res.json();
}

function get(path: string, auth = true) {
  return new Request(`http://localhost${path}`, {
    headers: auth ? { authorization: "Bearer token" } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prefMocks.get.mockResolvedValue(PREFS);
  targetMocks.get.mockResolvedValue(TARGET);
  candidateMocks.resolveByIds.mockResolvedValue([food(FOOD_A)]);
  planMocks.create.mockImplementation(
    async (_userId: string, input: Record<string, unknown>) => ({
      id: PLAN_ID,
      meals: (input.meals as unknown[]) ?? [],
      ...input,
    }),
  );
});

describe("POST /nutrition/plans — the client never sets macros", () => {
  /**
   * ⚠ THE test for this handler. The whole correctness model of a stored plan is
   * that its macros come from the DB, not the request. If this assertion ever
   * has to change, something has gone wrong upstream.
   */
  it("recomputes macros from resolved rows and IGNORES any the client sent", async () => {
    const res = await nutritionPlansCreateHandler.handle(
      post(
        postBody({
          meals: [
            {
              label: "Meal 1",
              logSlot: "breakfast",
              items: [{ foodId: FOOD_A, servings: 2 }],
              // A lie: the resolved food is 170 kcal/serving × 2 = 340.
              kcal: 10,
              proteinG: 0,
            },
          ],
        }),
      ),
    );

    expect(res.status).toBe(200);
    const input = planMocks.create.mock.calls[0]![1];
    expect(input.meals[0].kcal).toBe(340);
    expect(input.meals[0].proteinG).toBe(34);
  });

  it("multiplies a recipe-backed meal by its servings", async () => {
    candidateMocks.resolveByIds.mockResolvedValue([
      { ...food(RECIPE_A), kind: "recipe", kcal: 500, proteinG: 40 },
    ]);

    await nutritionPlansCreateHandler.handle(
      post(
        postBody({
          meals: [
            {
              label: "Chilli",
              logSlot: "dinner",
              recipeId: RECIPE_A,
              servings: 1.5,
            },
          ],
        }),
      ),
    );

    const input = planMocks.create.mock.calls[0]![1];
    expect(input.meals[0].kcal).toBe(750);
    expect(input.meals[0].proteinG).toBe(60);
  });

  it("snapshots the targets and preferences rather than leaving them to read time", async () => {
    await nutritionPlansCreateHandler.handle(post(postBody()));

    const input = planMocks.create.mock.calls[0]![1];
    expect(input.targetKcal).toBe(2200);
    expect(input.targetProteinG).toBe(170);
    expect(input.mealsPerDay).toBe(4);
    expect(input.effortLevel).toBe("balanced");
  });

  it("assigns sortOrder server-side, ignoring client ordering", async () => {
    await nutritionPlansCreateHandler.handle(
      post(
        postBody({
          meals: [
            {
              label: "a",
              logSlot: "breakfast",
              items: [{ foodId: FOOD_A, servings: 1 }],
            },
            {
              label: "b",
              logSlot: "lunch",
              items: [{ foodId: FOOD_A, servings: 1 }],
            },
          ],
        }),
      ),
    );

    const input = planMocks.create.mock.calls[0]![1];
    expect(input.meals.map((m: any) => m.sortOrder)).toEqual([0, 1]);
  });

  it("401s without a bearer token", async () => {
    const res = await nutritionPlansCreateHandler.handle(
      post(postBody(), false),
    );
    expect(res.status).toBe(401);
  });

  it("400s with no targets, before resolving anything", async () => {
    targetMocks.get.mockResolvedValue(null);
    const res = await nutritionPlansCreateHandler.handle(post(postBody()));

    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("no_targets");
    expect(candidateMocks.resolveByIds).not.toHaveBeenCalled();
  });

  it("400s listing EVERY unresolvable id, not just the first", async () => {
    candidateMocks.resolveByIds.mockResolvedValue([]);
    const res = await nutritionPlansCreateHandler.handle(
      post(
        postBody({
          meals: [
            {
              label: "a",
              logSlot: "breakfast",
              items: [{ foodId: FOOD_A, servings: 1 }],
            },
            { label: "b", logSlot: "dinner", recipeId: RECIPE_A },
          ],
        }),
      ),
    );

    expect(res.status).toBe(400);
    const parsed = await body(res);
    expect(parsed.error).toBe("unresolvable_items");
    expect(parsed.items).toEqual(
      expect.arrayContaining([`food:${FOOD_A}`, `recipe:${RECIPE_A}`]),
    );
    expect(planMocks.create).not.toHaveBeenCalled();
  });

  it("422s rather than silently dropping a meal that now breaches an allergen", async () => {
    // A draft generated before the user added a milk chip.
    prefMocks.get.mockResolvedValue({ ...PREFS, avoidAllergens: ["milk"] });
    candidateMocks.resolveByIds.mockResolvedValue([
      food(FOOD_A, { allergenTags: ["en:milk"] }),
    ]);

    const res = await nutritionPlansCreateHandler.handle(post(postBody()));

    expect(res.status).toBe(422);
    expect((await body(res)).error).toBe("avoidance_violation");
    // ⚠ The point: nothing was persisted. A filtered-and-saved plan would be
    // worse than a refusal.
    expect(planMocks.create).not.toHaveBeenCalled();
  });

  it("409s when the day already has an active plan", async () => {
    planMocks.create.mockRejectedValue(new ActivePlanExistsError("2026-08-05"));
    const res = await nutritionPlansCreateHandler.handle(post(postBody()));

    expect(res.status).toBe(409);
    expect((await body(res)).error).toBe("active_plan_exists");
  });

  it("rejects a body with no meals", async () => {
    const res = await nutritionPlansCreateHandler.handle(
      post(postBody({ meals: [] })),
    );
    expect(res.status).toBe(422);
  });
});

describe("plan reads — route ordering and ownership", () => {
  /**
   * ⚠ This asserts the OUTCOME, not the declaration order. Swapping the two
   * `.get` declarations was tried and every test here still passed — Elysia's
   * radix router prefers a static segment over a dynamic one regardless of
   * order, so `active` is never captured as an `:id`. A test named "order
   * matters" would therefore be unfailable. This one still earns its place: it
   * proves `active` reaches the active handler and not the id handler, which is
   * the behaviour a future refactor could genuinely break (e.g. by moving these
   * onto separate Elysia instances mounted in the wrong order).
   */
  it("routes /plans/active to the active handler, never to the :id handler", async () => {
    planMocks.getActiveForDate.mockResolvedValue(null);
    const res = await nutritionPlansReadHandlers.handle(
      get("/nutrition/plans/active?date=2026-08-05"),
    );

    expect(res.status).toBe(200);
    expect(planMocks.getActiveForDate).toHaveBeenCalledWith(
      "test-user-id",
      "2026-08-05",
    );
    expect(planMocks.get).not.toHaveBeenCalled();
  });

  it("returns 200 with null when there is no plan for the day", async () => {
    planMocks.getActiveForDate.mockResolvedValue(null);
    const res = await nutritionPlansReadHandlers.handle(
      get("/nutrition/plans/active?date=2026-08-05"),
    );

    expect(res.status).toBe(200);
    expect((await body(res)).data).toBeNull();
  });

  it("requires the date query param rather than guessing the server day", async () => {
    const res = await nutritionPlansReadHandlers.handle(
      get("/nutrition/plans/active"),
    );
    expect(res.status).toBe(422);
  });

  it("404s a plan id that is not the caller's", async () => {
    planMocks.get.mockResolvedValue(null);
    const res = await nutritionPlansReadHandlers.handle(
      get(`/nutrition/plans/${PLAN_ID}`),
    );

    expect(res.status).toBe(404);
    // A 403 would confirm the plan exists.
    expect((await body(res)).error).toBe("not_found");
  });

  it("passes the caller's id to every read", async () => {
    planMocks.listRecent.mockResolvedValue([]);
    await nutritionPlansReadHandlers.handle(get("/nutrition/plans"));
    expect(planMocks.listRecent).toHaveBeenCalledWith("test-user-id", 30);
  });

  it("401s an unauthenticated read", async () => {
    const res = await nutritionPlansReadHandlers.handle(
      get("/nutrition/plans", false),
    );
    expect(res.status).toBe(401);
  });
});

describe("PATCH /nutrition/plans/:id", () => {
  function patch(body: unknown) {
    return new Request(`http://localhost/nutrition/plans/${PLAN_ID}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        authorization: "Bearer token",
      },
    });
  }

  it("archives when status is archived", async () => {
    planMocks.archive.mockResolvedValue({ id: PLAN_ID });
    const res = await nutritionPlansReadHandlers.handle(
      patch({ status: "archived" }),
    );

    expect(res.status).toBe(200);
    expect(planMocks.archive).toHaveBeenCalledWith("test-user-id", PLAN_ID);
    expect(planMocks.redate).not.toHaveBeenCalled();
  });

  it("re-dates when planDate is supplied", async () => {
    planMocks.redate.mockResolvedValue({ id: PLAN_ID });
    const res = await nutritionPlansReadHandlers.handle(
      patch({ planDate: "2026-08-09" }),
    );

    expect(res.status).toBe(200);
    expect(planMocks.redate).toHaveBeenCalledWith(
      "test-user-id",
      PLAN_ID,
      "2026-08-09",
    );
  });

  it("409s rather than overwriting an occupied day", async () => {
    planMocks.redate.mockRejectedValue(new ActivePlanExistsError("2026-08-09"));
    const res = await nutritionPlansReadHandlers.handle(
      patch({ planDate: "2026-08-09" }),
    );

    expect(res.status).toBe(409);
    expect((await body(res)).planDate).toBe("2026-08-09");
  });

  it("rejects an empty patch body", async () => {
    const res = await nutritionPlansReadHandlers.handle(patch({}));
    expect(res.status).toBe(422);
  });
});

describe("DELETE /nutrition/plans/:id", () => {
  it("404s a foreign id", async () => {
    planMocks.remove.mockResolvedValue(false);
    const res = await nutritionPlansReadHandlers.handle(
      new Request(`http://localhost/nutrition/plans/${PLAN_ID}`, {
        method: "DELETE",
        headers: { authorization: "Bearer token" },
      }),
    );

    expect(res.status).toBe(404);
  });

  it("deletes and reports success", async () => {
    planMocks.remove.mockResolvedValue(true);
    const res = await nutritionPlansReadHandlers.handle(
      new Request(`http://localhost/nutrition/plans/${PLAN_ID}`, {
        method: "DELETE",
        headers: { authorization: "Bearer token" },
      }),
    );

    expect(res.status).toBe(200);
    expect((await body(res)).data.deleted).toBe(true);
  });
});
