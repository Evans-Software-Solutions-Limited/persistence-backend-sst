import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { LogEntryInput } from "@/domain/models/nutrition";
import {
  emptyPlansCache,
  type NutritionPlan,
} from "@/domain/models/nutritionPlans";
import { flattenFuelEntries } from "@/domain/services/nutrition.service";
import {
  adoptSavedMealprintPlanCommand,
  dayEntryIds,
  logAllTodayCommand,
  undoLogAllCommand,
} from "../mealprintDay.command";

const USER = "user-1";
const DAY = "2026-11-26";
let n = 0;
const deps = (storage: InMemoryStorageAdapter) => ({
  storage,
  userId: USER,
  idFactory: () => `id-${++n}`,
});

const input = (foodId: string): LogEntryInput => ({
  foodId,
  mealSlot: "lunch",
  userMealId: "um-l",
  servings: 1,
  kcal: 300,
  proteinG: 20,
  carbsG: 30,
  fatG: 10,
  customName: foodId,
  loggedAt: `${DAY}T12:00:00.000Z`,
});

const plan = (id: string, name: string): NutritionPlan => ({
  id,
  ownerId: USER,
  name,
  notes: null,
  source: "mealprint",
  sourcePlanId: "dated-1",
  revision: 1,
  archivedAt: null,
  createdAt: "2026-11-26T10:00:00.000Z",
  updatedAt: "2026-11-26T10:00:00.000Z",
  totals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  meals: [],
});

function setup() {
  const storage = new InMemoryStorageAdapter();
  void storage.initialize();
  return storage;
}

describe("adoptSavedMealprintPlanCommand", () => {
  it("puts the saved plan under Mine, replacing an older copy", () => {
    const storage = setup();
    storage.cacheNutritionPlans(USER, {
      ...emptyPlansCache(),
      mine: [plan("p-other", "Rest day"), plan("p1", "Old name")],
    });
    adoptSavedMealprintPlanCommand(storage, USER, plan("p1", "Mealprint"));
    const mine = storage.getCachedNutritionPlans(USER)!.mine;
    expect(mine.map((p) => [p.id, p.name])).toEqual([
      ["p-other", "Rest day"],
      ["p1", "Mealprint"],
    ]);
  });

  it("works with nothing cached yet", () => {
    const storage = setup();
    adoptSavedMealprintPlanCommand(storage, USER, plan("p1", "Mealprint"));
    expect(storage.getCachedNutritionPlans(USER)!.mine).toHaveLength(1);
  });
});

describe("Log all today and Undo", () => {
  it("caches and queues one keyed entry per item, then Undo drops the unsent ones", () => {
    const storage = setup();
    expect(dayEntryIds(storage, USER, DAY).size).toBe(0);
    const before = dayEntryIds(storage, USER, DAY);
    const logged = logAllTodayCommand(deps(storage), [
      input("f1"),
      input("f2"),
    ]);
    expect(logged).toHaveLength(2);
    const day = storage.getCachedFuelToday(USER, DAY)!;
    expect(flattenFuelEntries(day)).toHaveLength(2);
    expect(day.consumed.kcal).toBe(600);
    const queued = storage
      .getPendingMutations()
      .filter((m) => m.entityType === "nutrition_entry");
    expect(queued).toHaveLength(2);

    expect(undoLogAllCommand(deps(storage), DAY, before, logged)).toBe(2);
    expect(flattenFuelEntries(storage.getCachedFuelToday(USER, DAY)!)).toEqual(
      [],
    );
    // Never sent, so nothing to delete on the server.
    expect(
      storage
        .getPendingMutations()
        .filter((m) => m.entityType === "nutrition_entry"),
    ).toHaveLength(0);
  });

  it("Undo after sync deletes by the server id and leaves earlier food alone", () => {
    const storage = setup();
    logAllTodayCommand(deps(storage), [input("earlier")]);
    const before = dayEntryIds(storage, USER, DAY);
    const logged = logAllTodayCommand(deps(storage), [input("f1")]);
    // The create synced: complete it and swap to the server id.
    for (const m of storage.getPendingMutations()) {
      storage.markMutationCompleted(m.id);
    }
    storage.swapLocalNutritionEntryId(logged[0]!.id, "srv-1");

    expect(undoLogAllCommand(deps(storage), DAY, before, logged)).toBe(1);
    const left = flattenFuelEntries(storage.getCachedFuelToday(USER, DAY)!);
    expect(left.map((e) => e.customName)).toEqual(["earlier"]);
    const deletes = storage
      .getPendingMutations()
      .filter((m) => m.method === "DELETE");
    expect(deletes.map((m) => m.endpoint)).toEqual([
      "/nutrition/entries/srv-1",
    ]);
  });

  it("Undo with no cached day removes nothing", () => {
    const storage = setup();
    expect(undoLogAllCommand(deps(storage), DAY, new Set(), [])).toBe(0);
  });
});
