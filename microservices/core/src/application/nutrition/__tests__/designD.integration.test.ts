/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import Elysia from "elysia";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@persistence/db/schema";
import { USER_A, USER_B, resetNutritionSchema } from "./nutritionTestDb";

/**
 * Design D (PER-109) tests 3 and 4, plus two-user isolation, end to end:
 * the real handlers and repositories against a real Postgres carrying the
 * shipped migrations. Only the Supabase JWT check is stubbed — "Bearer A" is
 * user A, "Bearer B" is user B.
 */

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@persistence/api-utils/auth/supabaseAuth", () => {
  const users: Record<string, string> = {
    "Bearer A": "00000000-0000-4000-8000-00000000000a",
    "Bearer B": "00000000-0000-4000-8000-00000000000b",
  };
  return {
    getAuthUser: vi.fn(async (h: string | undefined) =>
      h && users[h]
        ? { sub: users[h], email: "t@e.com", iat: 0, exp: 9999999999 }
        : null,
    ),
    requireAuth: vi.fn((ctx: any) => {
      if (!ctx.user) {
        ctx.set.status = 401;
        return { message: "Unauthorized" };
      }
    }),
    getUser: vi.fn((ctx: any) => ctx.user),
  };
});

import { getDb } from "@persistence/db/client";
import { nutritionEntriesCreateHandler } from "../entries/create/nutritionEntriesCreateHandler";
import { nutritionEntriesBatchHandler } from "../entries/batch/nutritionEntriesBatchHandler";
import { nutritionEntriesListHandler } from "../entries/list/nutritionEntriesListHandler";
import { nutritionEntriesUpdateHandler } from "../entries/update/nutritionEntriesUpdateHandler";
import { nutritionEntriesDeleteHandler } from "../entries/delete/nutritionEntriesDeleteHandler";
import { nutritionTodayHandler } from "../today/nutritionTodayHandler";
import { nutritionUserMealsGetHandler } from "../userMeals/get/nutritionUserMealsGetHandler";
import { nutritionUserMealsPutHandler } from "../userMeals/put/nutritionUserMealsPutHandler";
import { NutritionEntryRepository } from "../../repositories/nutritionEntryRepository";

const app = new Elysia()
  .use(nutritionTodayHandler)
  .use(nutritionEntriesListHandler)
  .use(nutritionEntriesCreateHandler)
  .use(nutritionEntriesUpdateHandler)
  .use(nutritionEntriesDeleteHandler)
  .use(nutritionEntriesBatchHandler)
  .use(nutritionUserMealsGetHandler)
  .use(nutritionUserMealsPutHandler);

type Who = "A" | "B";
const DAY = "2026-11-20";

async function call(
  who: Who,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: any }> {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        authorization: `Bearer ${who}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
  const text = await res.text();
  try {
    return { status: res.status, json: text ? JSON.parse(text) : null };
  } catch {
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
}

/** The exact body a 1.2.0 phone queues for a one-off log (no userMealId). */
function oldShapeEntry(over: Record<string, unknown> = {}) {
  return {
    mealSlot: "lunch",
    servings: 1,
    kcal: 450,
    proteinG: 30,
    carbsG: 50,
    fatG: 12,
    customName: "Chicken wrap",
    loggedAt: `${DAY}T12:30:00.000Z`,
    ...over,
  };
}

async function entryCount(userId: string): Promise<number> {
  const res = await pg.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM nutrition_entries WHERE user_id = $1`,
    [userId],
  );
  return res.rows[0]!.n;
}

async function userMeals(who: Who): Promise<any[]> {
  const res = await call(who, "GET", "/nutrition/user-meals");
  expect(res.status).toBe(200);
  return res.json.data.meals;
}

let pg: PGlite;

beforeAll(async () => {
  pg = await PGlite.create();
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await resetNutritionSchema(pg);
  vi.mocked(getDb).mockReturnValue(drizzle(pg, { schema }) as never);
});

