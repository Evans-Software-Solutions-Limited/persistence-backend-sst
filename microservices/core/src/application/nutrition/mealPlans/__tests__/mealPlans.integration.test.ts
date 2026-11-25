import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect, getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { and, eq, is, SQL } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "@persistence/db/schema";

/**
 * Design D (PER-118, BE-D2) — tests 1 (isolation), 2 (live edit), 6
 * (duplicate and recipe share) and 7 (entitlement), plus the shopping list,
 * the set-up materialiser and the migration (forward twice, down, up). The
 * real migrations run on PGlite and requests go through the real handlers.
 * Only the edges are stubbed: the JWT (bearer token = user id) and push
 * delivery.
 */

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@persistence/db/client", () => ({
  getDb: () => holder.db,
  createDb: () => holder.db,
}));
vi.mock("@persistence/db", async (original) => ({
  ...(await original<object>()),
  getDb: () => holder.db,
}));
vi.mock("@persistence/api-utils/auth/supabaseAuth", async (original) => ({
  ...(await original<object>()),
  getAuthUser: async (header?: string) =>
    header?.startsWith("Bearer ") ? { sub: header.slice(7) } : null,
}));
const push = vi.hoisted(() => ({
  dispatchExisting: null as unknown as ReturnType<typeof vi.fn>,
}));
vi.mock("../../../notifications/push/notificationDispatcher", () => {
  push.dispatchExisting = vi.fn(async () => {});
  return {
    NotificationDispatcher: class {
      dispatchExisting = push.dispatchExisting;
      createAndDispatch = vi.fn(async () => ({}));
    },
  };
});

import Elysia from "elysia";
import { coreErrorHandler } from "../../../../shared/errorHandler";
import { mealPlanRoutes } from "../mealPlanRoutes";
import { nutritionEntriesBatchHandler } from "../../entries/batch/nutritionEntriesBatchHandler";
import { nutritionEntriesListHandler } from "../../entries/list/nutritionEntriesListHandler";
import { mealPlanSetupHandler } from "../mealPlanSetupHandler";
import { sectionHandler } from "../../../coaching/setupSections";
import { removePlanAssignmentsForRelationship } from "../../../repositories/nutritionPlanRepository";
import { countPlanEntries } from "../assignments";
import { parseSince } from "../mealPlansHandlers";

const MIGRATIONS = "../../../../../../../supabase/migrations/";
const ROLLBACKS = "../../../../../../../supabase/rollbacks/";
const read = (dir: string, file: string) =>
  readFile(new URL(`${dir}${file}`, import.meta.url), "utf8");
const MIGRATION = "20261121000118_meal_plans_coach_assignments.sql";
const NUTRITION_MIGRATIONS = [
  "20260621120000_m9_nutrition_schema.sql",
  "20260708120000_nutrition_entries_custom_name.sql",
  "20260714120000_foods_serving_quantity.sql",
  "20260803120000_foods_mealprint_tags.sql",
  "20260807185359_off_energy_trust_boundary.sql",
  "20261120143109_your_meals_entry_idempotency.sql",
];

const dialect = new PgDialect();

/** Non-nutrition tables the routes read, created from the Drizzle mirror. */
const BASE_TABLES = [
  schema.profiles,
  schema.ptClientRelationships,
  schema.coachClientSettings,
  schema.notifications,
  schema.trainerActionsAudit,
  schema.subscriptionTiers,
  schema.userSubscriptions,
  schema.mealPlans,
  schema.mealPlanMeals,
];

function ddl(table: PgTable): string {
  const cfg = getTableConfig(table);
  const columns = cfg.columns.map((c) => {
    let type = c.getSQLType();
    if (c.enumValues?.length) type = "text";
    let def = "";
    if (c.default !== undefined) {
      def =
        " default " +
        (is(c.default, SQL)
          ? dialect.sqlToQuery(c.default).sql
          : typeof c.default === "string"
            ? `'${c.default.replaceAll("'", "''")}'`
            : Array.isArray(c.default) && type.endsWith("[]")
              ? "'{}'"
              : typeof c.default === "object"
                ? `'${JSON.stringify(c.default)}'`
                : String(c.default as number | boolean | bigint));
    }
    return `"${c.name}" ${type}${c.notNull ? " not null" : ""}${c.primary ? " primary key" : ""}${def}`;
  });
  for (const pk of cfg.primaryKeys)
    columns.push(
      `primary key (${pk.columns.map((c) => `"${c.name}"`).join(",")})`,
    );
  return `create table "${cfg.name}" (${columns.join(",")});`;
}

const enumSql = (name: string, values: readonly string[], skip: string[]) =>
  `create type ${name} as enum (${values
    .filter((v) => !skip.includes(v))
    .map((v) => `'${v}'`)
    .join(",")});`;

/** The database as it was before this migration. */
async function baseDatabase(): Promise<PGlite> {
  const pg = await PGlite.create();
  await pg.exec(
    enumSql("notification_type", schema.notificationTypeEnum.enumValues, [
      "meal_plan_assigned",
    ]),
  );
  await pg.exec(
    enumSql("action_type_enum", schema.actionTypeEnum.enumValues, [
      "meal_plan_assigned",
      "recipe_shared",
    ]),
  );
  for (const table of BASE_TABLES) await pg.exec(ddl(table));
  for (const file of NUTRITION_MIGRATIONS)
    await pg.exec(await read(MIGRATIONS, file));
  return pg;
}

const COACH_A = randomUUID();
const COACH_B = randomUUID();
const CLIENT_C = randomUUID();
const ATHLETE_D = randomUUID();
const PREMIUM_P = randomUUID();
let REL_AC = "";
let REL_BC = "";

