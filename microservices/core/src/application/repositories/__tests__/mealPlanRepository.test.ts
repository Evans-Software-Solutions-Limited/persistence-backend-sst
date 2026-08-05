/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";
import {
  ActivePlanExistsError,
  MealPlanRepository,
} from "../mealPlanRepository";

/**
 * Mealprint plan repository (spec-26 Phase 2).
 *
 * ⚠ **These tests render predicates through `PgDialect` rather than asserting
 * "a where clause ran".** This repo has shipped runtime-only SQL bugs past a
 * green mocked suite twice (`reference_drizzle_groupby_param_bug`), and this
 * file contains the exact high-risk construct: `markMealLogged` /
 * `markMealSkipped` / `replaceMeal` enforce ownership through a raw
 * `sql\`EXISTS (...)\`` correlated subquery against `meal_plans`, because
 * `meal_plan_meals` carries no `user_id` of its own. If that subquery renders
 * without its params — or is dropped entirely — the mock still resolves and the
 * suite still passes, while in production one user can mutate another's planned
 * meals. So the assertions below pin the rendered SQL and the params.
 */

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER_USER = "22222222-2222-2222-2222-222222222222";
const PLAN = "33333333-3333-3333-3333-333333333333";
const MEAL = "44444444-4444-4444-4444-444444444444";
const ENTRY = "55555555-5555-5555-5555-555555555555";

interface Capture {
  wheres: unknown[];
  inserted: unknown[];
  updated: unknown[];
  calls: string[];
}

/**
 * Chainable Drizzle stub. Every terminal (`returning`, `limit`, or awaiting the
 * builder itself) shifts the next queued result, so a test declares results in
 * call order.
 */
function makeDb(queue: unknown[], capture: Capture) {
  let i = 0;
  const next = () => (i < queue.length ? queue[i++] : []);

  const builder: any = {};
  const record = (name: string) => capture.calls.push(name);

  builder.insert = vi.fn(() => (record("insert"), builder));
  builder.update = vi.fn(() => (record("update"), builder));
  builder.delete = vi.fn(() => (record("delete"), builder));
  builder.select = vi.fn(() => (record("select"), builder));
  builder.from = vi.fn(() => builder);
  builder.orderBy = vi.fn(() => builder);
  builder.values = vi.fn((v: unknown) => (capture.inserted.push(v), builder));
  builder.set = vi.fn((v: unknown) => (capture.updated.push(v), builder));
  builder.where = vi.fn((c: unknown) => (capture.wheres.push(c), builder));
  builder.returning = vi.fn(() => Promise.resolve(next()));
  builder.limit = vi.fn(() => Promise.resolve(next()));
  // Awaiting a builder with no explicit terminal (hydrate's meals query,
  // listByGroup) resolves the next queued result.
  builder.then = (resolve: (v: unknown) => unknown) => resolve(next());

  return builder;
}

function planRow(over: Record<string, unknown> = {}) {
  return {
    id: PLAN,
    userId: USER,
    status: "active",
    planDate: "2026-08-05",
    groupId: null,
    mealsPerDay: 4,
    effortLevel: "balanced",
    targetKcal: "2400.5",
    targetProteinG: "180",
    targetCarbsG: "240",
    targetFatG: "70",
    source: "ai",
    createdByUserId: null,
    createdAt: new Date("2026-08-04T10:00:00.000Z"),
    acceptedAt: new Date("2026-08-04T10:00:01.000Z"),
    ...over,
  };
}

function mealRow(over: Record<string, unknown> = {}) {
  return {
    id: MEAL,
    planId: PLAN,
    sortOrder: 1,
    label: "Meal 1 · Breakfast",
    logSlot: "breakfast",
    recipeId: null,
    mealId: null,
    items: [{ foodId: "f1", servings: 2 }],
    kcal: "500.25",
    proteinG: "40",
    carbsG: "50",
    fatG: "12",
    aiReason: "hits your protein",
    state: "planned",
    loggedEntryId: null,
    ...over,
  };
}

function render(cond: unknown) {
  return new PgDialect().sqlToQuery(cond as never);
}

let capture: Capture;
let repo: MealPlanRepository;

beforeEach(() => {
  capture = { wheres: [], inserted: [], updated: [], calls: [] };
  repo = new MealPlanRepository();
  vi.clearAllMocks();
});

function useDb(queue: unknown[]) {
  vi.mocked(getDb).mockReturnValue(makeDb(queue, capture) as never);
}