describe("Design D test 3 — replay", () => {
  it("an old-shape POST /nutrition/entries sent twice with the same Idempotency-Key creates one entry", async () => {
    const key = "local-1732100000000-ab12cd-1732100000123-x7k2p9qz";
    const first = await call(
      "A",
      "POST",
      "/nutrition/entries",
      oldShapeEntry(),
      {
        "Idempotency-Key": key,
      },
    );
    const replay = await call(
      "A",
      "POST",
      "/nutrition/entries",
      oldShapeEntry(),
      { "Idempotency-Key": key },
    );

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.json).toEqual(first.json);
    expect(await entryCount(USER_A)).toBe(1);
  });

  it("concurrent retries of one key still create one entry", async () => {
    const key = "local-race-1";
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        call("A", "POST", "/nutrition/entries", oldShapeEntry(), {
          "Idempotency-Key": key,
        }),
      ),
    );
    const ids = new Set(results.map((r) => r.json.data.id));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(ids.size).toBe(1);
    expect(await entryCount(USER_A)).toBe(1);
  });

  it("without a key, behaves exactly as before: each POST is a new entry", async () => {
    await call("A", "POST", "/nutrition/entries", oldShapeEntry());
    await call("A", "POST", "/nutrition/entries", oldShapeEntry());
    expect(await entryCount(USER_A)).toBe(2);
  });

  it("a replay returns the committed entry even if its food has since been deleted", async () => {
    const food = await pg.query<{ id: string }>(
      `INSERT INTO foods (name, kcal, protein_g, carbs_g, fat_g, serving_size, serving_unit, source, created_by)
       VALUES ('Oats', 150, 5, 27, 3, 40, 'g', 'user', $1) RETURNING id`,
      [USER_A],
    );
    const body = oldShapeEntry({
      foodId: food.rows[0]!.id,
      kcal: undefined,
      proteinG: undefined,
      carbsG: undefined,
      fatG: undefined,
      customName: undefined,
    });
    const headers = { "Idempotency-Key": "local-oats-1" };
    const first = await call("A", "POST", "/nutrition/entries", body, headers);
    expect(first.status).toBe(201);
    await pg.query(`DELETE FROM foods WHERE id = $1`, [food.rows[0]!.id]);

    const replay = await call("A", "POST", "/nutrition/entries", body, headers);
    expect(replay.status).toBe(201);
    expect(replay.json.data.id).toBe(first.json.data.id);
    expect(replay.json.data.kcal).toBe(150);
  });

  it("a batch re-sent after a lost response doesn't duplicate", async () => {
    const batch = {
      entries: [
        { ...oldShapeEntry({ customName: "Eggs" }), clientRequestId: "b-1" },
        { ...oldShapeEntry({ customName: "Toast" }), clientRequestId: "b-2" },
        { ...oldShapeEntry({ customName: "Tea" }), clientRequestId: "b-3" },
      ],
    };
    const first = await call("A", "POST", "/nutrition/entries/batch", batch);
    const resent = await call("A", "POST", "/nutrition/entries/batch", batch);

    expect(first.status).toBe(200);
    expect(resent.status).toBe(200);
    expect(resent.json.data.results.map((r: any) => r.entry.id)).toEqual(
      first.json.data.results.map((r: any) => r.entry.id),
    );
    expect(await entryCount(USER_A)).toBe(3);
  });

  it("a part-sent batch can be re-sent safely: committed entries come back, the rest are created", async () => {
    const all = ["p-1", "p-2", "p-3"].map((k, i) => ({
      ...oldShapeEntry({ customName: `Item ${i}` }),
      clientRequestId: k,
    }));
    const partial = await call("A", "POST", "/nutrition/entries/batch", {
      entries: all.slice(0, 2),
    });
    const full = await call("A", "POST", "/nutrition/entries/batch", {
      entries: all,
    });

    const partialIds = partial.json.data.results.map((r: any) => r.entry.id);
    const fullIds = full.json.data.results.map((r: any) => r.entry.id);
    expect(fullIds.slice(0, 2)).toEqual(partialIds);
    expect(new Set(fullIds).size).toBe(3);
    expect(await entryCount(USER_A)).toBe(3);
  });

  it("a key logged by a single POST and then in a batch is still one entry", async () => {
    const single = await call(
      "A",
      "POST",
      "/nutrition/entries",
      oldShapeEntry(),
      { "Idempotency-Key": "shared-key" },
    );
    const batch = await call("A", "POST", "/nutrition/entries/batch", {
      entries: [{ ...oldShapeEntry(), clientRequestId: "shared-key" }],
    });
    expect(batch.json.data.results[0].entry.id).toBe(single.json.data.id);
    expect(await entryCount(USER_A)).toBe(1);
  });

  it("reports an unusable batch key per entry and still logs the rest", async () => {
    const res = await call("A", "POST", "/nutrition/entries/batch", {
      entries: [
        { ...oldShapeEntry(), clientRequestId: "not a key!" },
        { ...oldShapeEntry(), clientRequestId: "ok-key" },
      ],
    });
    expect(res.json.data.results[0]).toEqual({
      clientRequestId: "not a key!",
      error: "invalid_client_request_id",
    });
    expect(res.json.data.results[1].entry.id).toBeDefined();
    expect(await entryCount(USER_A)).toBe(1);
  });

  it("surfaces a key conflict whose row vanished instead of inventing one", async () => {
    const repo = new NutritionEntryRepository();
    const input = {
      mealSlot: "lunch" as const,
      servings: 1,
      kcal: 1,
      proteinG: 1,
      carbsG: 1,
      fatG: 1,
      loggedAt: `${DAY}T12:00:00.000Z`,
      clientRequestId: "vanishing",
    };
    await repo.create(USER_A, input);
    vi.spyOn(repo, "getByClientRequestId").mockResolvedValueOnce(null);
    await expect(repo.create(USER_A, input)).rejects.toThrow(
      "idempotency conflict without a row",
    );
  });

  it("stores plan provenance from a batch, and drops a local plan id rather than failing", async () => {
    const planId = "11111111-1111-4111-8111-111111111111";
    const res = await call("A", "POST", "/nutrition/entries/batch", {
      entries: [
        {
          ...oldShapeEntry(),
          clientRequestId: "prov-1",
          sourcePlanId: planId,
          sourcePlanMealId: "local-plan-meal-1",
        },
      ],
    });
    expect(res.json.data.results[0].entry).toBeDefined();
    const row = await pg.query(
      `SELECT source_plan_id, source_plan_meal_id FROM nutrition_entries`,
    );
    expect(row.rows).toEqual([
      { source_plan_id: planId, source_plan_meal_id: null },
    ]);
  });
});