const OATS = randomUUID(); // shared catalogue
const GRANOLA = randomUUID(); // coach A's private food
const RICE = randomUUID(); // shared catalogue
const RECIPE_A = randomUUID(); // coach A's recipe: 2 servings, 1000 kcal
const SHAKE_A = randomUUID(); // coach A's saved meal

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const app = new Elysia()
  .use(coreErrorHandler)
  .use(mealPlanRoutes)
  .use(nutritionEntriesBatchHandler)
  .use(nutritionEntriesListHandler);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function http(
  method: string,
  path: string,
  actor: string | null,
  body?: unknown,
  key?: string,
): Promise<{ status: number; json: Json }> {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(actor ? { authorization: `Bearer ${actor}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(key ? { "idempotency-key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function seed() {
  await pg.exec(`
    insert into subscription_tiers (tier_name, display_name, price_monthly)
      values ('free','Free',0), ('premium','Premium',4.99);
    insert into profiles (id, full_name, role) values
      ('${COACH_A}', 'Ellie', 'personal_trainer'),
      ('${COACH_B}', 'Marco', 'personal_trainer'),
      ('${CLIENT_C}', 'Sam', 'user'),
      ('${ATHLETE_D}', 'Dee', 'user'),
      ('${PREMIUM_P}', 'Pat', 'user');
    insert into user_subscriptions (user_id, tier_name, payment_status, starts_at)
      values ('${PREMIUM_P}', 'premium', 'active', now() - interval '1 day');
    insert into foods (id, name, kcal, protein_g, carbs_g, fat_g, serving_size, serving_unit, source, category_tags)
      values
      ('${OATS}', 'Oats', 380, 13, 60, 7, 100, 'g', 'openfoodfacts', '{en:cereals}'),
      ('${RICE}', 'Rice', 130, 3, 28, 0, 100, 'g', 'openfoodfacts', null),
      ('${GRANOLA}', 'Coach granola', 450, 10, 55, 20, 50, 'g', 'user', null);
    update foods set created_by = '${COACH_A}' where id = '${GRANOLA}';
    insert into recipes (id, user_id, name, servings, total_kcal, total_protein_g, total_carbs_g, total_fat_g)
      values ('${RECIPE_A}', '${COACH_A}', 'Chicken rice', 2, 1000, 80, 100, 20);
    insert into recipe_ingredients (recipe_id, food_id, custom_name, quantity, unit, sort_order) values
      ('${RECIPE_A}', '${RICE}', null, 300, 'g', 0),
      ('${RECIPE_A}', '${GRANOLA}', null, 50, 'g', 1),
      ('${RECIPE_A}', null, 'Salt', 1, 'tsp', 2);
    insert into meals (id, user_id, name, total_kcal, total_protein_g, total_carbs_g, total_fat_g)
      values ('${SHAKE_A}', '${COACH_A}', 'Protein shake', 200, 30, 10, 3);
  `);
  const rels = await pg.query<{ id: string; trainer_id: string }>(`
    insert into pt_client_relationships (id, trainer_id, client_id, status, is_ai_trainer)
    values (gen_random_uuid(), '${COACH_A}', '${CLIENT_C}', 'active', false),
           (gen_random_uuid(), '${COACH_B}', '${CLIENT_C}', 'active', false)
    returning id, trainer_id`);
  REL_AC = rels.rows.find((r) => r.trainer_id === COACH_A)!.id;
  REL_BC = rels.rows.find((r) => r.trainer_id === COACH_B)!.id;
}

const PLAN_BODY = {
  name: "Training day",
  notes: "Big lunch",
  meals: [
    {
      name: "Breakfast",
      logSlot: "breakfast",
      items: [
        { foodId: OATS, servings: 0.8 },
        { foodId: GRANOLA, servings: 1 },
      ],
    },
    {
      name: "Lunch",
      logSlot: "lunch",
      items: [
        { recipeId: RECIPE_A, servings: 1 },
        { mealId: SHAKE_A, servings: 1 },
        {
          custom: { name: "Apple", kcal: 52, proteinG: 0, carbsG: 14, fatG: 0 },
          servings: 2,
        },
      ],
    },
  ],
};

async function coachPlan(coach = COACH_A, body: object = PLAN_BODY) {
  const res = await http("POST", "/trainers/me/meal-plans", coach, body);
  expect(res.status).toBe(201);
  return res.json.data as Json;
}

async function assign(planId: string, coach = COACH_A, key?: string) {
  return http(
    "POST",
    `/trainers/me/clients/${CLIENT_C}/meal-plans`,
    coach,
    { planId, note: "Try this on training days" },
    key,
  );
}

beforeAll(async () => {
  pg = await baseDatabase();
  await pg.exec(await read(MIGRATIONS, MIGRATION));
  db = drizzle(pg, { schema });
  holder.db = db;
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec(`
    truncate shopping_list_plans, nutrition_plan_assignments, nutrition_plan_items,
      nutrition_plan_meals, nutrition_plans, nutrition_entries, user_meals,
      recipe_ingredients, recipes, meal_items, meals, foods, notifications,
      trainer_actions_audit, pt_client_relationships, coach_client_settings,
      user_subscriptions, subscription_tiers, meal_plan_meals, meal_plans, profiles cascade;
  `);
  push.dispatchExisting.mockClear();
  await seed();
});

describe("plan create, macros and entitlement (Design D test 7)", () => {
  it("computes item macros on the server from the owner's rows", async () => {
    const plan = await coachPlan();
    expect(plan.source).toBe("coach");
    expect(plan.revision).toBe(1);
    const [breakfast, lunch] = plan.meals;
    expect(breakfast.items[0]).toMatchObject({
      kind: "food",
      name: "Oats",
      kcal: 304,
      logEntry: { foodId: OATS, servings: 0.8 },
    });
    // Recipe: per serving = 1000 / 2.
    expect(lunch.items[0]).toMatchObject({
      kind: "recipe",
      kcal: 500,
      proteinG: 40,
      recipe: { name: "Chicken rice", servings: 2 },
    });
    expect(lunch.items[0].recipe.ingredients.map((i: Json) => i.name)).toEqual([
      "Rice",
      "Coach granola",
      "Salt",
    ]);
    expect(lunch.items[1]).toMatchObject({ kind: "meal", kcal: 200 });
    expect(lunch.items[2]).toMatchObject({ kind: "custom", kcal: 104 });
    expect(plan.totals.kcal).toBe(304 + 450 + 500 + 200 + 104);
  });

  it("refuses a Free athlete's own plan with 403 manual_meal_plans", async () => {
    const res = await http("POST", "/nutrition/meal-plans", CLIENT_C, {
      name: "Mine",
      meals: [],
    });
    expect(res.status).toBe(403);
    expect(res.json.error).toBe("manual_meal_plans");
  });

  it("lets Premium create, replay-safe on Idempotency-Key", async () => {
    const body = {
      name: "Rest day",
      meals: [
        {
          name: "Dinner",
          logSlot: "dinner",
          items: [{ foodId: RICE, servings: 2 }],
        },
      ],
    };
    const first = await http(
      "POST",
      "/nutrition/meal-plans",
      PREMIUM_P,
      body,
      "k-1",
    );
    const again = await http(
      "POST",
      "/nutrition/meal-plans",
      PREMIUM_P,
      body,
      "k-1",
    );
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.json.data.id).toBe(first.json.data.id);
    expect(first.json.data.source).toBe("manual");
    const rows = await db.select().from(schema.nutritionPlans);
    expect(rows).toHaveLength(1);
  });

  it("lets a trainer create plans for themselves, on either path", async () => {
    const res = await http("POST", "/nutrition/meal-plans", COACH_A, {
      name: "My cut",
      meals: [],
    });
    expect(res.status).toBe(201);
    const list = await http("GET", "/trainers/me/meal-plans", COACH_A);
    expect(list.json.data.plans).toHaveLength(1);
  });

  it("keeps the coach library to trainers", async () => {
    for (const [method, path] of [
      ["GET", "/trainers/me/meal-plans"],
      ["POST", "/trainers/me/meal-plans"],
      ["GET", `/trainers/me/meal-plans/${randomUUID()}`],
      ["PUT", `/trainers/me/meal-plans/${randomUUID()}`],
      ["DELETE", `/trainers/me/meal-plans/${randomUUID()}`],
    ] as const) {
      const body =
        method === "POST" || method === "PUT"
          ? { name: "x", meals: [] }
          : undefined;
      const res = await http(method, path, PREMIUM_P, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.json.error).toBe("not_a_trainer");
    }
  });

  it("rejects bad items and other people's rows", async () => {
    const bad = async (items: object[], error: string) => {
      const res = await http("POST", "/nutrition/meal-plans", PREMIUM_P, {
        name: "x",
        meals: [{ name: "M", logSlot: "lunch", items }],
      });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe(error);
    };
    await bad(
      [{ foodId: OATS, recipeId: RECIPE_A, servings: 1 }],
      "invalid_item",
    );
    await bad([{ servings: 1 }], "invalid_item");
    await bad([{ foodId: OATS, servings: 0 }], "invalid_item");
    await bad(
      [
        {
          custom: { name: "x", kcal: -1, proteinG: 0, carbsG: 0, fatG: 0 },
          servings: 1,
        },
      ],
      "invalid_item",
    );
    await bad([{ foodId: GRANOLA, servings: 1 }], "food_not_found");
    await bad([{ foodId: "local-1", servings: 1 }], "food_not_found");
    await bad([{ recipeId: RECIPE_A, servings: 1 }], "recipe_not_found");
    await bad([{ recipeId: "local-2", servings: 1 }], "recipe_not_found");
    await bad([{ mealId: SHAKE_A, servings: 1 }], "meal_not_found");
    await bad([{ mealId: "local-3", servings: 1 }], "meal_not_found");
    const blankName = await http("POST", "/nutrition/meal-plans", PREMIUM_P, {
      name: " \u0000 ",
      meals: [],
    });
    expect(blankName.json.error).toBe("invalid_plan_name");
    const blankMeal = await http("POST", "/nutrition/meal-plans", PREMIUM_P, {
      name: "ok",
      meals: [{ name: " ", logSlot: "lunch", items: [] }],
    });
    expect(blankMeal.json.error).toBe("invalid_meal_name");
  });
});

describe("isolation (Design D test 1)", () => {
  it("lets client C read coach A's assigned plan and nothing else of A's", async () => {
    const assigned = await coachPlan();
    const other = await coachPlan(COACH_A, { ...PLAN_BODY, name: "Secret" });
    const sent = await assign(assigned.id, COACH_A, "assign-1");
    expect(sent.status).toBe(201);
    expect(sent.json.data).toMatchObject({ status: "sent", seenRevision: 1 });
    const replay = await assign(assigned.id, COACH_A, "assign-1");
    expect(replay.status).toBe(200);
    expect(replay.json.data.id).toBe(sent.json.data.id);
    const again = await assign(assigned.id);
    expect(again.status).toBe(200);
    expect(push.dispatchExisting).toHaveBeenCalledTimes(1);
    const notes = await db.select().from(schema.notifications);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      userId: CLIENT_C,
      type: "meal_plan_assigned",
      title: "Ellie sent you a meal plan",
    });
    const audit = await db.select().from(schema.trainerActionsAudit);
    expect(audit.map((a) => a.actionType)).toEqual(["meal_plan_assigned"]);

    const list = await http("GET", "/nutrition/meal-plans", CLIENT_C);
    expect(list.json.data.mine).toEqual([]);
    expect(list.json.data.fromCoaches).toHaveLength(1);
    expect(list.json.data.fromCoaches[0]).toMatchObject({
      coach: { id: COACH_A, name: "Ellie" },
      note: "Try this on training days",
      status: "sent",
      updatedSinceSeen: false,
      plan: { id: assigned.id },
    });

    const read = await http(
      "GET",
      `/nutrition/meal-plans/${assigned.id}`,
      CLIENT_C,
    );
    expect(read.status).toBe(200);
    expect(read.json.data.assignment).toMatchObject({ trainerId: COACH_A });
    // The client logs coach rows as one-offs; the shared catalogue by id.
    const items = read.json.data.meals.flatMap((m: Json) => m.items);
    expect(items[0].logEntry).toEqual({ foodId: OATS, servings: 0.8 });
    expect(items[1].logEntry).toMatchObject({
      customName: "Coach granola",
      kcal: 450,
    });
    expect(items[2].logEntry).toMatchObject({
      customName: "Chicken rice",
      kcal: 500,
    });

    expect(
      (await http("GET", `/nutrition/meal-plans/${other.id}`, CLIENT_C)).status,
    ).toBe(404);
  });

  it("keeps coach B out of coach A's plans and assignments", async () => {
    const plan = await coachPlan();
    await assign(plan.id);
    expect(
      (await http("GET", `/nutrition/meal-plans/${plan.id}`, COACH_B)).status,
    ).toBe(404);
    expect(
      (await http("GET", `/trainers/me/meal-plans/${plan.id}`, COACH_B)).status,
    ).toBe(404);
    const put = await http(
      "PUT",
      `/trainers/me/meal-plans/${plan.id}`,
      COACH_B,
      PLAN_BODY,
    );
    expect(put.status).toBe(404);
    const del = await http(
      "DELETE",
      `/nutrition/meal-plans/${plan.id}`,
      COACH_B,
    );
    expect(del.status).toBe(404);
    const steal = await assign(plan.id, COACH_B);
    expect(steal.status).toBe(404);
    expect(steal.json.error).toBe("plan_not_found");
    // B's view of the same client shows only B's own assignments.
    const bPlan = await coachPlan(COACH_B, {
      ...PLAN_BODY,
      name: "B plan",
      meals: [],
    });
    await assign(bPlan.id, COACH_B);
    const bList = await http(
      "GET",
      `/trainers/me/clients/${CLIENT_C}/meal-plans`,
      COACH_B,
    );
    expect(bList.json.data.assignments.map((a: Json) => a.planId)).toEqual([
      bPlan.id,
    ]);
    const cList = await http("GET", "/nutrition/meal-plans", CLIENT_C);
    expect(
      cList.json.data.fromCoaches.map((f: Json) => f.coach.id).sort(),
    ).toEqual([COACH_A, COACH_B].sort());
    // An unrelated athlete sees nothing, and A can't send to them.
    expect(
      (await http("GET", `/nutrition/meal-plans/${plan.id}`, ATHLETE_D)).status,
    ).toBe(404);
    const notClient = await http(
      "POST",
      `/trainers/me/clients/${ATHLETE_D}/meal-plans`,
      COACH_A,
      { planId: plan.id },
    );
    expect(notClient.status).toBe(403);
  });

  it("answers 403 when the assigned client tries to write", async () => {
    const plan = await coachPlan();
    await assign(plan.id);
    const put = await http(
      "PUT",
      `/nutrition/meal-plans/${plan.id}`,
      CLIENT_C,
      PLAN_BODY,
    );
    expect(put.status).toBe(403);
    expect(put.json.error).toBe("read_only");
    const del = await http(
      "DELETE",
      `/nutrition/meal-plans/${plan.id}`,
      CLIENT_C,
    );
    expect(del.status).toBe(403);
    const rows = await db.select().from(schema.nutritionPlans);
    expect(rows[0]).toMatchObject({ revision: 1, archivedAt: null });
  });

  it("gives 404 after removal or offboarding, and reports it to ?since=", async () => {
    const plan = await coachPlan();
    const sent = await assign(plan.id);
    const before = new Date(Date.now() - 1000).toISOString();
    const removed = await http(
      "DELETE",
      `/trainers/me/clients/${CLIENT_C}/meal-plans/${sent.json.data.id}`,
      COACH_A,
    );
    expect(removed.status).toBe(204);
    const removedAgain = await http(
      "DELETE",
      `/trainers/me/clients/${CLIENT_C}/meal-plans/${sent.json.data.id}`,
      COACH_A,
    );
    expect(removedAgain.status).toBe(204);
    expect(
      (await http("GET", `/nutrition/meal-plans/${plan.id}`, CLIENT_C)).status,
    ).toBe(404);
    const since = await http(
      "GET",
      `/nutrition/meal-plans?since=${encodeURIComponent(before)}`,
      CLIENT_C,
    );
    expect(since.json.data.deletedIds).toEqual([plan.id]);
    expect(since.json.data.fromCoaches).toEqual([]);

    // Re-send, then end coaching: the teardown removes it, and reviving the
    // relationship does not make it readable again.
    expect((await assign(plan.id)).status).toBe(201);
    expect(
      (await http("GET", `/nutrition/meal-plans/${plan.id}`, CLIENT_C)).status,
    ).toBe(200);
    await pg.exec(
      `update pt_client_relationships set status = 'ended' where id = '${REL_AC}'`,
    );
    expect(
      (await http("GET", `/nutrition/meal-plans/${plan.id}`, CLIENT_C)).status,
    ).toBe(404);
    expect(
      await db.transaction((tx) =>
        removePlanAssignmentsForRelationship(tx as never, REL_AC, COACH_A),
      ),
    ).toBe(1);
    await pg.exec(
      `update pt_client_relationships set status = 'active' where id = '${REL_AC}'`,
    );
    expect(
      (await http("GET", `/nutrition/meal-plans/${plan.id}`, CLIENT_C)).status,
    ).toBe(404);
    // Coach B's relationship is untouched by A's teardown.
    expect(REL_BC).not.toBe(REL_AC);
  });

  it("hides a plan whose coach account was deleted", async () => {
    const plan = await coachPlan();
    await assign(plan.id);
    // The plan and assignment are long settled; only the coach's account changes.
    await pg.exec(`
      update nutrition_plans set updated_at = now() - interval '1 day';
      update nutrition_plan_assignments set updated_at = now() - interval '1 day';
    `);
    const beforeDelete = new Date(Date.now() - 60_000).toISOString();
    // As AccountRepository.softDelete writes it.
    await pg.exec(
      `update profiles set deleted_at = now(), updated_at = now() where id = '${COACH_A}'`,
    );
    expect(
      (await http("GET", `/nutrition/meal-plans/${plan.id}`, CLIENT_C)).status,
    ).toBe(404);
    const list = await http("GET", "/nutrition/meal-plans", CLIENT_C);
    expect(list.json.data.fromCoaches).toEqual([]);
    // An offline client syncing with ?since= must learn the plan is gone…
    const synced = await http(
      "GET",
      `/nutrition/meal-plans?since=${encodeURIComponent(beforeDelete)}`,
      CLIENT_C,
    );
    expect(synced.json.data.deletedIds).toEqual([plan.id]);
    // …and get it back when the coach restores the account.
    const beforeRestore = new Date(Date.now() - 1000).toISOString();
    await pg.exec(
      `update profiles set deleted_at = null, updated_at = now() where id = '${COACH_A}'`,
    );
    const restored = await http(
      "GET",
      `/nutrition/meal-plans?since=${encodeURIComponent(beforeRestore)}`,
      CLIENT_C,
    );
    expect(restored.json.data.fromCoaches.map((f: Json) => f.plan.id)).toEqual([
      plan.id,
    ]);
    expect(restored.json.data.deletedIds).toEqual([]);
  });

  it("rejects assignment ids from another coach or client", async () => {
    const plan = await coachPlan();
    const sent = await assign(plan.id);
    const id = sent.json.data.id;
    const bPatch = await http(
      "PATCH",
      `/trainers/me/clients/${CLIENT_C}/meal-plans/${id}`,
      COACH_B,
      { note: "mine now" },
    );
    expect(bPatch.status).toBe(404);
    const bDelete = await http(
      "DELETE",
      `/trainers/me/clients/${CLIENT_C}/meal-plans/${id}`,
      COACH_B,
    );
    expect(bDelete.status).toBe(404);
    const badId = await http(
      "DELETE",
      `/trainers/me/clients/${CLIENT_C}/meal-plans/local-1`,
      COACH_A,
    );
    expect(badId.status).toBe(404);
    const patch = await http(
      "PATCH",
      `/trainers/me/clients/${CLIENT_C}/meal-plans/${id}`,
      COACH_A,
      { note: "  New note \u0000 " },
    );
    expect(patch.status).toBe(200);
    expect(patch.json.data.note).toBe("New note");
    const badPatch = await http(
      "PATCH",
      `/trainers/me/clients/${CLIENT_C}/meal-plans/local-1`,
      COACH_A,
      { note: null },
    );
    expect(badPatch.status).toBe(404);
    for (const method of ["GET", "POST"] as const) {
      const res = await http(
        method,
        `/trainers/me/clients/${ATHLETE_D}/meal-plans`,
        COACH_A,
        method === "POST" ? { planId: plan.id } : undefined,
      );
      expect(res.status).toBe(403);
    }
    for (const method of ["PATCH", "DELETE"] as const) {
      const res = await http(
        method,
        `/trainers/me/clients/${ATHLETE_D}/meal-plans/${id}`,
        COACH_A,
        method === "PATCH" ? { note: "x" } : undefined,
      );
      expect(res.status).toBe(403);
    }
  });
});

describe("live edit (Design D test 2)", () => {
  it("shows C the new revision with updatedSinceSeen and leaves logged food alone", async () => {
    const plan = await coachPlan();
    await assign(plan.id);
    const read = await http(
      "GET",
      `/nutrition/meal-plans/${plan.id}`,
      CLIENT_C,
    );
    const lunch = read.json.data.meals[1];

    // A Free client logs the coach plan's lunch (test 7), offline-style.
    const batch = await http("POST", "/nutrition/entries/batch", CLIENT_C, {
      entries: lunch.items.map((item: Json, i: number) => ({
        ...item.logEntry,
        mealSlot: lunch.logSlot,
        loggedAt: new Date().toISOString(),
        clientRequestId: `log-${i}`,
        sourcePlanId: plan.id,
        sourcePlanMealId: lunch.id,
      })),
    });
    expect(batch.status).toBe(200);
    expect(batch.json.data.results.every((r: Json) => r.entry)).toBe(true);
    const loggedBefore = await db
      .select()
      .from(schema.nutritionEntries)
      .where(eq(schema.nutritionEntries.userId, CLIENT_C));
    expect(loggedBefore.map((e) => Number(e.kcal)).sort()).toEqual([
      104, 200, 500,
    ]);

    const edited = await http(
      "PUT",
      `/trainers/me/meal-plans/${plan.id}`,
      COACH_A,
      {
        ...PLAN_BODY,
        name: "Training day v2",
        meals: [PLAN_BODY.meals[0]],
        expectedRevision: 1,
      },
    );
    expect(edited.status).toBe(200);
    expect(edited.json.data.revision).toBe(2);
    const stale = await http(
      "PUT",
      `/trainers/me/meal-plans/${plan.id}`,
      COACH_A,
      {
        ...PLAN_BODY,
        expectedRevision: 1,
      },
    );
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({
      error: "revision_conflict",
      current: { revision: 2, name: "Training day v2" },
    });
    // Without expectedRevision (older apps) the last write wins.
    const lww = await http("PUT", `/nutrition/meal-plans/${plan.id}`, COACH_A, {
      ...PLAN_BODY,
      name: "Training day v3",
      meals: [PLAN_BODY.meals[0]],
    });
    expect(lww.json.data.revision).toBe(3);

    const list = await http("GET", "/nutrition/meal-plans", CLIENT_C);
    const fromCoach = list.json.data.fromCoaches[0];
    expect(fromCoach.plan).toMatchObject({
      revision: 3,
      name: "Training day v3",
    });
    expect(fromCoach.plan.meals).toHaveLength(1);
    expect(fromCoach.updatedSinceSeen).toBe(true);

    const loggedAfter = await db
      .select()
      .from(schema.nutritionEntries)
      .where(eq(schema.nutritionEntries.userId, CLIENT_C));
    expect(loggedAfter).toEqual(loggedBefore);

    const seen = await http(
      "POST",
      `/nutrition/meal-plans/${plan.id}/assignment`,
      CLIENT_C,
      {
        status: "added",
        seenRevision: 99,
      },
    );
    expect(seen.status).toBe(200);
    expect(seen.json.data).toMatchObject({
      status: "added",
      seenRevision: 3,
      updatedSinceSeen: false,
    });
    expect(seen.json.data.addedAt).not.toBeNull();

    // The coach sees usage and the client's target.
    await pg.exec(`insert into nutrition_targets (user_id, daily_kcal, protein_g, carbs_g, fat_g, set_by_user_id)
      values ('${CLIENT_C}', 2200, 160, 220, 70, '${COACH_A}')`);
    const coachView = await http(
      "GET",
      `/trainers/me/clients/${CLIENT_C}/meal-plans`,
      COACH_A,
    );
    expect(coachView.status).toBe(200);
    expect(coachView.json.data.target).toMatchObject({
      dailyKcal: 2200,
      setByUserId: COACH_A,
    });
    expect(coachView.json.data.assignments[0]).toMatchObject({
      status: "added",
      usedDays: 1,
      loggedThisWeek: 3,
      updatedSinceSeen: false,
    });
    expect(await countPlanEntries(CLIENT_C, plan.id, new Date(0))).toBe(3);
  });

  it("lets the client dismiss, and the coach re-send a dismissed plan", async () => {
    const plan = await coachPlan();
    await assign(plan.id);
    const notNow = await http(
      "POST",
      `/nutrition/meal-plans/${plan.id}/assignment`,
      CLIENT_C,
      {
        status: "dismissed",
      },
    );
    expect(notNow.json.data.status).toBe("dismissed");
    // Dismissed isn't readable (access rule: sent or added).
    expect(
      (await http("GET", `/nutrition/meal-plans/${plan.id}`, CLIENT_C)).status,
    ).toBe(404);
    const resent = await assign(plan.id);
    expect(resent.status).toBe(201);
    expect(resent.json.data.status).toBe("sent");
    expect(push.dispatchExisting).toHaveBeenCalledTimes(2);
    const missing = await http(
      "POST",
      `/nutrition/meal-plans/${randomUUID()}/assignment`,
      CLIENT_C,
      {},
    );
    expect(missing.status).toBe(404);
    const archived = await http(
      "DELETE",
      `/trainers/me/meal-plans/${plan.id}`,
      COACH_A,
    );
    expect(archived.status).toBe(204);
    const gone = await http(
      "POST",
      `/nutrition/meal-plans/${plan.id}/assignment`,
      CLIENT_C,
      {},
    );
    expect(gone.status).toBe(404);
  });
});

describe("duplicate and recipe share (Design D test 6)", () => {
  it("copies a coach plan for a Free client with attribution, replay-safe", async () => {
    const plan = await coachPlan();
    await assign(plan.id);
    const dup = await http(
      "POST",
      `/nutrition/meal-plans/${plan.id}/duplicate`,
      CLIENT_C,
      undefined,
      "dup-1",
    );
    expect(dup.status).toBe(201);
    const copy = dup.json.data;
    expect(copy).toMatchObject({
      ownerId: CLIENT_C,
      source: "duplicate",
      sourcePlanId: plan.id,
    });
    expect(copy.totals).toEqual(plan.totals);
    const [breakfast, lunch] = copy.meals;
    // Shared catalogue food: same id. Coach's private food: copied, not dropped.
    expect(breakfast.items[0].foodId).toBe(OATS);
    expect(breakfast.items[1].foodId).not.toBe(GRANOLA);
    expect(breakfast.items[1]).toMatchObject({
      name: "Coach granola",
      kcal: 450,
    });
    const granolaCopy = await db
      .select()
      .from(schema.foods)
      .where(eq(schema.foods.id, breakfast.items[1].foodId));
    expect(granolaCopy[0]).toMatchObject({
      createdBy: CLIENT_C,
      source: "user",
    });
    // Recipe: copied into C's recipes with attribution, ingredients included.
    const recipeCopy = await db
      .select()
      .from(schema.recipes)
      .where(eq(schema.recipes.userId, CLIENT_C));
    expect(recipeCopy).toHaveLength(1);
    expect(recipeCopy[0]).toMatchObject({
      sourceRecipeId: RECIPE_A,
      sharedByUserId: COACH_A,
      name: "Chicken rice",
    });
    expect(lunch.items[0]).toMatchObject({
      recipeId: recipeCopy[0].id,
      logEntry: { recipeId: recipeCopy[0].id, servings: 1 },
    });
    const ings = await db
      .select()
      .from(schema.recipeIngredients)
      .where(eq(schema.recipeIngredients.recipeId, recipeCopy[0].id));
    expect(ings).toHaveLength(3);
    expect(ings.find((i) => i.sortOrder === 1)!.foodId).toBe(
      breakfast.items[1].foodId,
    );
    // Saved meal: flattened to a one-off with the same macros.
    expect(lunch.items[1]).toMatchObject({
      kind: "custom",
      name: "Protein shake",
      kcal: 200,
    });

    const replay = await http(
      "POST",
      `/nutrition/meal-plans/${plan.id}/duplicate`,
      CLIENT_C,
      undefined,
      "dup-1",
    );
    expect(replay.json.data.id).toBe(copy.id);
    const second = await http(
      "POST",
      `/nutrition/meal-plans/${plan.id}/duplicate`,
      CLIENT_C,
      undefined,
      "dup-2",
    );
    expect(second.json.data.id).not.toBe(copy.id);
    // The recipe copy is reused, never doubled.
    expect(
      await db
        .select()
        .from(schema.recipes)
        .where(eq(schema.recipes.userId, CLIENT_C)),
    ).toHaveLength(1);

    // The copy is C's: editable without a subscription, and listed under mine.
    const edit = await http(
      "PUT",
      `/nutrition/meal-plans/${copy.id}`,
      CLIENT_C,
      {
        name: "My version",
        meals: [
          {
            name: "Lunch",
            logSlot: "lunch",
            items: [{ recipeId: recipeCopy[0].id, servings: 2 }],
          },
        ],
        expectedRevision: 1,
      },
    );
    expect(edit.status).toBe(200);
    expect(edit.json.data.totals.kcal).toBe(1000);
    const mine = await http("GET", "/nutrition/meal-plans", CLIENT_C);
    expect(mine.json.data.mine.map((p: Json) => p.id).sort()).toEqual(
      [copy.id, second.json.data.id].sort(),
    );

    // A replay still answers once the source is gone; a fresh key doesn't.
    await http("DELETE", `/trainers/me/meal-plans/${plan.id}`, COACH_A);
    const late = await http(
      "POST",
      `/nutrition/meal-plans/${plan.id}/duplicate`,
      CLIENT_C,
      undefined,
      "dup-1",
    );
    expect(late.json.data.id).toBe(copy.id);
    const fresh = await http(
      "POST",
      `/nutrition/meal-plans/${plan.id}/duplicate`,
      CLIENT_C,
    );
    expect(fresh.status).toBe(404);
  });

  it("duplicates the owner's own plan by reference, and flattens deleted sources", async () => {
    const own = await http("POST", "/nutrition/meal-plans", COACH_A, PLAN_BODY);
    const dup = await http(
      "POST",
      `/nutrition/meal-plans/${own.json.data.id}/duplicate`,
      COACH_A,
    );
    expect(dup.status).toBe(201);
    expect(dup.json.data.meals[1].items[0].recipeId).toBe(RECIPE_A);
    expect(await db.select().from(schema.recipes)).toHaveLength(1);

    // The coach deletes the recipe and the private food goes: the client's
    // duplicate keeps the items as one-offs with the same macros.
    const plan = await coachPlan();
    await assign(plan.id);
    await pg.exec(`
      delete from recipes where id = '${RECIPE_A}';
      update nutrition_plan_items set food_id = '${randomUUID()}' where food_id = '${GRANOLA}';
    `);
    const read = await http(
      "GET",
      `/nutrition/meal-plans/${plan.id}`,
      CLIENT_C,
    );
    const lunchItem = read.json.data.meals[1].items[0];
    expect(lunchItem).toMatchObject({
      recipe: null,
      name: "Chicken rice",
      kcal: 500,
    });
    const copy = await http(
      "POST",
      `/nutrition/meal-plans/${plan.id}/duplicate`,
      CLIENT_C,
    );
    const items = copy.json.data.meals.flatMap((m: Json) => m.items);
    expect(items[1]).toMatchObject({
      kind: "custom",
      name: "Coach granola",
      kcal: 450,
    });
    expect(items[2]).toMatchObject({
      kind: "custom",
      name: "Chicken rice",
      kcal: 500,
    });
    expect(
      (
        await http(
          "POST",
          `/nutrition/meal-plans/${randomUUID()}/duplicate`,
          CLIENT_C,
        )
      ).status,
    ).toBe(404);
  });

  it("shares a coach recipe as an attributed copy, idempotent per client", async () => {
    const share = () =>
      http(
        "POST",
        `/trainers/me/clients/${CLIENT_C}/recipes/${RECIPE_A}/share`,
        COACH_A,
      );
    const first = await share();
    expect(first.status).toBe(201);
    expect(first.json.data).toMatchObject({
      sourceRecipeId: RECIPE_A,
      sharedByUserId: COACH_A,
      created: true,
    });
    const again = await share();
    expect(again.status).toBe(200);
    expect(again.json.data.recipeId).toBe(first.json.data.recipeId);
    const copies = await db
      .select()
      .from(schema.recipes)
      .where(and(eq(schema.recipes.userId, CLIENT_C)));
    expect(copies).toHaveLength(1);
    const audit = await db.select().from(schema.trainerActionsAudit);
    expect(audit.map((a) => a.actionType)).toEqual(["recipe_shared"]);
    // Coach B can't share A's recipe; nobody can share to a non-client.
    const stolen = await http(
      "POST",
      `/trainers/me/clients/${CLIENT_C}/recipes/${RECIPE_A}/share`,
      COACH_B,
    );
    expect(stolen.status).toBe(404);
    const badId = await http(
      "POST",
      `/trainers/me/clients/${CLIENT_C}/recipes/local-1/share`,
      COACH_A,
    );
    expect(badId.status).toBe(404);
    const notClient = await http(
      "POST",
      `/trainers/me/clients/${ATHLETE_D}/recipes/${RECIPE_A}/share`,
      COACH_A,
    );
    expect(notClient.status).toBe(403);
  });
});

describe("lists, archive and shopping list", () => {
  it("reports archived plans in deletedIds and archives idempotently", async () => {
    const plan = await coachPlan();
    await assign(plan.id);
    const before = new Date(Date.now() - 1000).toISOString();
    expect(
      (await http("DELETE", `/trainers/me/meal-plans/${plan.id}`, COACH_A))
        .status,
    ).toBe(204);
    expect(
      (await http("DELETE", `/nutrition/meal-plans/${plan.id}`, COACH_A))
        .status,
    ).toBe(204);
    const lib = await http(
      "GET",
      `/trainers/me/meal-plans?since=${encodeURIComponent(before)}`,
      COACH_A,
    );
    expect(lib.json.data).toMatchObject({ plans: [], deletedIds: [plan.id] });
    const statuses = await db.select().from(schema.nutritionPlanAssignments);
    expect(statuses.map((s) => s.status)).toEqual(["removed"]);
    expect(
      (await http("GET", `/trainers/me/meal-plans/${plan.id}`, COACH_A)).status,
    ).toBe(404);
    expect(
      (
        await http(
          "PUT",
          `/trainers/me/meal-plans/${plan.id}`,
          COACH_A,
          PLAN_BODY,
        )
      ).status,
    ).toBe(404);
    const bad = await http(
      "GET",
      "/nutrition/meal-plans?since=yesterday",
      CLIENT_C,
    );
    expect(bad.status).toBe(400);
    const badLib = await http(
      "GET",
      "/trainers/me/meal-plans?since=nope",
      COACH_A,
    );
    expect(badLib.status).toBe(400);
    expect(parseSince("")).toBeNull();
    const coachGet = await http(
      "GET",
      `/trainers/me/meal-plans/${randomUUID()}`,
      COACH_A,
    );
    expect(coachGet.status).toBe(404);
  });

  it("validates a PUT body like a create", async () => {
    const plan = await coachPlan();
    const res = await http(
      "PUT",
      `/trainers/me/meal-plans/${plan.id}`,
      COACH_A,
      {
        name: "x",
        meals: [
          {
            name: "M",
            logSlot: "lunch",
            items: [{ foodId: randomUUID(), servings: 1 }],
          },
        ],
      },
    );
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("food_not_found");
  });

  it("builds the shopping list from added plans the reader can still read", async () => {
    const plan = await coachPlan();
    const sent = await assign(plan.id);
    const add = () =>
      http("POST", "/nutrition/shopping-list/plans", CLIENT_C, {
        nutritionPlanId: plan.id,
      });
    expect((await add()).status).toBe(200);
    const res = await add();
    expect(res.status).toBe(200);
    const list = res.json.data;
    expect(list.plans).toHaveLength(1);
    const lines = Object.fromEntries(
      list.aisles.flatMap((a: Json) =>
        a.items.map((i: Json) => [i.name, i.quantity]),
      ),
    );
    // Oats 0.8 × 100 g; the recipe's one serving of two = half its ingredients.
    expect(lines).toMatchObject({
      Oats: "80g",
      Rice: "150g",
      "Coach granola": "75g",
      Salt: "0.5 tsp",
    });
    const other = await coachPlan(COACH_A, { ...PLAN_BODY, name: "Secret" });
    const denied = await http(
      "POST",
      "/nutrition/shopping-list/plans",
      CLIENT_C,
      {
        nutritionPlanId: other.id,
      },
    );
    expect(denied.status).toBe(404);
    expect(
      (await http("POST", "/nutrition/shopping-list/plans", CLIENT_C, {}))
        .status,
    ).toBe(400);
    expect(
      (
        await http("POST", "/nutrition/shopping-list/plans", CLIENT_C, {
          mealPlanId: randomUUID(),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await http("POST", "/nutrition/shopping-list/plans", CLIENT_C, {
          mealPlanId: "local-1",
        })
      ).status,
    ).toBe(404);

    // Removed by the coach: drops out of the list.
    await http(
      "DELETE",
      `/trainers/me/clients/${CLIENT_C}/meal-plans/${sent.json.data.id}`,
      COACH_A,
    );
    const after = await http("GET", "/nutrition/shopping-list", CLIENT_C);
    expect(after.json.data).toMatchObject({ plans: [], totalItems: 0 });
    expect(
      (
        await http(
          "DELETE",
          `/nutrition/shopping-list/plans/${plan.id}`,
          CLIENT_C,
        )
      ).status,
    ).toBe(204);
    expect(
      (await http("DELETE", "/nutrition/shopping-list/plans/local-1", CLIENT_C))
        .status,
    ).toBe(204);
    expect(await db.select().from(schema.shoppingListPlans)).toHaveLength(0);
  });

  it("includes saved-meal items in the shopping list", async () => {
    await pg.exec(`insert into meal_items (meal_id, food_id, servings, sort_order)
      values ('${SHAKE_A}', '${OATS}', 1, 0)`);
    const plan = await coachPlan(COACH_A, {
      name: "Shake",
      meals: [
        {
          name: "Snack",
          logSlot: "snack",
          items: [{ mealId: SHAKE_A, servings: 2 }],
        },
      ],
    });
    await http("POST", "/nutrition/shopping-list/plans", COACH_A, {
      nutritionPlanId: plan.id,
    });
    const list = await http("GET", "/nutrition/shopping-list", COACH_A);
    expect(list.json.data.aisles.flatMap((a: Json) => a.items)).toEqual([
      expect.objectContaining({ name: "Oats", quantity: "200g" }),
    ]);
  });
});

describe("shopping list with a Mealprint plan", () => {
  it("adds owned Mealprint plans, counted only while Mealprint is unlocked", async () => {
    const MEALPRINT = randomUUID();
    await pg.exec(`
      insert into subscription_tiers (tier_name, display_name, price_monthly, mealprint_access)
        values ('premium_plus', 'Premium+', 24.99, true);
      update user_subscriptions set tier_name = 'premium_plus' where user_id = '${PREMIUM_P}';
      insert into meal_plans (id, user_id, status, plan_date, meals_per_day, effort_level,
          target_kcal, target_protein_g, target_carbs_g, target_fat_g, source)
        values ('${MEALPRINT}', '${PREMIUM_P}', 'active', '2026-11-21', 1, 'quick', 2000, 150, 200, 60, 'ai');
      insert into meal_plan_meals (plan_id, sort_order, label, log_slot, items, kcal, protein_g, carbs_g, fat_g)
        values ('${MEALPRINT}', 0, 'Lunch', 'lunch', '[{"foodId":"${OATS}","servings":2}]', 760, 26, 120, 14);
    `);
    const added = await http(
      "POST",
      "/nutrition/shopping-list/plans",
      PREMIUM_P,
      {
        mealPlanId: MEALPRINT,
      },
    );
    expect(added.status).toBe(200);
    expect(added.json.data.plans).toEqual([
      expect.objectContaining({ mealPlanId: MEALPRINT, nutritionPlanId: null }),
    ]);
    expect(added.json.data.aisles.flatMap((a: Json) => a.items)).toEqual([
      expect.objectContaining({ name: "Oats", quantity: "200g" }),
    ]);
    // Another person's Mealprint plan can't be added.
    const theirs = await http(
      "POST",
      "/nutrition/shopping-list/plans",
      CLIENT_C,
      {
        mealPlanId: MEALPRINT,
      },
    );
    expect(theirs.status).toBe(404);
    // Mealprint locked: the plan stays added but adds nothing.
    await pg.exec(
      `update subscription_tiers set mealprint_access = false where tier_name = 'premium_plus'`,
    );
    const locked = await http("GET", "/nutrition/shopping-list", PREMIUM_P);
    expect(locked.json.data).toMatchObject({ plans: [], totalItems: 0 });
    await pg.exec(`update subscription_tiers set mealprint_access = true where tier_name = 'premium_plus';
      update foods set nutrition_data_valid = false, source = 'openfoodfacts' where id = '${OATS}';`);
    const quarantined = await http(
      "GET",
      "/nutrition/shopping-list",
      PREMIUM_P,
    );
    expect(quarantined.status).toBe(200);
  });
});

describe("shopping list: one recipe in several plans", () => {
  it("counts a recipe's ingredients once per use, not once per plan holding it", async () => {
    const RECIPE_P = randomUUID();
    const DAY1 = randomUUID();
    const DAY2 = randomUUID();
    await pg.exec(`
      insert into subscription_tiers (tier_name, display_name, price_monthly, mealprint_access)
        values ('premium_plus', 'Premium+', 24.99, true);
      update user_subscriptions set tier_name = 'premium_plus' where user_id = '${PREMIUM_P}';
      insert into recipes (id, user_id, name, servings, total_kcal, total_protein_g, total_carbs_g, total_fat_g)
        values ('${RECIPE_P}', '${PREMIUM_P}', 'Rice bowl', 2, 1000, 40, 180, 10);
      insert into recipe_ingredients (recipe_id, food_id, quantity, unit, sort_order)
        values ('${RECIPE_P}', '${RICE}', 300, 'g', 0);
      insert into meal_plans (id, user_id, status, plan_date, meals_per_day, effort_level,
          target_kcal, target_protein_g, target_carbs_g, target_fat_g, source)
        values ('${DAY1}', '${PREMIUM_P}', 'active', '2026-11-21', 1, 'quick', 2000, 150, 200, 60, 'ai'),
               ('${DAY2}', '${PREMIUM_P}', 'active', '2026-11-22', 1, 'quick', 2000, 150, 200, 60, 'ai');
      insert into meal_plan_meals (plan_id, sort_order, label, log_slot, recipe_id, kcal, protein_g, carbs_g, fat_g)
        values ('${DAY1}', 0, 'Lunch', 'lunch', '${RECIPE_P}', 500, 20, 90, 5),
               ('${DAY2}', 0, 'Lunch', 'lunch', '${RECIPE_P}', 500, 20, 90, 5);
    `);
    // A list plan using the same recipe too.
    const listPlan = await http("POST", "/nutrition/meal-plans", PREMIUM_P, {
      name: "Bowls",
      meals: [
        {
          name: "Dinner",
          logSlot: "dinner",
          items: [{ recipeId: RECIPE_P, servings: 1 }],
        },
      ],
    });
    expect(listPlan.status).toBe(201);
    for (const body of [
      { mealPlanId: DAY1 },
      { mealPlanId: DAY2 },
      { nutritionPlanId: listPlan.json.data.id },
    ]) {
      expect(
        (await http("POST", "/nutrition/shopping-list/plans", PREMIUM_P, body))
          .status,
      ).toBe(200);
    }
    const list = await http("GET", "/nutrition/shopping-list", PREMIUM_P);
    expect(list.json.data.plans).toHaveLength(3);
    // Three uses of half the recipe each: 3 × 150 g.
    expect(list.json.data.aisles.flatMap((a: Json) => a.items)).toEqual([
      expect.objectContaining({ name: "Rice", quantity: "450g" }),
    ]);
  });
});

describe("set-up section meal_plan (BE-A1 hook)", () => {
  it("is live in HANDLERS and validates, materialises, previews and copies", async () => {
    expect(sectionHandler("meal_plan")).toBe(mealPlanSetupHandler);
    const plan = await coachPlan();
    const ok = await mealPlanSetupHandler.validate(db as never, COACH_A, {
      refId: plan.id,
      config: { note: "  Start here " },
      sortOrder: 0,
    });
    expect(ok).toEqual({
      ok: true,
      item: { refId: plan.id, config: { note: "Start here" }, sortOrder: 0 },
    });
    const noNote = await mealPlanSetupHandler.validate(db as never, COACH_A, {
      refId: plan.id,
      config: {},
      sortOrder: 1,
    });
    expect(noNote.ok && noNote.item.config).toEqual({});
    for (const [trainer, item] of [
      [COACH_B, { refId: plan.id, config: {}, sortOrder: 0 }],
      [COACH_A, { refId: null, config: {}, sortOrder: 0 }],
      [COACH_A, { refId: plan.id, config: { note: 5 }, sortOrder: 0 }],
      [
        COACH_A,
        { refId: plan.id, config: { note: "x".repeat(501) }, sortOrder: 0 },
      ],
    ] as const) {
      expect(
        (await mealPlanSetupHandler.validate(db as never, trainer, item)).ok,
      ).toBe(false);
    }

    const setupItem = {
      id: randomUUID(),
      profileId: randomUUID(),
      section: "meal_plan",
      refId: plan.id,
      config: { note: "Start here" },
      sortOrder: 0,
    } as unknown as schema.CoachClientSetupItem;
    const result = await db.transaction((tx) =>
      mealPlanSetupHandler.materialise(
        {
          tx: tx as never,
          trainerId: COACH_A,
          clientId: CLIENT_C,
          relationshipId: REL_AC,
        },
        setupItem,
      ),
    );
    expect(result.refId).toBeTruthy();
    await result.afterCommit!();
    expect(push.dispatchExisting).toHaveBeenCalledTimes(1);
    const read = await http(
      "GET",
      `/nutrition/meal-plans/${plan.id}`,
      CLIENT_C,
    );
    expect(read.json.data.assignment).toMatchObject({
      note: "Start here",
      status: "sent",
    });

    expect(
      await mealPlanSetupHandler.preview!(db as never, [setupItem]),
    ).toEqual({
      plans: [{ name: "Training day" }],
    });
    expect(await mealPlanSetupHandler.preview!(db as never, [])).toEqual({
      plans: [],
    });
    expect(
      await mealPlanSetupHandler.copyFromClient!(
        db as never,
        COACH_A,
        CLIENT_C,
      ),
    ).toEqual([
      { refId: plan.id, config: { note: "Start here" }, sortOrder: 0 },
    ]);

    // An archived plan materialises to nothing rather than failing the accept.
    await http("DELETE", `/trainers/me/meal-plans/${plan.id}`, COACH_A);
    const none = await db.transaction((tx) =>
      mealPlanSetupHandler.materialise(
        {
          tx: tx as never,
          trainerId: COACH_A,
          clientId: CLIENT_C,
          relationshipId: REL_AC,
        },
        setupItem,
      ),
    );
    expect(none).toEqual({ refId: null });
  });
});

describe("migration (forward twice, down, up)", () => {
  it("is idempotent and reversible, and leaves existing rows alone", async () => {
    const fresh = await baseDatabase();
    await fresh.exec(`
      insert into profiles (id) values ('${CLIENT_C}');
      insert into recipes (id, user_id, name) values ('${RECIPE_A}', '${CLIENT_C}', 'Soup');
    `);
    const forward = await read(MIGRATIONS, MIGRATION);
    await fresh.exec(forward);
    await fresh.exec(forward);
    const enumValues = await fresh.query<{ v: string }>(
      "select unnest(enum_range(null::notification_type))::text as v",
    );
    expect(enumValues.rows.map((r) => r.v)).toContain("meal_plan_assigned");
    // CHECKs fire.
    await expect(
      fresh.exec(
        `insert into nutrition_plans (owner_id, name, source) values ('${CLIENT_C}', 'x', 'weekly')`,
      ),
    ).rejects.toThrow();
    await fresh.exec(
      `insert into nutrition_plans (id, owner_id, name) values ('${OATS}', '${CLIENT_C}', 'x');
       insert into nutrition_plan_meals (id, plan_id, name, log_slot) values ('${RICE}', '${OATS}', 'M', 'lunch');`,
    );
    await expect(
      fresh.exec(
        `insert into nutrition_plan_items (plan_meal_id, servings, kcal, protein_g, carbs_g, fat_g)
         values ('${RICE}', 1, 0, 0, 0, 0)`,
      ),
    ).rejects.toThrow();
    await expect(
      fresh.exec(
        `insert into shopping_list_plans (user_id) values ('${CLIENT_C}')`,
      ),
    ).rejects.toThrow();

    await fresh.exec(await read(ROLLBACKS, MIGRATION));
    const tables = await fresh.query<{ n: number }>(
      "select count(*)::int as n from information_schema.tables where table_name like 'nutrition_plan%'",
    );
    expect(tables.rows[0].n).toBe(0);
    await fresh.exec(forward);
    const recipe = await fresh.query<{
      name: string;
      source_recipe_id: string | null;
    }>(`select name, source_recipe_id from recipes where id = '${RECIPE_A}'`);
    expect(recipe.rows).toEqual([{ name: "Soup", source_recipe_id: null }]);
    await fresh.close();
  });
});

describe("save a Mealprint day as a list plan (PER-119, Design D test 5)", () => {
  const DATED = randomUUID();
  const OWN_FOOD = randomUUID(); // Pat's food: 200 kcal per 50 g, pack serving 100 g
  const OWN_RECIPE = randomUUID(); // Pat's recipe: 4 servings, 2000 kcal
  const OWN_MEAL = randomUUID(); // Pat's saved meal: 300 kcal
  const LONG_LABEL =
    "Post-training protein-packed chicken rice bowl with greens";

  async function seedDated(owner = PREMIUM_P, recipe = OWN_RECIPE) {
    await pg.exec(`
      insert into foods (id, name, kcal, protein_g, carbs_g, fat_g, serving_size, serving_unit, serving_quantity, source, created_by)
        values ('${OWN_FOOD}', 'Pat yogurt', 200, 20, 10, 5, 50, 'g', 100, 'user', '${PREMIUM_P}');
      insert into recipes (id, user_id, name, servings, total_kcal, total_protein_g, total_carbs_g, total_fat_g)
        values ('${OWN_RECIPE}', '${PREMIUM_P}', 'Pat chilli', 4, 2000, 160, 200, 40);
      insert into meals (id, user_id, name, total_kcal, total_protein_g, total_carbs_g, total_fat_g)
        values ('${OWN_MEAL}', '${PREMIUM_P}', 'Pat shake', 300, 30, 20, 5);
      insert into meal_plans (id, user_id, status, plan_date, meals_per_day, effort_level,
          target_kcal, target_protein_g, target_carbs_g, target_fat_g, source, accepted_at)
        values ('${DATED}', '${owner}', 'active', '2026-11-20', 4, 'balanced', 2400, 180, 250, 70, 'ai', now());
      insert into meal_plan_meals (plan_id, sort_order, label, log_slot, recipe_id, meal_id, items, kcal, protein_g, carbs_g, fat_g, ai_reason, state)
        values
        ('${DATED}', 0, 'Yogurt bowl', 'breakfast', null, null,
          '[{"foodId":"${OWN_FOOD}","servings":1.5}]', 600, 60, 30, 15, 'r', 'planned'),
        ('${DATED}', 1, '${LONG_LABEL}', 'lunch', '${recipe}', null,
          '[{"foodId":"${OATS}","servings":1}]', 1130, 133, 210, 22, 'r', 'logged'),
        ('${DATED}', 2, 'Shake', 'snack', null, '${OWN_MEAL}', null, 600, 60, 40, 10, 'r', 'planned'),
        ('${DATED}', 3, 'Leftovers', 'dinner', null, null, null, 450, 35, 40, 12, 'r', 'planned');
    `);
  }

  async function datedSnapshot() {
    const plan = await pg.query(
      `select status, plan_date::text from meal_plans where id = '${DATED}'`,
    );
    const meals = await pg.query(
      `select sort_order, label, state, kcal::float from meal_plan_meals where plan_id = '${DATED}' order by sort_order`,
    );
    return { plan: plan.rows, meals: meals.rows };
  }

  async function saveDay(actor: string, body: object, key?: string) {
    return http("POST", "/nutrition/meal-plans", actor, body, key);
  }

  it("creates a list plan with no dates and leaves the dated plan unchanged", async () => {
    await seedDated();
    const before = await datedSnapshot();
    const res = await saveDay(PREMIUM_P, { fromMealprintPlanId: DATED });
    expect(res.status).toBe(201);
    const plan = res.json.data;
    expect(plan).toMatchObject({
      ownerId: PREMIUM_P,
      name: "Mealprint",
      source: "mealprint",
      sourcePlanId: DATED,
      revision: 1,
    });
    expect(JSON.stringify(plan)).not.toContain("2026-11-20");
    expect(plan.meals.map((m: Json) => [m.name, m.logSlot])).toEqual([
      ["Yogurt bowl", "breakfast"],
      [LONG_LABEL.slice(0, 40).trim(), "lunch"],
      ["Shake", "snack"],
      ["Leftovers", "dinner"],
    ]);
    const [breakfast, lunch, snack, dinner] = plan.meals;
    // 1.5 pack servings of 100 g = 3 × the 50 g row.
    expect(breakfast.items).toMatchObject([
      { kind: "food", foodId: OWN_FOOD, servings: 3, kcal: 600 },
    ]);
    expect(breakfast.totals.kcal).toBe(600);
    // (1130 − 380 oats) / 500 per serving = 1.5 servings of the recipe.
    expect(lunch.items).toMatchObject([
      { kind: "recipe", recipeId: OWN_RECIPE, servings: 1.5, kcal: 750 },
      { kind: "food", foodId: OATS, servings: 1, kcal: 380 },
    ]);
    expect(lunch.totals.kcal).toBe(1130);
    expect(snack.items).toMatchObject([
      { kind: "meal", mealId: OWN_MEAL, servings: 2, kcal: 600 },
    ]);
    // Every source gone: the frozen macros survive as a one-off.
    expect(dinner.items).toMatchObject([
      {
        kind: "custom",
        servings: 1,
        custom: {
          name: "Leftovers",
          kcal: 450,
          proteinG: 35,
          carbsG: 40,
          fatG: 12,
        },
      },
    ]);
    expect(await datedSnapshot()).toEqual(before);

    const list = await http("GET", "/nutrition/meal-plans", PREMIUM_P);
    expect(list.json.data.mine.map((p: Json) => p.id)).toEqual([plan.id]);
  });

  it("takes a name and is replay-safe on its Idempotency-Key", async () => {
    await seedDated();
    const key = randomUUID();
    const body = { fromMealprintPlanId: DATED, name: "Training day" };
    const first = await saveDay(PREMIUM_P, body, key);
    expect(first.status).toBe(201);
    expect(first.json.data.name).toBe("Training day");
    // A replay answers with the first plan, even after the dated plan went.
    await pg.exec(`delete from meal_plans where id = '${DATED}'`);
    const again = await saveDay(PREMIUM_P, body, key);
    expect(again.status).toBe(201);
    expect(again.json.data.id).toBe(first.json.data.id);
    const count = await pg.query<{ n: number }>(
      `select count(*)::int as n from nutrition_plans where owner_id = '${PREMIUM_P}'`,
    );
    expect(count.rows[0].n).toBe(1);
  });

  it("404s another person's or an unknown Mealprint plan", async () => {
    await seedDated(ATHLETE_D);
    const other = await saveDay(PREMIUM_P, { fromMealprintPlanId: DATED });
    expect(other.status).toBe(404);
    expect(other.json).toEqual({ error: "mealprint_plan_not_found" });
    const unknown = await saveDay(PREMIUM_P, {
      fromMealprintPlanId: randomUUID(),
    });
    expect(unknown.status).toBe(404);
  });

  it("needs manual_meal_plans like any create", async () => {
    await seedDated(ATHLETE_D);
    const res = await saveDay(ATHLETE_D, { fromMealprintPlanId: DATED });
    expect(res.status).toBe(403);
    expect(res.json.error).toBe("manual_meal_plans");
  });

  it("409s when a source no longer resolves for the owner", async () => {
    // Coach A's recipe in Pat's day: not Pat's, so it never resolves.
    await seedDated(PREMIUM_P, RECIPE_A);
    const res = await saveDay(PREMIUM_P, { fromMealprintPlanId: DATED });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({
      error: "plan_meal_nutrition_unavailable",
      items: [`recipe:${RECIPE_A}`],
    });
    const count = await pg.query<{ n: number }>(
      "select count(*)::int as n from nutrition_plans",
    );
    expect(count.rows[0].n).toBe(0);
  });

  it("rejects a malformed id and still accepts the manual body", async () => {
    const bad = await saveDay(PREMIUM_P, { fromMealprintPlanId: "not-a-uuid" });
    expect(bad.status).toBe(422);
    await seedDated();
    const blank = await saveDay(PREMIUM_P, {
      fromMealprintPlanId: DATED,
      name: "   ",
    });
    expect(blank.status).toBe(400);
    expect(blank.json).toEqual({ error: "invalid_plan_name" });
    const manual = await saveDay(PREMIUM_P, { name: "Mine", meals: [] });
    expect(manual.status).toBe(201);
    expect(manual.json.data.source).toBe("manual");
  });
});
