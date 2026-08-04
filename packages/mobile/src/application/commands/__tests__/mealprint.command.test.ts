import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { setMealprintPreferencesCommand } from "../mealprint.command";
import type { SetMealprintPreferencesInput } from "@/domain/models/mealprint";

const USER = "user-1";

function input(
  over: Partial<SetMealprintPreferencesInput> = {},
): SetMealprintPreferencesInput {
  return {
    dietaryPatterns: ["vegan"],
    avoidAllergens: ["peanuts"],
    avoidFoods: ["olives"],
    likedFoods: ["tofu"],
    mealsPerDay: 3,
    effortLevel: "quick",
    locale: "en-GB",
    ...over,
  };
}

describe("setMealprintPreferencesCommand", () => {
  it("writes the optimistic row through to the cache", () => {
    const storage = new InMemoryStorageAdapter();
    const saved = setMealprintPreferencesCommand(
      { storage, userId: USER },
      input(),
    );

    expect(saved.dietaryPatterns).toEqual(["vegan"]);
    expect(saved.mealsPerDay).toBe(3);
    expect(storage.getCachedMealprintPreferences(USER)).toEqual(saved);
  });

  it("clears `isDefault`, so a saved default stops re-offering the wizard", () => {
    // ⚠ The regression this guards: carrying the previous `isDefault` forward
    // would leave a user who skipped the wizard (a real save of the defaults)
    // being offered the first run again on every launch.
    const storage = new InMemoryStorageAdapter();
    const saved = setMealprintPreferencesCommand(
      { storage, userId: USER },
      input({
        dietaryPatterns: [],
        avoidAllergens: [],
        avoidFoods: [],
        likedFoods: [],
        mealsPerDay: 4,
        effortLevel: "balanced",
      }),
    );
    expect(saved.isDefault).toBe(false);
  });

  it("enqueues a PUT to /nutrition/preferences keyed on the userId", () => {
    const storage = new InMemoryStorageAdapter();
    setMealprintPreferencesCommand({ storage, userId: USER }, input());

    const queued = storage.getPendingMutations();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      entityType: "nutrition_preferences",
      entityId: USER,
      operation: "update",
      endpoint: "/nutrition/preferences",
      method: "PUT",
    });
  });

  it("COALESCES onto a still-pending write rather than stacking replacements", () => {
    // ⚠ Each write is a full last-write-wins replacement, so four offline saves
    // must not become four requests whose only effect is to be overwritten by the
    // last. Same rule as `setWaterCommand`.
    const storage = new InMemoryStorageAdapter();
    setMealprintPreferencesCommand({ storage, userId: USER }, input());
    setMealprintPreferencesCommand(
      { storage, userId: USER },
      input({ mealsPerDay: 6 }),
    );
    setMealprintPreferencesCommand(
      { storage, userId: USER },
      input({ mealsPerDay: 2 }),
    );

    const queued = storage.getPendingMutations();
    expect(queued).toHaveLength(1);
    // Payloads are stored serialised, so parse rather than matching the object.
    expect(JSON.parse(String(queued[0]?.payload))).toMatchObject({
      mealsPerDay: 2,
    });
    // …and the cache reflects the latest, not the first.
    expect(storage.getCachedMealprintPreferences(USER)?.mealsPerDay).toBe(2);
  });

  it("does not coalesce across users", () => {
    const storage = new InMemoryStorageAdapter();
    setMealprintPreferencesCommand({ storage, userId: USER }, input());
    setMealprintPreferencesCommand({ storage, userId: "user-2" }, input());
    expect(storage.getPendingMutations()).toHaveLength(2);
  });

  it("copies the input arrays rather than aliasing the caller's state", () => {
    // A container passes its own React state arrays here; storing the references
    // would let a later `setState` mutate what is already queued.
    const storage = new InMemoryStorageAdapter();
    const mutable = { ...input(), avoidFoods: ["olives"] };
    const saved = setMealprintPreferencesCommand(
      { storage, userId: USER },
      mutable,
    );
    (mutable.avoidFoods as string[]).push("marmite");
    expect(saved.avoidFoods).toEqual(["olives"]);
  });
});
