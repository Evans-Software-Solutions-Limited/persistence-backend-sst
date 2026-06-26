import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { Food, FuelToday, Recipe } from "@/domain/models/nutrition";
import {
  createMealCommand,
  createRecipeCommand,
  deleteEntryCommand,
  editEntryCommand,
  logEntryCommand,
  setTargetCommand,
  setWaterCommand,
} from "../nutrition.command";

const USER = "u1";
const DATE = "2026-06-21";
let n = 0;
const idFactory = () => `id${++n}`;

function deps(storage: InMemoryStorageAdapter) {
  return { storage, userId: USER, idFactory };
}

const food: Food = {
  id: "f1",
  name: "Oats",
  brand: null,
  barcode: "123",
  kcal: 150,
  proteinG: 5,
  carbsG: 27,
  fatG: 3,
  servingSize: 40,
  servingUnit: "g",
  source: "openfoodfacts",
  createdBy: null,
};

const emptyFuel = (over: Partial<FuelToday> = {}): FuelToday => ({
  date: DATE,
  targets: {
    userId: USER,
    dailyKcal: 2000,
    proteinG: 150,
    carbsG: 200,
    fatG: 60,
    waterCups: 8,
    preset: "custom",
    setByUserId: null,
    setByName: null,
    updatedAt: null,
  },
  consumed: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, waterCups: 0 },
  remainingKcal: 2000,
  entriesBySlot: { breakfast: [], lunch: [], snack: [], dinner: [] },
  ...over,
});

const parsePayload = (storage: InMemoryStorageAdapter, idx = 0) =>
  JSON.parse(storage.getPendingMutations()[idx].payload);

beforeEach(() => {
  n = 0;
});

describe("logEntryCommand", () => {
  it("re-derives macros from a cached food and recomputes the day aggregate", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheFoods([food]);
    storage.cacheFuelToday(USER, DATE, emptyFuel());

    const entry = logEntryCommand(deps(storage), {
      foodId: "f1",
      mealSlot: "breakfast",
      servings: 2,
      loggedAt: `${DATE}T08:00:00.000Z`,
    });

    expect(entry.id).toBe("local-id1");
    expect(entry.kcal).toBe(300); // 150 × 2
    const fuel = storage.getCachedFuelToday(USER, DATE)!;
    expect(fuel.consumed.kcal).toBe(300);
    expect(fuel.entriesBySlot.breakfast).toHaveLength(1);
    expect(fuel.consumed.waterCups).toBe(0); // water preserved

    const q = storage.getPendingMutations();
    expect(q).toHaveLength(1);
    expect(q[0].endpoint).toBe("/nutrition/entries");
    expect(q[0].method).toBe("POST");
    expect(q[0].operation).toBe("create");
  });

  it("seeds an empty day aggregate when nothing is cached", () => {
    const storage = new InMemoryStorageAdapter();
    logEntryCommand(deps(storage), {
      mealSlot: "snack",
      servings: 1,
      kcal: 120,
      proteinG: 2,
      carbsG: 25,
      fatG: 1,
      loggedAt: `${DATE}T15:00:00.000Z`,
    });
    const fuel = storage.getCachedFuelToday(USER, DATE)!;
    expect(fuel.consumed.kcal).toBe(120); // one-off uses client macros
  });

  it("derives macros from a cached recipe reference", () => {
    const storage = new InMemoryStorageAdapter();
    const recipe: Recipe = {
      id: "r1",
      userId: USER,
      name: "Chilli",
      photoUrl: null,
      servings: 4,
      instructions: null,
      source: "manual",
      sourceUrl: null,
      totalKcal: 800,
      totalProteinG: 60,
      totalCarbsG: 80,
      totalFatG: 20,
      ingredients: [],
    };
    storage.cacheRecipe(USER, recipe);
    const entry = logEntryCommand(deps(storage), {
      recipeId: "r1",
      mealSlot: "dinner",
      servings: 1,
      loggedAt: `${DATE}T19:00:00.000Z`,
    });
    expect(entry.kcal).toBe(200); // 800 / 4 × 1
  });
});

describe("editEntryCommand", () => {
  it("patches the entry, recomputes, and enqueues a PUT", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheFoods([food]);
    storage.cacheFuelToday(USER, DATE, emptyFuel());
    const entry = logEntryCommand(deps(storage), {
      foodId: "f1",
      mealSlot: "breakfast",
      servings: 1,
      loggedAt: `${DATE}T08:00:00.000Z`,
    });

    editEntryCommand(deps(storage), entry.id, DATE, { kcal: 999, servings: 1 });

    const fuel = storage.getCachedFuelToday(USER, DATE)!;
    expect(fuel.consumed.kcal).toBe(999);
    const put = storage.getPendingMutations().find((m) => m.method === "PUT")!;
    expect(put.endpoint).toBe(`/nutrition/entries/${entry.id}`);
  });
});

