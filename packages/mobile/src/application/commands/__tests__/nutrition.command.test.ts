import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { Food, FuelToday, Recipe } from "@/domain/models/nutrition";
import {
  defaultHabitConfig,
  type HabitConfig,
} from "@/domain/models/habit-config";
import {
  createMealCommand,
  createRecipeCommand,
  deleteEntryCommand,
  editEntryCommand,
  logEntryCommand,
  setTargetCommand,
  setWaterCommand,
} from "../nutrition.command";

/**
 * An active, enabled water habit with a litres `targetValue` (value_gte) and a
 * synced goalId — the shape the bridge in `setWaterCommand` looks for.
 */
function waterHabit(over: Partial<HabitConfig> = {}): HabitConfig {
  return {
    ...defaultHabitConfig("water"),
    enabled: true,
    goalId: "g-water",
    targetValue: 2, // 2.0 L/day = 8 cups
    ...over,
  };
}

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

  it("carries customName onto the optimistic entry and the queued payload", () => {
    const storage = new InMemoryStorageAdapter();
    const entry = logEntryCommand(deps(storage), {
      mealSlot: "lunch",
      servings: 1,
      kcal: 90,
      proteinG: 1,
      carbsG: 23,
      fatG: 0,
      customName: "Banana",
      loggedAt: `${DATE}T12:00:00.000Z`,
    });
    expect(entry.customName).toBe("Banana");
    expect(parsePayload(storage).customName).toBe("Banana");
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
  it("enqueues a DELETE for a server-synced entry (no pending create)", () => {
    const storage = new InMemoryStorageAdapter();
    // A server-truth day: the entry came back from a refresh with a server id,
    // so there's no create queued behind it.
    storage.cacheFuelToday(USER, DATE, {
      ...emptyFuel(),
      consumed: { kcal: 300, proteinG: 10, carbsG: 27, fatG: 3, waterCups: 0 },
      remainingKcal: 1700,
      entriesBySlot: {
        breakfast: [
          {
            id: "server-e1",
            userId: USER,
            foodId: "f1",
            recipeId: null,
            mealId: null,
            mealSlot: "breakfast",
            servings: 2,
            kcal: 300,
            proteinG: 10,
            carbsG: 27,
            fatG: 3,
            loggedAt: `${DATE}T08:00:00.000Z`,
            loggedByUserId: null,
            aiEstimated: false,
            aiConfidence: null,
            customName: null,
          },
        ],
        lunch: [],
        snack: [],
        dinner: [],
      },
    });

    deleteEntryCommand(deps(storage), "server-e1", DATE);

    const fuel = storage.getCachedFuelToday(USER, DATE)!;
    expect(fuel.consumed.kcal).toBe(0);
    expect(fuel.entriesBySlot.breakfast).toHaveLength(0);
    const del = storage
      .getPendingMutations()
      .find((m) => m.method === "DELETE")!;
    expect(del.endpoint).toBe("/nutrition/entries/server-e1");
  });

  it("COALESCES: deleting an entry whose create is still pending cancels the create and enqueues NO delete", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheFoods([food]);
    storage.cacheFuelToday(USER, DATE, emptyFuel());
    // Logged offline (create queued, never sent), then deleted before any drain.
    const entry = logEntryCommand(deps(storage), {
      foodId: "f1",
      mealSlot: "breakfast",
      servings: 1,
      loggedAt: `${DATE}T08:00:00.000Z`,
    });
    expect(storage.getPendingMutations()).toHaveLength(1); // the create

    deleteEntryCommand(deps(storage), entry.id, DATE);

    // Cache reflects the removal…
    const fuel = storage.getCachedFuelToday(USER, DATE)!;
    expect(fuel.consumed.kcal).toBe(0);
    expect(fuel.entriesBySlot.breakfast).toHaveLength(0);
    // …and the queue is empty: the un-sent create is cancelled, no DELETE queued
    // (a DELETE against the never-synced local id would 404-loop + orphan a row).
    expect(storage.getPendingMutations()).toHaveLength(0);
  });

  it("COALESCES a queued edit too: create + update + delete all cancel, leaving no doomed PUT", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheFoods([food]);
    storage.cacheFuelToday(USER, DATE, emptyFuel());
    // Offline: logged, then edited (queues a PUT against the local id), then
    // deleted — all before any drain.
    const entry = logEntryCommand(deps(storage), {
      foodId: "f1",
      mealSlot: "breakfast",
      servings: 1,
      loggedAt: `${DATE}T08:00:00.000Z`,
    });
    editEntryCommand(deps(storage), entry.id, DATE, { servings: 2, kcal: 300 });
    expect(storage.getPendingMutations()).toHaveLength(2); // create + update

    deleteEntryCommand(deps(storage), entry.id, DATE);

    // Both the un-sent create AND the update for the never-synced local id are
    // cancelled — nothing left to 404-loop against a server row that never was.
    expect(storage.getPendingMutations()).toHaveLength(0);
    const fuel = storage.getCachedFuelToday(USER, DATE)!;
    expect(fuel.entriesBySlot.breakfast).toHaveLength(0);
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

  it("still sends INTEGER cups on the wire (storage unit unchanged)", () => {
    // Litres is a display/bridge concern only — the PATCH grain stays cups.
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs(USER, [waterHabit()]);
    setWaterCommand(deps(storage), DATE, 8);
    const water = storage
      .getPendingMutations()
      .find((m) => m.entityType === "water_log")!;
    expect(JSON.parse(water.payload)).toEqual({ date: DATE, cups: 8 });
  });
});

