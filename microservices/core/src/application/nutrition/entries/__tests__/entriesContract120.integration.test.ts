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
import { USER_A, resetNutritionSchema } from "../../__tests__/nutritionTestDb";
import {
  CONSUMED_FIELDS_120,
  DAY_120,
  EDIT_BODY_120,
  ENTRY_FIELDS_120,
  FUEL_TODAY_FIELDS_120,
  LOG_BODIES_120,
  MEAL_SLOTS_120,
  idempotencyKey120,
  type FieldSpec,
} from "./fixtures/entries120.fixture";

/**
 * The 1.2.0 contract fixtures for entries (PER-109 "Done when"): every request
 * a 1.2.0 phone sends to the entry routes still succeeds, and every response
 * still carries every field it reads, with the same type — after migration 6
 * and the Design D changes. Real handlers and repositories on a real Postgres.
 */

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (h: string | undefined) =>
    h === "Bearer phone-120"
      ? {
          sub: "00000000-0000-4000-8000-00000000000a",
          email: "t@e.com",
          iat: 0,
          exp: 9999999999,
        }
      : null,
  ),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx: any) => ctx.user),
}));

import { getDb } from "@persistence/db/client";
import { nutritionRoutes } from "../../../nutritionRoutes";

// The production route tree, so mounting order and route collisions (the new
// POST /nutrition/entries/batch beside /nutrition/entries/:id) are covered.
const app = new Elysia().use(nutritionRoutes);

/** Headers exactly as the 1.2.0 sync drain sends them. */
function headers120(key?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: "Bearer phone-120",
    ...(key ? { "Idempotency-Key": key } : {}),
  };
}

