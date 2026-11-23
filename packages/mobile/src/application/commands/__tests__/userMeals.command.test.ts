import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { UserMeal } from "@/domain/models/userMeals";
import {
  addUserMeal,
  renameUserMeal,
  syntheticDefaultUserMeals,
} from "@/domain/services/userMeals.service";
import {
  USER_MEALS_ENDPOINT,
  applyUserMealsResponse,
  saveUserMealsCommand,
} from "../userMeals.command";

const USER = "u1";
const meals = (): UserMeal[] =>
  ["Breakfast", "Lunch"].map((name, i) => ({
    id: `srv-${i}`,
    name,
    logSlot: i === 0 ? "breakfast" : "lunch",
    sortOrder: i,
    defaultKey: i === 0 ? "breakfast" : "lunch",
    clientRequestId: null,
    archivedAt: null,
    updatedAt: "2026-11-20T00:00:00.000Z",
  }));

describe("saveUserMealsCommand", () => {
  let storage: InMemoryStorageAdapter;
  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    storage.initialize();
  });

  it("caches the list and queues one PUT", () => {
    const saved = saveUserMealsCommand(
      { storage, userId: USER },
      renameUserMeal(meals(), "srv-1", "Midday"),
    );
    expect(saved!.map((m) => m.name)).toEqual(["Breakfast", "Midday"]);
    expect(storage.getCachedUserMeals(USER)!.map((m) => m.name)).toEqual([
      "Breakfast",
      "Midday",
    ]);
    const [q] = storage.getPendingMutations();
    expect(q).toMatchObject({
      entityType: "user_meals",
      entityId: USER,
      endpoint: USER_MEALS_ENDPOINT,
      method: "PUT",
    });
    expect(JSON.parse(q!.payload).meals[1]).toEqual({
      id: "srv-1",
      name: "Midday",
      logSlot: "lunch",
      sortOrder: 1,
    });
  });

  it("folds later edits into the queued PUT (one list in the queue)", () => {
    const deps = { storage, userId: USER };
    saveUserMealsCommand(deps, renameUserMeal(meals(), "srv-1", "Midday"));
    saveUserMealsCommand(
      deps,
      addUserMeal(storage.getCachedUserMeals(USER)!, "Supper", "k1", "t"),
    );
    const pending = storage.getPendingMutations();
    expect(pending).toHaveLength(1);
    expect(JSON.parse(pending[0]!.payload).meals).toHaveLength(3);
  });

  it("renumbers sort order from the list order", () => {
    const shuffled = meals().map((m, i) => ({ ...m, sortOrder: 10 - i }));
    const saved = saveUserMealsCommand({ storage, userId: USER }, shuffled)!;
    expect(saved.map((m) => [m.id, m.sortOrder])).toEqual([
      ["srv-1", 0],
      ["srv-0", 1],
    ]);
  });

  it("drops a dead older PUT so a Retry can't re-send a stale list (Inspector Brad #550)", () => {
    const deps = { storage, userId: USER };
    saveUserMealsCommand(deps, meals());
    const old = storage.getPendingMutations()[0]!;
    storage.markMutationPermanentlyFailed(old.id, "rejected");
    // Another user's dead PUT is left alone.
    storage.enqueueMutation({
      entityType: "user_meals",
      entityId: "someone-else",
      operation: "update",
      payload: { meals: [] },
      endpoint: USER_MEALS_ENDPOINT,
      method: "PUT",
    });
    const theirs = storage
      .getPendingMutations()
      .find((e) => e.entityId === "someone-else")!;
    storage.markMutationPermanentlyFailed(theirs.id, "rejected");

    saveUserMealsCommand(deps, addUserMeal(meals(), "Supper", "k1", "t"));
    const rows = storage
      .getUncompletedMutations()
      .filter((e) => e.entityType === "user_meals");
    expect(rows.map((e) => e.entityId).sort()).toEqual(["someone-else", USER]);
    const mine = rows.find((e) => e.entityId === USER)!;
    expect(mine.id).not.toBe(old.id);
    expect(JSON.parse(mine.payload).meals).toHaveLength(3);
  });

  it("keeps an offline meal from a dead PUT after a server read dropped it (Inspector Brad #550)", () => {
    const deps = { storage, userId: USER };
    saveUserMealsCommand(deps, addUserMeal(meals(), "Supper", "k", "t"));
    const old = storage.getPendingMutations()[0]!;
    storage.markMutationPermanentlyFailed(old.id, "exhausted");
    // A server read replaces the cache: Supper is gone from it.
    storage.cacheUserMeals(USER, meals());
    // The next edit is built from that cache.
    const saved = saveUserMealsCommand(
      deps,
      renameUserMeal(storage.getCachedUserMeals(USER)!, "srv-1", "Midday"),
    )!;
    expect(saved.map((m) => m.id)).toEqual(["srv-0", "srv-1", "local-k"]);
    const [q] = storage.getPendingMutations();
    expect(JSON.parse(q!.payload).meals[2]).toEqual({
      clientRequestId: "k",
      name: "Supper",
      logSlot: "snack",
      sortOrder: 2,
    });
    expect(storage.getCachedUserMeals(USER)!.map((m) => m.name)).toContain(
      "Supper",
    );
    // An unreadable dead payload carries nothing forward.
    storage.markMutationPermanentlyFailed(q!.id, "x");
    storage.patchQueueEntryForTest(q!.id, { payload: "not json" });
    expect(saveUserMealsCommand(deps, meals())).toHaveLength(2);
  });

  it("refuses placeholders and an empty list", () => {
    expect(
      saveUserMealsCommand(
        { storage, userId: USER },
        syntheticDefaultUserMeals(),
      ),
    ).toBeNull();
    expect(saveUserMealsCommand({ storage, userId: USER }, [])).toBeNull();
    expect(storage.getPendingMutations()).toHaveLength(0);
  });
});