describe("setWaterCommand → water-habit bridge", () => {
  const completions = (storage: InMemoryStorageAdapter) =>
    storage.getCachedHabitCompletions(USER, { goalId: "g-water" });
  const habitMutations = (storage: InMemoryStorageAdapter) =>
    storage
      .getPendingMutations()
      .filter((m) => m.entityType === "habit_completion");

  it("ticks the water habit when logged litres reach the target (value = target litres)", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs(USER, [waterHabit()]); // target 2.0 L = 8 cups
    storage.cacheHome(USER, {} as never);

    setWaterCommand(deps(storage), DATE, 8); // 8 cups × 0.25 = 2.0 L ≥ 2.0

    // Optimistic completion row for today, carrying the litres target.
    const rows = completions(storage);
    expect(rows).toHaveLength(1);
    expect(rows[0].localCompletedDate).toBe(DATE);
    expect(rows[0].value).toBe(2);

    // Enqueued POST /habit-completions with {goalId, date, value} (litres).
    const posts = habitMutations(storage).filter((m) => m.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].endpoint).toBe("/habit-completions");
    expect(JSON.parse(posts[0].payload)).toEqual({
      goalId: "g-water",
      date: DATE,
      value: 2,
    });

    // Home invalidated so the grid re-reads the tick.
    expect(storage.getCachedHome(USER)).toBeNull();
  });

  it("does NOT tick when logged litres are below the target", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs(USER, [waterHabit()]); // 2.0 L target

    setWaterCommand(deps(storage), DATE, 7); // 7 cups = 1.75 L < 2.0

    expect(completions(storage)).toHaveLength(0);
    expect(habitMutations(storage)).toHaveLength(0);
  });

  it("un-ticks (DELETE) when a later log drops back below the target", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs(USER, [waterHabit()]);

    setWaterCommand(deps(storage), DATE, 8); // tick at 2.0 L
    expect(completions(storage)).toHaveLength(1);

    setWaterCommand(deps(storage), DATE, 4); // 1.0 L < 2.0 → un-tick
    expect(completions(storage)).toHaveLength(0);

    const del = habitMutations(storage).find((m) => m.method === "DELETE")!;
    expect(del.endpoint).toContain("goalId=g-water");
    expect(del.endpoint).toContain(`date=${DATE}`);
  });

  it("no water habit configured → logs water but writes NO completion", () => {
    const storage = new InMemoryStorageAdapter();
    // No habit configs at all.
    setWaterCommand(deps(storage), DATE, 8);
    expect(completions(storage)).toHaveLength(0);
    expect(habitMutations(storage)).toHaveLength(0);
    // The water log itself still fired.
    expect(
      storage.getPendingMutations().filter((m) => m.entityType === "water_log"),
    ).toHaveLength(1);
  });

  it("disabled water habit → no completion", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs(USER, [waterHabit({ enabled: false })]);
    setWaterCommand(deps(storage), DATE, 8);
    expect(completions(storage)).toHaveLength(0);
    expect(habitMutations(storage)).toHaveLength(0);
  });

  it("water habit with no synced goalId → no completion", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs(USER, [waterHabit({ goalId: null })]);
    setWaterCommand(deps(storage), DATE, 8);
    expect(completions(storage)).toHaveLength(0);
    expect(habitMutations(storage)).toHaveLength(0);
  });

  it("is idempotent: logging MORE cups while already ticked enqueues no duplicate completion", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs(USER, [waterHabit()]);

    setWaterCommand(deps(storage), DATE, 8); // tick (2.0 L)
    setWaterCommand(deps(storage), DATE, 10); // 2.5 L, still ≥ 2.0 — no change

    expect(completions(storage)).toHaveLength(1);
    // Exactly one habit mutation (the original POST); no duplicate.
    const posts = habitMutations(storage);
    expect(posts).toHaveLength(1);
    expect(posts[0].method).toBe("POST");
  });

  it("is idempotent: staying below target across taps enqueues nothing", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs(USER, [waterHabit()]);

    setWaterCommand(deps(storage), DATE, 2); // 0.5 L
    setWaterCommand(deps(storage), DATE, 5); // 1.25 L — still < 2.0

    expect(completions(storage)).toHaveLength(0);
    expect(habitMutations(storage)).toHaveLength(0);
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