describe("ownership — every read and mutate is scoped to the caller", () => {
  it("get() filters on BOTH user_id and plan id", async () => {
    useDb([[planRow()], [mealRow()]]);
    await repo.get(USER, PLAN);

    const q = render(capture.wheres[0]);
    expect(q.sql).toContain("user_id");
    expect(q.sql).toContain('"id"');
    expect(q.params).toEqual([USER, PLAN]);
  });

  it("get() returns null when the row belongs to someone else", async () => {
    // The WHERE excludes it, so Postgres returns nothing.
    useDb([[]]);
    await expect(repo.get(OTHER_USER, PLAN)).resolves.toBeNull();
  });

  it("remove() scopes the DELETE by user_id, not just the plan id", async () => {
    useDb([[{ id: PLAN }]]);
    await expect(repo.remove(USER, PLAN)).resolves.toBe(true);

    const q = render(capture.wheres[0]);
    expect(q.params).toEqual([USER, PLAN]);
  });

  it("remove() reports false for a foreign id so the handler can 404", async () => {
    useDb([[]]);
    await expect(repo.remove(OTHER_USER, PLAN)).resolves.toBe(false);
  });
});

describe("markMealLogged — the correlated-subquery ownership guard", () => {
  /**
   * ⚠ THE test in this file. `meal_plan_meals` has no `user_id`; ownership is
   * enforced only by the EXISTS subquery against `meal_plans`. Deleting that
   * line leaves every assertion below except these passing.
   */
  it("renders an EXISTS subquery against meal_plans carrying the caller's id", async () => {
    useDb([[{ id: MEAL }]]);
    await expect(repo.markMealLogged(USER, PLAN, MEAL, ENTRY)).resolves.toBe(
      true,
    );

    const q = render(capture.wheres[0]);
    expect(q.sql).toContain("EXISTS");
    expect(q.sql).toContain("meal_plans");
    // The caller's id must reach the query as a PARAM. The bug class this
    // guards is an interpolation that renders the subquery but loses its
    // binding, which would make the EXISTS unconditionally true.
    expect(q.params).toContain(USER);
    expect(q.params).toContain(PLAN);
    expect(q.params).toContain(MEAL);
  });

  it("refuses to re-log an already-logged meal, so a double tap cannot create two entries", async () => {
    useDb([[{ id: MEAL }]]);
    await repo.markMealLogged(USER, PLAN, MEAL, ENTRY);

    const q = render(capture.wheres[0]);
    expect(q.sql).toContain("<> 'logged'");
  });

  it("returns false when zero rows match, which is how the handler learns not to log", async () => {
    useDb([[]]);
    await expect(
      repo.markMealLogged(OTHER_USER, PLAN, MEAL, ENTRY),
    ).resolves.toBe(false);
  });

  it("writes both the state flip and the entry link", async () => {
    useDb([[{ id: MEAL }]]);
    await repo.markMealLogged(USER, PLAN, MEAL, ENTRY);
    expect(capture.updated[0]).toEqual({
      state: "logged",
      loggedEntryId: ENTRY,
    });
  });

  it("markMealSkipped carries the same EXISTS guard", async () => {
    useDb([[{ id: MEAL }]]);
    await repo.markMealSkipped(USER, PLAN, MEAL);

    const q = render(capture.wheres[0]);
    expect(q.sql).toContain("EXISTS");
    expect(q.params).toContain(USER);
  });
});

describe("replaceMeal — a swapped meal must not keep a stale log link", () => {
  it("resets state to planned and clears loggedEntryId", async () => {
    useDb([[{ id: MEAL }], [planRow()], [mealRow()]]);
    await repo.replaceMeal(USER, PLAN, MEAL, {
      label: "Meal 1 · Omelette",
      logSlot: "breakfast",
      kcal: 420,
      proteinG: 35,
      carbsG: 8,
      fatG: 26,
    });

    expect(capture.updated[0]).toMatchObject({
      state: "planned",
      loggedEntryId: null,
    });
  });

  it("is ownership-guarded and returns null for a foreign plan", async () => {
    useDb([[]]);
    await expect(
      repo.replaceMeal(OTHER_USER, PLAN, MEAL, {
        label: "x",
        logSlot: "snack",
        kcal: 1,
        proteinG: 1,
        carbsG: 1,
        fatG: 1,
      }),
    ).resolves.toBeNull();

    expect(render(capture.wheres[0]).sql).toContain("EXISTS");
  });
});