describe("deleteEntryCommand", () => {
  it("removes the entry, recomputes to empty, and enqueues a DELETE", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheFoods([food]);
    storage.cacheFuelToday(USER, DATE, emptyFuel());
    const entry = logEntryCommand(deps(storage), {
      foodId: "f1",
      mealSlot: "breakfast",
      servings: 1,
      loggedAt: `${DATE}T08:00:00.000Z`,
    });

    deleteEntryCommand(deps(storage), entry.id, DATE);

    const fuel = storage.getCachedFuelToday(USER, DATE)!;
    expect(fuel.consumed.kcal).toBe(0);
    expect(fuel.entriesBySlot.breakfast).toHaveLength(0);
    const del = storage
      .getPendingMutations()
      .find((m) => m.method === "DELETE")!;
    expect(del.endpoint).toBe(`/nutrition/entries/${entry.id}`);
  });
});

describe("setTargetCommand", () => {
  it("caches the target, updates the day's remaining, and preserves trainer attribution", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheNutritionTarget(USER, {
      userId: USER,
      dailyKcal: 1000,
      proteinG: 1,
      carbsG: 1,
      fatG: 1,
      waterCups: 8,
      preset: "custom",
      setByUserId: "coach-1",
      setByName: "Coach Bradley",
      updatedAt: null,
    });
    storage.cacheFuelToday(USER, DATE, emptyFuel());

    const target = setTargetCommand(
      deps(storage),
      {
        dailyKcal: 2500,
        proteinG: 180,
        carbsG: 250,
        fatG: 70,
        waterCups: 10,
      },
      DATE,
    );

    expect(target.dailyKcal).toBe(2500);
    expect(target.setByUserId).toBe("coach-1"); // untouched by self-write
    expect(storage.getCachedNutritionTarget(USER)?.dailyKcal).toBe(2500);
    expect(storage.getCachedFuelToday(USER, DATE)?.remainingKcal).toBe(2500);
    const put = storage.getPendingMutations()[0];
    expect(put.endpoint).toBe("/nutrition/targets");
    expect(put.method).toBe("PUT");
  });
});

describe("setWaterCommand", () => {
  it("sets absolute cups optimistically and enqueues an absolute PATCH", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheFuelToday(USER, DATE, emptyFuel());
    setWaterCommand(deps(storage), DATE, 3);
    expect(storage.getCachedFuelToday(USER, DATE)?.consumed.waterCups).toBe(3);
    expect(parsePayload(storage)).toEqual({ date: DATE, cups: 3 });
  });

  it("coalesces rapid taps onto a single pending mutation (idempotent replay)", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheFuelToday(USER, DATE, emptyFuel());
    setWaterCommand(deps(storage), DATE, 1);
    setWaterCommand(deps(storage), DATE, 2);
    setWaterCommand(deps(storage), DATE, 3);
    const water = storage
      .getPendingMutations()
      .filter((m) => m.entityType === "water_log");
    expect(water).toHaveLength(1);
    expect(JSON.parse(water[0].payload)).toEqual({ date: DATE, cups: 3 });
  });

  it("clamps negative cups to 0", () => {
    const storage = new InMemoryStorageAdapter();
    setWaterCommand(deps(storage), DATE, -5);
    expect(parsePayload(storage)).toEqual({ date: DATE, cups: 0 });
  });
});

describe("createRecipeCommand", () => {
  it("inserts an optimistic local recipe and enqueues a POST", () => {
    const storage = new InMemoryStorageAdapter();
    const recipe = createRecipeCommand(
      deps(storage),
      {
        name: "Bowl",
        servings: 2,
        ingredients: [
          { foodId: "f1", quantity: 1, unit: "serving", sortOrder: 0 },
        ],
      },
      { kcal: 150, proteinG: 5, carbsG: 27, fatG: 3 },
    );
    expect(recipe.id).toBe("local-id1");
    expect(recipe.totalKcal).toBe(150);
    expect(storage.getCachedRecipe(USER, recipe.id)?.name).toBe("Bowl");
    const post = storage.getPendingMutations()[0];
    expect(post.endpoint).toBe("/recipes");
    expect(post.entityType).toBe("recipe");
  });
});

describe("createMealCommand", () => {
  it("inserts an optimistic local meal and enqueues a POST", () => {
    const storage = new InMemoryStorageAdapter();
    const meal = createMealCommand(
      deps(storage),
      {
        name: "Lunch combo",
        items: [{ foodId: "f1", servings: 2, sortOrder: 0 }],
      },
      { kcal: 300, proteinG: 10, carbsG: 54, fatG: 6 },
    );
    expect(meal.id).toBe("local-id1");
    expect(meal.totalKcal).toBe(300);
    expect(storage.getCachedMeals(USER)).toHaveLength(1);
    const post = storage.getPendingMutations()[0];
    expect(post.endpoint).toBe("/meals");
    expect(post.entityType).toBe("meal");
  });
});