async function send(
  method: string,
  path: string,
  body?: unknown,
  key?: string,
): Promise<{ status: number; json: any }> {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: headers120(key),
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

function typeOf(v: unknown): string {
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Every 1.2.0 field present with its type; extra (additive) fields allowed. */
function expectShape(value: any, spec: Record<string, FieldSpec>): void {
  for (const [field, { type, nullable }] of Object.entries(spec)) {
    expect(value, `missing ${field}`).toHaveProperty(field);
    const v = value[field];
    if (v === null) {
      expect(nullable, `${field} is null`).toBe(true);
    } else {
      expect(typeOf(v), `${field} type`).toBe(type);
    }
  }
}

let pg: PGlite;
let refs: { foodId: string; recipeId: string; mealId: string };

beforeAll(async () => {
  pg = await PGlite.create();
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await resetNutritionSchema(pg);
  vi.mocked(getDb).mockReturnValue(drizzle(pg, { schema }) as never);
  const food = await pg.query<{ id: string }>(
    `INSERT INTO foods (name, kcal, protein_g, carbs_g, fat_g, serving_size, serving_unit, source, created_by)
     VALUES ('Oats', 150, 5, 27, 3, 40, 'g', 'user', $1) RETURNING id`,
    [USER_A],
  );
  const recipe = await pg.query<{ id: string }>(
    `INSERT INTO recipes (user_id, name, servings, total_kcal, total_protein_g, total_carbs_g, total_fat_g)
     VALUES ($1, 'Chilli', 4, 2000, 160, 180, 60) RETURNING id`,
    [USER_A],
  );
  const meal = await pg.query<{ id: string }>(
    `INSERT INTO meals (user_id, name, total_kcal, total_protein_g, total_carbs_g, total_fat_g)
     VALUES ($1, 'Usual lunch', 550, 35, 60, 15) RETURNING id`,
    [USER_A],
  );
  refs = {
    foodId: food.rows[0]!.id,
    recipeId: recipe.rows[0]!.id,
    mealId: meal.rows[0]!.id,
  };
});

function bodies120() {
  return [
    ["a food", LOG_BODIES_120.food(refs.foodId), 300],
    ["a recipe serving", LOG_BODIES_120.recipe(refs.recipeId), 500],
    ["a saved meal", LOG_BODIES_120.savedMeal(refs.mealId), 550],
    ["a quick log", LOG_BODIES_120.quickLog(), 210],
    ["an AI estimate", LOG_BODIES_120.aiEstimate(), 640],
  ] as const;
}

describe("1.2.0 contract — POST /nutrition/entries", () => {
  it("accepts every body 1.2.0 sends, with and without Idempotency-Key, in the 1.2.0 response shape", async () => {
    let n = 0;
    for (const [label, body, kcal] of bodies120()) {
      for (const key of [undefined, idempotencyKey120(n++)]) {
        const res = await send("POST", "/nutrition/entries", body, key);
        expect(res.status, label).toBe(201);
        expectShape(res.json.data, ENTRY_FIELDS_120);
        expect(res.json.data.kcal, label).toBe(kcal);
        expect(res.json.data.mealSlot, label).toBe(body.mealSlot);
      }
    }
  });

  it("answers a 1.2.0 replay with the same 201 body and no second entry", async () => {
    for (const [i, [label, body]] of bodies120().entries()) {
      const key = idempotencyKey120(100 + i);
      const first = await send("POST", "/nutrition/entries", body, key);
      const replay = await send("POST", "/nutrition/entries", body, key);
      expect(replay.status, label).toBe(201);
      expect(replay.json, label).toEqual(first.json);
    }
    const count = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM nutrition_entries`,
    );
    expect(count.rows[0]!.n).toBe(5);
  });

  it("keeps 1.2.0's error contract: 400 with the same error codes", async () => {
    const missingFood = await send(
      "POST",
      "/nutrition/entries",
      LOG_BODIES_120.food("00000000-0000-4000-8000-000000000999"),
    );
    expect(missingFood).toEqual({
      status: 400,
      json: { error: "food_not_found" },
    });
    const noMacros: Record<string, unknown> = LOG_BODIES_120.quickLog();
    delete noMacros.kcal;
    const custom = await send("POST", "/nutrition/entries", noMacros);
    expect(custom).toEqual({
      status: 400,
      json: { error: "macros_required_for_custom_entry" },
    });
  });
});

describe("1.2.0 contract — reads, edit, delete", () => {
  it("GET /nutrition/entries and /nutrition/today return everything 1.2.0 reads", async () => {
    for (const [, body] of bodies120()) {
      await send("POST", "/nutrition/entries", body);
    }

    const list = await send("GET", `/nutrition/entries?date=${DAY_120}`);
    expect(list.status).toBe(200);
    expect(list.json.data).toHaveLength(5);
    for (const e of list.json.data) expectShape(e, ENTRY_FIELDS_120);

    const today = await send("GET", `/nutrition/today?date=${DAY_120}`);
    expect(today.status).toBe(200);
    expectShape(today.json.data, FUEL_TODAY_FIELDS_120);
    expectShape(today.json.data.consumed, CONSUMED_FIELDS_120);
    expect(Object.keys(today.json.data.entriesBySlot).sort()).toEqual(
      [...MEAL_SLOTS_120].sort(),
    );
    for (const slot of MEAL_SLOTS_120) {
      for (const e of today.json.data.entriesBySlot[slot]) {
        expectShape(e, ENTRY_FIELDS_120);
        expect(e.mealSlot).toBe(slot);
      }
    }
    expect(today.json.data.consumed.kcal).toBe(300 + 500 + 550 + 210 + 640);
  });

  it("PUT /nutrition/entries/:id with 1.2.0's edit body, then DELETE, behave as before", async () => {
    const created = await send(
      "POST",
      "/nutrition/entries",
      LOG_BODIES_120.food(refs.foodId),
      idempotencyKey120(7),
    );
    const id = created.json.data.id;

    const edited = await send("PUT", `/nutrition/entries/${id}`, EDIT_BODY_120);
    expect(edited.status).toBe(200);
    expectShape(edited.json.data, ENTRY_FIELDS_120);
    expect(edited.json.data.mealSlot).toBe("dinner");
    expect(edited.json.data.kcal).toBe(450);

    const deleted = await send("DELETE", `/nutrition/entries/${id}`);
    expect(deleted).toEqual({
      status: 200,
      json: { data: { id, deleted: true } },
    });
    const again = await send("DELETE", `/nutrition/entries/${id}`);
    expect(again.status).toBe(404);
  });
});
