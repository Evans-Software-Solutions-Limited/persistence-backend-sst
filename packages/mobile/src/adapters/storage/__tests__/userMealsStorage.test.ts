/** @jest-environment node */
import { DatabaseSync } from "node:sqlite";
import type { StoragePort } from "@/domain/ports/storage.port";
import type { FuelToday, NutritionEntry } from "@/domain/models/nutrition";
import type { UserMeal } from "@/domain/models/userMeals";
import { InMemoryStorageAdapter } from "./in-memory-storage.adapter";
import { SQLiteStorageAdapter } from "../sqlite.adapter";

/** The SQLite adapter on node's SQLite, with the PER-132 cache DDL it ships. */
function sqliteAdapter(): { adapter: StoragePort; db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE cached_user_meals (user_id TEXT PRIMARY KEY, payload TEXT NOT NULL, synced_at TEXT NOT NULL);
    CREATE TABLE cached_fuel_today (user_id TEXT NOT NULL, date TEXT NOT NULL, payload TEXT NOT NULL, synced_at TEXT NOT NULL, PRIMARY KEY (user_id, date));
    CREATE TABLE sync_queue (id INTEGER PRIMARY KEY, entity_type TEXT, entity_id TEXT, payload TEXT, status TEXT);
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

const meal = (
  id: string,
  name: string,
  clientRequestId: string | null = null,
): UserMeal => ({
  id,
  name,
  logSlot: "snack",
  sortOrder: 0,
  defaultKey: null,
  clientRequestId,
  archivedAt: null,
  updatedAt: "2026-11-23T00:00:00.000Z",
});

const entry = (id: string, userMealId: string | null): NutritionEntry => ({
  id,
  userId: "u1",
  foodId: null,
  recipeId: null,
  mealId: null,
  mealSlot: "snack",
  servings: 1,
  kcal: 100,
  proteinG: 1,
  carbsG: 1,
  fatG: 1,
  loggedAt: "2026-11-23T12:00:00.000Z",
  loggedByUserId: null,
  aiEstimated: false,
  aiConfidence: null,
  customName: null,
  userMealId,
});

const day = (entries: NutritionEntry[]): FuelToday => ({
  date: "2026-11-23",
  targets: null,
  consumed: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, waterCups: 0 },
  remainingKcal: 0,
  entriesBySlot: { breakfast: [], lunch: [], snack: entries, dinner: [] },
});

describe("Your meals cache (SQLite)", () => {
  it("reads null until cached, then the list", () => {
    const { adapter } = sqliteAdapter();
    expect(adapter.getCachedUserMeals("u1")).toBeNull();
    adapter.cacheUserMeals("u1", [meal("a", "Breakfast")]);
    expect(adapter.getCachedUserMeals("u1")!.map((m) => m.name)).toEqual([
      "Breakfast",
    ]);
  });

  it("swaps a local meal id in the list, the day cache and queued entries only", () => {
    const { adapter, db } = sqliteAdapter();
    adapter.cacheUserMeals("u1", [
      meal("srv-1", "Pre-workout"), // a refresh already holds the server copy
      meal("local-k", "Pre-workout", "k"),
    ]);
    adapter.cacheFuelToday(
      "u1",
      "2026-11-23",
      day([entry("e1", "local-k"), entry("e2", "other")]),
    );
    const insert = db.prepare(
      `INSERT INTO sync_queue (entity_type, entity_id, payload, status) VALUES (?, ?, ?, ?)`,
    );
    insert.run(
      "nutrition_entry",
      "e1",
      JSON.stringify({ userMealId: "local-k" }),
      "pending",
    );
    insert.run("nutrition_entry", "e3", "not json", "pending");
    insert.run(
      "nutrition_entry",
      "e4",
      JSON.stringify({ userMealId: "local-k" }),
      "completed",
    );
    insert.run(
      "nutrition_entry",
      "e5",
      JSON.stringify({ userMealId: "x" }),
      "pending",
    );

    adapter.swapLocalUserMealId("local-k", "srv-1");
    adapter.swapLocalUserMealId("same", "same");

    expect(adapter.getCachedUserMeals("u1")!.map((m) => m.id)).toEqual([
      "srv-1",
    ]);
    const snack = adapter.getCachedFuelToday("u1", "2026-11-23")!.entriesBySlot
      .snack;
    expect(snack.map((e) => e.userMealId)).toEqual(["srv-1", "other"]);
    const rows = db
      .prepare(`SELECT entity_id, payload FROM sync_queue ORDER BY id`)
      .all() as {
      entity_id: string;
      payload: string;
    }[];
    expect(rows.map((r) => r.payload)).toEqual([
      JSON.stringify({ userMealId: "srv-1" }),
      "not json",
      JSON.stringify({ userMealId: "local-k" }),
      JSON.stringify({ userMealId: "x" }),
    ]);
  });
});

describe("Your meals cache (in-memory double parity)", () => {
  it("swaps the same three places", () => {
    const s = new InMemoryStorageAdapter();
    s.cacheUserMeals("u1", [meal("local-k", "Pre-workout", "k")]);
    s.cacheFuelToday("u1", "2026-11-23", day([entry("e1", "local-k")]));
    s.enqueueMutation({
      entityType: "nutrition_entry",
      entityId: "e1",
      operation: "create",
      payload: { userMealId: "local-k" },
      endpoint: "/nutrition/entries",
      method: "POST",
    });
    s.swapLocalUserMealId("local-k", "srv-1");
    expect(s.getCachedUserMeals("u1")![0]!.id).toBe("srv-1");
    expect(
      s.getCachedFuelToday("u1", "2026-11-23")!.entriesBySlot.snack[0]!
        .userMealId,
    ).toBe("srv-1");
    expect(JSON.parse(s.getPendingMutations()[0]!.payload).userMealId).toBe(
      "srv-1",
    );
    s.clearAll();
    expect(s.getCachedUserMeals("u1")).toBeNull();
  });
});