describe("Design D test 4 — your meals", () => {
  it("seeds the four defaults once under concurrent first reads", async () => {
    const reads = await Promise.all(
      [1, 2, 3, 4, 5].map(() => call("A", "GET", "/nutrition/user-meals")),
    );
    expect(reads.every((r) => r.status === 200)).toBe(true);

    const rows = await pg.query<{ default_key: string; name: string }>(
      `SELECT default_key, name FROM user_meals WHERE user_id = $1 ORDER BY sort_order`,
      [USER_A],
    );
    expect(rows.rows).toEqual([
      { default_key: "breakfast", name: "Breakfast" },
      { default_key: "lunch", name: "Lunch" },
      { default_key: "snack", name: "Snack" },
      { default_key: "dinner", name: "Dinner" },
    ]);
    for (const r of reads) {
      expect(r.json.data.meals.map((m: any) => m.name)).toEqual([
        "Breakfast",
        "Lunch",
        "Snack",
        "Dinner",
      ]);
      expect(typeof r.json.data.asOf).toBe("string");
    }
  });

  it("rejects another user's userMealId on POST and in a batch, and writes nothing", async () => {
    const [aBreakfast] = await userMeals("A");

    const single = await call(
      "B",
      "POST",
      "/nutrition/entries",
      oldShapeEntry({ userMealId: aBreakfast.id }),
    );
    expect(single.status).toBe(400);
    expect(single.json).toEqual({ error: "user_meal_not_found" });

    const batch = await call("B", "POST", "/nutrition/entries/batch", {
      entries: [
        {
          ...oldShapeEntry({ userMealId: aBreakfast.id }),
          clientRequestId: "x-1",
        },
        { ...oldShapeEntry(), clientRequestId: "x-2" },
      ],
    });
    expect(batch.status).toBe(200);
    expect(batch.json.data.results[0]).toEqual({
      clientRequestId: "x-1",
      error: "user_meal_not_found",
    });
    // The good entry in the same batch is not stranded by the bad one.
    expect(batch.json.data.results[1].entry.userMealId).toBeNull();
    expect(await entryCount(USER_B)).toBe(1);
    expect(await entryCount(USER_A)).toBe(0);
  });

  it("rejects another user's meal id in PUT /nutrition/user-meals and changes nothing", async () => {
    const aMeals = await userMeals("A");
    const bMeals = await userMeals("B");
    const res = await call("B", "PUT", "/nutrition/user-meals", {
      meals: [
        { id: aMeals[0].id, name: "Mine now", logSlot: "lunch", sortOrder: 0 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: "user_meal_not_found" });
    expect(await userMeals("A")).toEqual(aMeals);
    expect(await userMeals("B")).toEqual(bMeals);
  });

  it("groups an entry without userMealId under the default meal for its slot", async () => {
    const meals = await userMeals("A");
    const lunch = meals.find((m) => m.defaultKey === "lunch");
    await call("A", "POST", "/nutrition/entries", oldShapeEntry());

    const list = await call("A", "GET", `/nutrition/entries?date=${DAY}`);
    expect(list.json.data[0].userMealId).toBe(lunch.id);
    const today = await call("A", "GET", `/nutrition/today?date=${DAY}`);
    expect(today.json.data.entriesBySlot.lunch[0].userMealId).toBe(lunch.id);
    // Stored as NULL: grouping is a read rule, history is not rewritten.
    const row = await pg.query(`SELECT user_meal_id FROM nutrition_entries`);
    expect(row.rows).toEqual([{ user_meal_id: null }]);
  });

  it("logs into a custom meal and takes mealSlot from that meal's logSlot", async () => {
    const meals = await userMeals("A");
    const put = await call("A", "PUT", "/nutrition/user-meals", {
      meals: [
        ...meals.map((m) => ({
          id: m.id,
          name: m.name,
          logSlot: m.logSlot,
          sortOrder: m.sortOrder,
        })),
        {
          clientRequestId: "meal-pre",
          name: "Pre-workout",
          logSlot: "snack",
          sortOrder: 4,
        },
      ],
    });
    const pre = put.json.data.meals.find((m: any) => m.name === "Pre-workout");

    const res = await call(
      "A",
      "POST",
      "/nutrition/entries",
      oldShapeEntry({ mealSlot: "dinner", userMealId: pre.id }),
    );
    expect(res.status).toBe(201);
    expect(res.json.data.userMealId).toBe(pre.id);
    expect(res.json.data.mealSlot).toBe("snack");
  });

  it("an entry with no seeded meals reads back with userMealId null (older accounts)", async () => {
    await call("A", "POST", "/nutrition/entries", oldShapeEntry());
    const list = await call("A", "GET", `/nutrition/entries?date=${DAY}`);
    expect(list.json.data[0].userMealId).toBeNull();
    // Entry reads never seed — they serve 1.2.0 bundles and stay write-free.
    const rows = await pg.query(`SELECT 1 FROM user_meals`);
    expect(rows.rows).toEqual([]);
  });

  it("an old app moving an entry to another slot regroups it under that slot's default", async () => {
    const meals = await userMeals("A");
    const breakfast = meals.find((m) => m.defaultKey === "breakfast");
    const dinner = meals.find((m) => m.defaultKey === "dinner");
    const created = await call(
      "A",
      "POST",
      "/nutrition/entries",
      oldShapeEntry({ userMealId: breakfast.id }),
    );
    expect(created.json.data.mealSlot).toBe("breakfast");

    // Same slot: the meal is kept.
    const same = await call(
      "A",
      "PUT",
      `/nutrition/entries/${created.json.data.id}`,
      { mealSlot: "breakfast", servings: 2 },
    );
    expect(same.json.data.userMealId).toBe(breakfast.id);

    // 1.2.0's edit sheet can only change the slot: the stale meal is cleared.
    const moved = await call(
      "A",
      "PUT",
      `/nutrition/entries/${created.json.data.id}`,
      { mealSlot: "dinner" },
    );
    expect(moved.status).toBe(200);
    expect(moved.json.data.userMealId).toBeNull();
    const list = await call("A", "GET", `/nutrition/entries?date=${DAY}`);
    expect(list.json.data[0].userMealId).toBe(dinner.id);
  });
});

describe("PUT /nutrition/user-meals", () => {
  it("renames, reorders, archives what's left out, and keeps entries on archived meals", async () => {
    const meals = await userMeals("A");
    const snack = meals.find((m) => m.defaultKey === "snack");
    const logged = await call(
      "A",
      "POST",
      "/nutrition/entries",
      oldShapeEntry({ userMealId: snack.id }),
    );

    const res = await call("A", "PUT", "/nutrition/user-meals", {
      meals: [
        { id: meals[3].id, name: "  Tea  ", logSlot: "dinner", sortOrder: 0 },
        {
          id: meals[0].id,
          name: "Brekkie",
          logSlot: "breakfast",
          sortOrder: 1,
        },
        { id: meals[1].id, name: "Lunch", logSlot: "lunch", sortOrder: 2 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.json.data.meals.map((m: any) => m.name)).toEqual([
      "Tea",
      "Brekkie",
      "Lunch",
    ]);

    const withArchived = await call(
      "A",
      "GET",
      "/nutrition/user-meals?includeArchived=true",
    );
    const archived = withArchived.json.data.meals.find(
      (m: any) => m.id === snack.id,
    );
    expect(archived.archivedAt).not.toBeNull();

    const list = await call("A", "GET", `/nutrition/entries?date=${DAY}`);
    expect(list.json.data[0].id).toBe(logged.json.data.id);
    expect(list.json.data[0].userMealId).toBe(snack.id);
  });

  it("a PUT re-sent after a lost response doesn't add the new meal twice", async () => {
    const meals = await userMeals("A");
    const body = {
      meals: [
        ...meals.map((m) => ({
          id: m.id,
          name: m.name,
          logSlot: m.logSlot,
          sortOrder: m.sortOrder,
        })),
        {
          id: "local-meal-7",
          clientRequestId: "local-meal-7",
          name: "Post-workout",
          logSlot: "snack",
          sortOrder: 4,
        },
      ],
    };
    const first = await call("A", "PUT", "/nutrition/user-meals", body);
    const again = await call("A", "PUT", "/nutrition/user-meals", body);
    expect(again.json.data.meals).toHaveLength(5);
    const post = again.json.data.meals.find(
      (m: any) => m.clientRequestId === "local-meal-7",
    );
    expect(post.id).toBe(
      first.json.data.meals.find((m: any) => m.name === "Post-workout").id,
    );
  });

  it("restores an archived meal named by id", async () => {
    const meals = await userMeals("A");
    await call("A", "PUT", "/nutrition/user-meals", {
      meals: [
        {
          id: meals[0].id,
          name: "Breakfast",
          logSlot: "breakfast",
          sortOrder: 0,
        },
      ],
    });
    const back = await call("A", "PUT", "/nutrition/user-meals", {
      meals: [
        {
          id: meals[0].id,
          name: "Breakfast",
          logSlot: "breakfast",
          sortOrder: 0,
        },
        { id: meals[3].id, name: "Dinner", logSlot: "dinner", sortOrder: 1 },
      ],
    });
    expect(back.json.data.meals.map((m: any) => m.id)).toEqual([
      meals[0].id,
      meals[3].id,
    ]);
  });

  it("on a fresh account, seeds first so omitted defaults are archived, not re-seeded later", async () => {
    const res = await call("A", "PUT", "/nutrition/user-meals", {
      meals: [{ name: "Meal 1", logSlot: "breakfast", sortOrder: 0 }],
    });
    expect(res.json.data.meals.map((m: any) => m.name)).toEqual(["Meal 1"]);
    expect((await userMeals("A")).map((m) => m.name)).toEqual(["Meal 1"]);
  });

  it("groups an unkeyed entry under another active meal of its slot once the default is gone", async () => {
    const meals = await userMeals("A");
    const res = await call("A", "PUT", "/nutrition/user-meals", {
      meals: [
        {
          id: meals[0].id,
          name: "Breakfast",
          logSlot: "breakfast",
          sortOrder: 0,
        },
        { name: "Midday", logSlot: "lunch", sortOrder: 1 },
      ],
    });
    const midday = res.json.data.meals.find((m: any) => m.name === "Midday");
    await call("A", "POST", "/nutrition/entries", oldShapeEntry());
    const list = await call("A", "GET", `/nutrition/entries?date=${DAY}`);
    expect(list.json.data[0].userMealId).toBe(midday.id);
  });

  it.each([
    [
      "a blank name",
      { meals: [{ name: "   ", logSlot: "lunch", sortOrder: 0 }] },
      "invalid_user_meal_name",
    ],
    [
      "a name over 40 characters",
      { meals: [{ name: "x".repeat(41), logSlot: "lunch", sortOrder: 0 }] },
      "invalid_user_meal_name",
    ],
    [
      "an unusable clientRequestId",
      {
        meals: [
          {
            name: "x",
            clientRequestId: "has spaces",
            logSlot: "lunch",
            sortOrder: 0,
          },
        ],
      },
      "invalid_client_request_id",
    ],
  ])("400s %s", async (_label, body, error) => {
    const res = await call("A", "PUT", "/nutrition/user-meals", body);
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error });
  });

  it("400s the same meal listed twice", async () => {
    const meals = await userMeals("A");
    const res = await call("A", "PUT", "/nutrition/user-meals", {
      meals: [
        { id: meals[0].id, name: "A", logSlot: "lunch", sortOrder: 0 },
        { id: meals[0].id, name: "B", logSlot: "lunch", sortOrder: 1 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: "duplicate_user_meal" });
  });

  it("rejects an empty list at validation", async () => {
    const res = await call("A", "PUT", "/nutrition/user-meals", { meals: [] });
    expect(res.status).toBe(422);
  });
});

describe("two-user isolation", () => {
  it("each user sees only their own entries and meals, and can't touch the other's", async () => {
    await userMeals("A");
    const a = await call("A", "POST", "/nutrition/entries", oldShapeEntry(), {
      "Idempotency-Key": "same-key-for-both",
    });
    await call("A", "POST", "/nutrition/entries/batch", {
      entries: [{ ...oldShapeEntry(), clientRequestId: "a-batch-1" }],
    });

    // B's reads are empty: no entries, and B's meals are B's own defaults.
    const bList = await call("B", "GET", `/nutrition/entries?date=${DAY}`);
    expect(bList.json.data).toEqual([]);
    const bToday = await call("B", "GET", `/nutrition/today?date=${DAY}`);
    expect(bToday.json.data.consumed.kcal).toBe(0);
    const bMeals = await userMeals("B");
    const aMeals = await userMeals("A");
    expect(bMeals.map((m) => m.id)).not.toEqual(
      expect.arrayContaining([aMeals[0].id]),
    );

    // B re-using A's key gets B's own new entry, never A's.
    const b = await call("B", "POST", "/nutrition/entries", oldShapeEntry(), {
      "Idempotency-Key": "same-key-for-both",
    });
    expect(b.status).toBe(201);
    expect(b.json.data.id).not.toBe(a.json.data.id);
    expect(b.json.data.userId).toBe(USER_B);
    const bBatch = await call("B", "POST", "/nutrition/entries/batch", {
      entries: [{ ...oldShapeEntry(), clientRequestId: "a-batch-1" }],
    });
    expect(bBatch.json.data.results[0].entry.userId).toBe(USER_B);

    // B can't edit or delete A's entry.
    const edit = await call(
      "B",
      "PUT",
      `/nutrition/entries/${a.json.data.id}`,
      {
        servings: 9,
      },
    );
    expect(edit.status).toBe(404);
    const del = await call(
      "B",
      "DELETE",
      `/nutrition/entries/${a.json.data.id}`,
    );
    expect(del.status).toBe(404);

    expect(await entryCount(USER_A)).toBe(2);
    expect(await entryCount(USER_B)).toBe(2);
    const aList = await call("A", "GET", `/nutrition/entries?date=${DAY}`);
    expect(aList.json.data.every((e: any) => e.userId === USER_A)).toBe(true);
    expect(
      aList.json.data.find((e: any) => e.id === a.json.data.id).servings,
    ).toBe(1);
  });

  it("requires auth on every new route", async () => {
    // Valid bodies: Elysia validates the body before `requireAuth` runs.
    const cases: [string, string, unknown][] = [
      ["GET", "/nutrition/user-meals", undefined],
      [
        "PUT",
        "/nutrition/user-meals",
        { meals: [{ name: "x", logSlot: "lunch", sortOrder: 0 }] },
      ],
      [
        "POST",
        "/nutrition/entries/batch",
        { entries: [{ ...oldShapeEntry(), clientRequestId: "k" }] },
      ],
    ];
    for (const [method, path, body] of cases) {
      const res = await app.handle(
        new Request(`http://localhost${path}`, {
          method,
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      expect(res.status).toBe(401);
    }
  });
});