describe("create — the active-per-date constraint is translated, not swallowed", () => {
  const input = {
    planDate: "2026-08-05",
    mealsPerDay: 2,
    effortLevel: "balanced" as const,
    targetKcal: 2000,
    targetProteinG: 150,
    targetCarbsG: 200,
    targetFatG: 60,
    meals: [
      {
        sortOrder: 1,
        label: "Meal 1",
        logSlot: "breakfast" as const,
        kcal: 500,
        proteinG: 40,
        carbsG: 50,
        fatG: 12,
      },
    ],
  };

  it("persists as ACTIVE with an acceptedAt, never as draft", async () => {
    useDb([[planRow()], [mealRow()]]);
    await repo.create(USER, input);

    const values = capture.inserted[0] as Record<string, unknown>;
    expect(values.status).toBe("active");
    expect(values.acceptedAt).toBeInstanceOf(Date);
    expect(values.userId).toBe(USER);
  });

  it("maps a unique violation on the active-per-date index to ActivePlanExistsError", async () => {
    const conflict = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint_name: "meal_plans_one_active_per_date",
    });
    const db: any = makeDb([], capture);
    db.returning = vi.fn(() => Promise.reject(conflict));
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(repo.create(USER, input)).rejects.toBeInstanceOf(
      ActivePlanExistsError,
    );
  });

  it("does NOT mislabel a different unique violation as a duplicate plan", async () => {
    // A primary-key collision is also 23505. Reporting "you already have a plan
    // today" for it would send the client down a wrong recovery path.
    const other = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint_name: "meal_plans_pkey",
    });
    const db: any = makeDb([], capture);
    db.returning = vi.fn(() => Promise.reject(other));
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(repo.create(USER, input)).rejects.not.toBeInstanceOf(
      ActivePlanExistsError,
    );
  });

  it("skips the meals INSERT entirely when there are no meals", async () => {
    useDb([[planRow()]]);
    const result = await repo.create(USER, { ...input, meals: [] });

    expect(result.meals).toEqual([]);
    // One insert only — the plan. A second would send `VALUES ()`.
    expect(capture.calls.filter((c) => c === "insert")).toHaveLength(1);
  });

  it("stringifies numerics for the numeric columns", async () => {
    useDb([[planRow()], [mealRow()]]);
    await repo.create(USER, input);

    const values = capture.inserted[0] as Record<string, unknown>;
    expect(values.targetKcal).toBe("2000");
    const meals = capture.inserted[1] as Record<string, unknown>[];
    expect(meals[0]!.kcal).toBe("500");
  });
});

describe("hydrate — the empty-IN guard", () => {
  it("does not fire a meals query when there are no plans, because IN () is a syntax error", async () => {
    useDb([[]]);
    await expect(repo.listRecent(USER)).resolves.toEqual([]);

    // A single select (the plans query). A second would render `IN ()`.
    expect(capture.calls.filter((c) => c === "select")).toHaveLength(1);
  });

  it("groups meals under their own plan and sorts by sortOrder", async () => {
    const second = "66666666-6666-6666-6666-666666666666";
    useDb([
      [planRow(), planRow({ id: second, planDate: "2026-08-04" })],
      [
        mealRow({ id: "b", sortOrder: 2, label: "second" }),
        mealRow({ id: "a", sortOrder: 1, label: "first" }),
        mealRow({ id: "c", planId: second, sortOrder: 1, label: "other plan" }),
      ],
    ]);

    const plans = await repo.listRecent(USER);
    expect(plans).toHaveLength(2);
    expect(plans[0]!.meals.map((m) => m.label)).toEqual(["first", "second"]);
    expect(plans[1]!.meals.map((m) => m.label)).toEqual(["other plan"]);
  });
});

describe("DTO mapping", () => {
  it("coerces numeric strings to numbers and dates to ISO strings", async () => {
    useDb([[planRow()], [mealRow()]]);
    const plan = (await repo.get(USER, PLAN))!;

    expect(plan.targetKcal).toBe(2400.5);
    expect(plan.targetProteinG).toBe(180);
    expect(plan.createdAt).toBe("2026-08-04T10:00:00.000Z");
    expect(plan.meals[0]!.kcal).toBe(500.25);
    expect(plan.meals[0]!.items).toEqual([{ foodId: "f1", servings: 2 }]);
  });

  it("tolerates a null createdAt and null items", async () => {
    useDb([
      [planRow({ createdAt: null, acceptedAt: null })],
      [mealRow({ items: null })],
    ]);
    const plan = (await repo.get(USER, PLAN))!;

    expect(plan.createdAt).toBeNull();
    expect(plan.acceptedAt).toBeNull();
    expect(plan.meals[0]!.items).toBeNull();
  });
});

describe("getActiveForDate — an archived plan must not shadow the active one", () => {
  it("scopes on status = active as well as the date", async () => {
    useDb([[planRow()], [mealRow()]]);
    await repo.getActiveForDate(USER, "2026-08-05");

    const q = render(capture.wheres[0]);
    expect(q.params).toEqual([USER, "2026-08-05", "active"]);
  });
});

describe("redate — must not silently overwrite an occupied day", () => {
  it("surfaces ActivePlanExistsError rather than archiving the incumbent", async () => {
    const conflict = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint_name: "meal_plans_one_active_per_date",
    });
    const db: any = makeDb([], capture);
    db.returning = vi.fn(() => Promise.reject(conflict));
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(repo.redate(USER, PLAN, "2026-08-09")).rejects.toBeInstanceOf(
      ActivePlanExistsError,
    );
  });

  it("returns null for a foreign plan id", async () => {
    useDb([[]]);
    await expect(
      repo.redate(OTHER_USER, PLAN, "2026-08-09"),
    ).resolves.toBeNull();
  });
});