describe("applyUserMealsResponse", () => {
  it("swaps offline meals by key and adopts the server list", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheUserMeals(USER, addUserMeal(meals(), "Supper", "k1", "t"));
    const server = [
      ...meals(),
      {
        ...meals()[0]!,
        id: "srv-9",
        name: "Supper",
        clientRequestId: "k1",
        defaultKey: null,
      },
    ];
    applyUserMealsResponse(storage, USER, server);
    expect(storage.getCachedUserMeals(USER)!.map((m) => m.id)).toEqual([
      "srv-0",
      "srv-1",
      "srv-9",
    ]);
  });

  it("keeps a newer queued edit's cache, still swapping ids", () => {
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    const local = addUserMeal(meals(), "Supper", "k1", "t");
    saveUserMealsCommand({ storage, userId: USER }, local);
    applyUserMealsResponse(storage, USER, [
      { ...meals()[0]!, id: "srv-9", name: "Supper", clientRequestId: "k1" },
    ]);
    const cached = storage.getCachedUserMeals(USER)!;
    expect(cached).toHaveLength(3);
    expect(cached[2]!.id).toBe("srv-9");
    // A local meal the server didn't return stays local.
    storage.cacheUserMeals(USER, addUserMeal(meals(), "X", "k2", "t"));
    applyUserMealsResponse(storage, USER, meals());
    expect(storage.getCachedUserMeals(USER)!.map((m) => m.id)).toContain(
      "local-k2",
    );
  });

  it("swaps from the reply even when a stale read already dropped the local meal (Inspector Brad #550)", () => {
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    storage.enqueueMutation({
      entityType: "nutrition_entry",
      entityId: "e1",
      operation: "create",
      payload: { userMealId: "local-k1", mealSlot: "snack" },
      endpoint: "/nutrition/entries",
      method: "POST",
    });
    // A GET that started before the edit landed and overwrote the cache.
    storage.cacheUserMeals(USER, meals());
    applyUserMealsResponse(storage, USER, [
      ...meals(),
      {
        ...meals()[0]!,
        id: "srv-9",
        name: "Supper",
        clientRequestId: "k1",
        defaultKey: null,
      },
    ]);
    expect(
      JSON.parse(storage.getPendingMutations()[0]!.payload).userMealId,
    ).toBe("srv-9");
  });
});
