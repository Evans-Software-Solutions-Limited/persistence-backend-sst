/** @jest-environment node */
import { DatabaseSync } from "node:sqlite";
import type { StoragePort } from "@/domain/ports/storage.port";
import type {
  NutritionPlan,
  NutritionPlansCache,
  PlansShoppingCache,
} from "@/domain/models/nutritionPlans";
import { emptyPlansCache } from "@/domain/models/nutritionPlans";
import { InMemoryStorageAdapter } from "./in-memory-storage.adapter";
import { SQLiteStorageAdapter } from "../sqlite.adapter";

/** The SQLite adapter on node's SQLite, with the PER-133 cache DDL it ships. */
function sqliteAdapter(): { adapter: StoragePort; db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE cached_nutrition_plans (user_id TEXT PRIMARY KEY, payload TEXT NOT NULL, synced_at TEXT NOT NULL);
    CREATE TABLE cached_plans_shopping (user_id TEXT PRIMARY KEY, payload TEXT NOT NULL, synced_at TEXT NOT NULL);
    CREATE TABLE sync_queue (id INTEGER PRIMARY KEY, entity_type TEXT, entity_id TEXT, endpoint TEXT, payload TEXT, status TEXT);
  `);
  type P = (string | number | null)[];
  const adapter = new SQLiteStorageAdapter();
  Object.assign(adapter, {
    db: {
      getAllSync: (q: string, p: P = []) => db.prepare(q).all(...p),
      getFirstSync: (q: string, p: P = []) => db.prepare(q).get(...p) ?? null,
      runSync: (q: string, p: P = []) => db.prepare(q).run(...p),
      execSync: (q: string) => db.exec(q),
      withTransactionSync: (fn: () => void) => fn(),
    },
  });
  return { adapter, db };
}

const plan = (id: string): NutritionPlan => ({
  id,
  ownerId: "u1",
  name: "Rest day",
  notes: null,
  source: "manual",
  sourcePlanId: null,
  revision: 0,
  archivedAt: null,
  createdAt: "t",
  updatedAt: "t",
  totals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  meals: [],
});

const cache = (id: string): NutritionPlansCache => ({
  ...emptyPlansCache(),
  mine: [plan(id)],
  conflictPlanIds: [id],
});

const shopping = (id: string): PlansShoppingCache => ({
  list: {
    aisles: [],
    totalItems: 0,
    plans: [{ nutritionPlanId: id, mealPlanId: null, addedAt: "t" }],
    asOf: "t",
  },
  ticked: ["x"],
});

describe.each([
  ["SQLite", () => sqliteAdapter().adapter],
  ["in-memory", () => new InMemoryStorageAdapter() as StoragePort],
])("PER-133 plan caches (%s)", (_name, make) => {
  it("round-trips the plans cache and the shopping cache per user", () => {
    const s = make();
    expect(s.getCachedNutritionPlans("u1")).toBeNull();
    expect(s.getCachedPlansShopping("u1")).toBeNull();
    s.cacheNutritionPlans("u1", cache("p1"));
    s.cachePlansShopping("u1", shopping("p1"));
    expect(s.getCachedNutritionPlans("u1")).toEqual(cache("p1"));
    expect(s.getCachedPlansShopping("u1")).toEqual(shopping("p1"));
    expect(s.getCachedNutritionPlans("u2")).toBeNull();
  });

  it("swapping a local id is a no-op when the ids match", () => {
    const s = make();
    s.cacheNutritionPlans("u1", cache("local-a"));
    s.swapLocalNutritionPlanId("local-a", "local-a");
    expect(s.getCachedNutritionPlans("u1")).toEqual(cache("local-a"));
  });
});

describe("swapLocalNutritionPlanId on SQLite", () => {
  it("rewrites both caches and every unsent queue row that names the plan", () => {
    const { adapter, db } = sqliteAdapter();
    adapter.cacheNutritionPlans("u1", cache("local-a"));
    adapter.cacheNutritionPlans("u2", cache("other"));
    adapter.cachePlansShopping("u1", shopping("local-a"));
    const ins = db.prepare(
      "INSERT INTO sync_queue (id, entity_type, entity_id, endpoint, payload, status) VALUES (?, ?, ?, ?, ?, ?)",
    );
    ins.run(
      1,
      "nutrition_plan",
      "local-a",
      "/nutrition/meal-plans/local-a",
      "{}",
      "pending",
    );
    ins.run(
      2,
      "shopping_list_plan",
      "local-a",
      "/nutrition/shopping-list/plans",
      '{"nutritionPlanId":"local-a"}',
      "failed",
    );
    ins.run(
      3,
      "nutrition_plan",
      "local-a",
      "/nutrition/meal-plans/local-a",
      "{}",
      "completed",
    );
    ins.run(
      4,
      "nutrition_entry",
      "e1",
      "/nutrition/entries",
      '{"kcal":1}',
      "pending",
    );

    adapter.swapLocalNutritionPlanId("local-a", "srv-1");

    expect(adapter.getCachedNutritionPlans("u1")).toEqual(cache("srv-1"));
    expect(adapter.getCachedNutritionPlans("u2")).toEqual(cache("other"));
    expect(adapter.getCachedPlansShopping("u1")).toEqual(shopping("srv-1"));
    const rows = db
      .prepare(
        "SELECT id, entity_id, endpoint, payload FROM sync_queue ORDER BY id",
      )
      .all() as {
      id: number;
      entity_id: string;
      endpoint: string;
      payload: string;
    }[];
    expect(rows[0]).toMatchObject({
      entity_id: "srv-1",
      endpoint: "/nutrition/meal-plans/srv-1",
    });
    expect(rows[1]).toMatchObject({
      entity_id: "srv-1",
      payload: '{"nutritionPlanId":"srv-1"}',
    });
    // Completed rows are history: left alone.
    expect(rows[2]).toMatchObject({
      entity_id: "local-a",
      endpoint: "/nutrition/meal-plans/local-a",
    });
    expect(rows[3]).toMatchObject({ entity_id: "e1", payload: '{"kcal":1}' });
  });
});
