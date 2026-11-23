import type { FuelToday, NutritionEntry } from "@/domain/models/nutrition";
import type { UserMeal } from "@/domain/models/userMeals";
import {
  activeUserMeals,
  addUserMeal,
  cleanUserMealName,
  defaultUserMealIdForSlot,
  earlierDayGroups,
  findUserMeal,
  groupEntriesByUserMeal,
  isLocalUserMealId,
  isSyntheticUserMealId,
  logTargetForUserMeal,
  mealMacroLine,
  quickLogDraft,
  recentEntries,
  relogInput,
  renameUserMeal,
  reorderUserMeals,
  sumEntryMacros,
  syntheticDefaultUserMeals,
  toUserMealsPutBody,
  userMealIdForEntry,
  weekDayState,
  weekDaysFor,
} from "../userMeals.service";

const meal = (
  id: string,
  name: string,
  logSlot: UserMeal["logSlot"],
  sortOrder: number,
  defaultKey: UserMeal["defaultKey"] = null,
  extra: Partial<UserMeal> = {},
): UserMeal => ({
  id,
  name,
  logSlot,
  sortOrder,
  defaultKey,
  clientRequestId: null,
  archivedAt: null,
  updatedAt: "2026-11-20T00:00:00.000Z",
  ...extra,
});

const MEALS: UserMeal[] = [
  meal("b", "Breakfast", "breakfast", 0, "breakfast"),
  meal("pre", "Pre-workout", "snack", 1),
  meal("l", "Lunch", "lunch", 2, "lunch"),
  meal("s", "Snack", "snack", 3, "snack"),
  meal("d", "Dinner", "dinner", 4, "dinner"),
  meal("gone", "Old meal", "dinner", 5, null, {
    archivedAt: "2026-11-21T00:00:00.000Z",
  }),
];

const entry = (
  id: string,
  mealSlot: NutritionEntry["mealSlot"],
  extra: Partial<NutritionEntry> = {},
): NutritionEntry => ({
  id,
  userId: "u1",
  foodId: null,
  recipeId: null,
  mealId: null,
  mealSlot,
  servings: 1,
  kcal: 100,
  proteinG: 10,
  carbsG: 5,
  fatG: 4,
  loggedAt: "2026-11-23T12:00:00.000Z",
  loggedByUserId: null,
  aiEstimated: false,
  aiConfidence: null,
  customName: null,
  ...extra,
});

describe("findUserMeal", () => {
  it("finds by id, and follows a local id to its synced meal by key", () => {
    const list = [
      meal("srv-9", "Supper", "snack", 0, null, { clientRequestId: "k9" }),
      meal("local-k2", "Brunch", "lunch", 1, null, { clientRequestId: "k2" }),
    ];
    expect(findUserMeal(list, "srv-9")?.name).toBe("Supper");
    expect(findUserMeal(list, "local-k9")?.id).toBe("srv-9");
    expect(findUserMeal(list, "local-k2")?.id).toBe("local-k2");
    expect(findUserMeal(list, "local-zz")).toBeUndefined();
    expect(findUserMeal(list, "srv-x")).toBeUndefined();
  });
});

describe("ids", () => {
  it("tells synthetic and local ids apart", () => {
    expect(isSyntheticUserMealId("slot:lunch")).toBe(true);
    expect(isSyntheticUserMealId("local-1")).toBe(false);
    expect(isLocalUserMealId("local-1")).toBe(true);
    expect(isLocalUserMealId("abc")).toBe(false);
  });

  it("synthetic defaults are the server's four, in its order", () => {
    const d = syntheticDefaultUserMeals();
    expect(d.map((m) => m.name)).toEqual([
      "Breakfast",
      "Lunch",
      "Snack",
      "Dinner",
    ]);
    expect(d.every((m) => isSyntheticUserMealId(m.id))).toBe(true);
  });
});

describe("grouping (Design D rule)", () => {
  it("drops archived meals and sorts by sortOrder", () => {
    expect(
      activeUserMeals([MEALS[2]!, MEALS[0]!, MEALS[5]!]).map((m) => m.id),
    ).toEqual(["b", "l"]);
  });

  it("the slot default is the seeded one, else the first active on that slot, else null", () => {
    expect(defaultUserMealIdForSlot(MEALS, "snack")).toBe("s");
    const noSeed = MEALS.filter((m) => m.id !== "s");
    expect(defaultUserMealIdForSlot(noSeed, "snack")).toBe("pre");
    expect(
      defaultUserMealIdForSlot(
        MEALS.filter((m) => m.logSlot !== "lunch"),
        "lunch",
      ),
    ).toBeNull();
  });

  it("1.2.0 entries (no userMealId) group under their slot's default meal", () => {
    const groups = groupEntriesByUserMeal(
      [
        entry("new", "snack", { userMealId: "pre" }),
        entry("old", "snack"),
        entry("oldNull", "lunch", { userMealId: null }),
      ],
      MEALS,
    );
    const byId = Object.fromEntries(
      groups.map((g) => [g.meal.id, g.entries.map((e) => e.id)]),
    );
    expect(byId).toEqual({
      b: [],
      pre: ["new"],
      l: ["oldNull"],
      s: ["old"],
      d: [],
    });
  });

  it("an entry in an archived or unknown meal shows under its slot's default", () => {
    expect(
      userMealIdForEntry({ userMealId: "gone", mealSlot: "dinner" }, MEALS),
    ).toBe("d");
    expect(
      userMealIdForEntry({ userMealId: "nope", mealSlot: "lunch" }, MEALS),
    ).toBe("l");
  });

  it("an entry whose slot has no meal gets its own section, never hidden", () => {
    const meals = MEALS.filter((m) => m.logSlot !== "dinner");
    const groups = groupEntriesByUserMeal(
      [entry("x", "dinner"), entry("y", "dinner")],
      meals,
    );
    const orphan = groups[groups.length - 1]!;
    expect(orphan.meal.id).toBe("slot:dinner");
    expect(orphan.meal.name).toBe("Dinner");
    expect(orphan.entries.map((e) => e.id)).toEqual(["x", "y"]);
  });
});

describe("summaries", () => {
  it("sums macros and writes the canvas summary line", () => {
    const totals = sumEntryMacros([
      entry("a", "lunch"),
      entry("b", "lunch", { carbsG: 31.6 }),
    ]);
    expect(totals).toEqual({
      kcal: 200,
      proteinG: 20,
      carbsG: 36.6,
      fatG: 8,
    });
    expect(mealMacroLine(totals)).toBe("37g C · 8g F · 20g P");
    expect(mealMacroLine(sumEntryMacros([]))).toBe("");
  });
});

describe("Your meals edits", () => {
  it("cleans names (trim, 1–40)", () => {
    expect(cleanUserMealName("  Lunch ")).toBe("Lunch");
    expect(cleanUserMealName("   ")).toBeNull();
    expect(cleanUserMealName("x".repeat(41))).toBeNull();
  });

  it("renames one meal, ignoring an unusable name", () => {
    expect(renameUserMeal(MEALS, "l", "Midday")[2]!.name).toBe("Midday");
    expect(renameUserMeal(MEALS, "l", " ")[2]!.name).toBe("Lunch");
  });

  it("reorders by the committed order and renumbers", () => {
    const next = reorderUserMeals(MEALS, ["d", "b"]);
    expect(next.map((m) => [m.id, m.sortOrder])).toEqual([
      ["d", 0],
      ["b", 1],
      ["pre", 2],
      ["l", 3],
      ["s", 4],
    ]);
  });

  it("adds a local meal on the snack slot with its key, at the end", () => {
    const next = addUserMeal(MEALS, " Supper ", "k1", "2026-11-23T00:00:00Z");
    const added = next[next.length - 1]!;
    expect(added).toMatchObject({
      id: "local-k1",
      name: "Supper",
      logSlot: "snack",
      sortOrder: 5,
      clientRequestId: "k1",
      defaultKey: null,
    });
    expect(addUserMeal(MEALS, "", "k2", "x")).toHaveLength(5);
  });

  it("refuses to add past the server's cap", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      meal(`m${i}`, `Meal ${i}`, "snack", i),
    );
    expect(addUserMeal(many, "One more", "k", "x")).toHaveLength(30);
  });

  it("builds the PUT body: server ids kept, local/synthetic ids left out, keys sent", () => {
    const list = [
      ...activeUserMeals(MEALS).slice(0, 2),
      meal("local-k1", "Supper", "snack", 9, null, { clientRequestId: "k1" }),
      meal("slot:dinner", "Dinner", "dinner", 10, "dinner"),
    ];
    expect(toUserMealsPutBody(list)).toEqual({
      meals: [
        { id: "b", name: "Breakfast", logSlot: "breakfast", sortOrder: 0 },
        { id: "pre", name: "Pre-workout", logSlot: "snack", sortOrder: 1 },
        {
          clientRequestId: "k1",
          name: "Supper",
          logSlot: "snack",
          sortOrder: 2,
        },
        { name: "Dinner", logSlot: "dinner", sortOrder: 3 },
      ],
    });
  });

  it("aims a log at a meal: slot-only for a placeholder", () => {
    expect(logTargetForUserMeal(MEALS[1]!)).toEqual({
      mealSlot: "snack",
      userMealId: "pre",
    });
    expect(
      logTargetForUserMeal({ id: "slot:lunch", logSlot: "lunch" }),
    ).toEqual({ mealSlot: "lunch" });
  });
});

describe("week strip", () => {
  it("is Monday to Sunday around any day", () => {
    expect(weekDaysFor("2026-11-23")).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ]);
    expect(weekDaysFor("2026-11-29")[0]).toBe("2026-11-23");
  });

  const fuel = (kcal: number, target: number | null): FuelToday => ({
    date: "2026-11-20",
    targets:
      target === null
        ? null
        : {
            userId: "u1",
            dailyKcal: target,
            proteinG: 0,
            carbsG: 0,
            fatG: 0,
            waterCups: 8,
            preset: null,
            setByUserId: null,
            setByName: null,
            updatedAt: null,
          },
    consumed: { kcal, proteinG: 0, carbsG: 0, fatG: 0, waterCups: 0 },
    remainingKcal: 0,
    entriesBySlot: { breakfast: [], lunch: [], snack: [], dinner: [] },
  });

  it("marks future, today, empty, logged and over", () => {
    const today = "2026-11-23";
    expect(weekDayState("2026-11-24", today, null)).toBe("future");
    expect(weekDayState(today, today, fuel(5000, 2000))).toBe("today");
    expect(weekDayState("2026-11-20", today, null)).toBe("empty");
    expect(weekDayState("2026-11-20", today, fuel(0, 2000))).toBe("empty");
    expect(weekDayState("2026-11-20", today, fuel(2100, 2000))).toBe("logged");
    expect(weekDayState("2026-11-20", today, fuel(2300, 2000))).toBe("over");
    expect(weekDayState("2026-11-20", today, fuel(9000, null))).toBe("logged");
  });
});

describe("recents and copy", () => {
  it("lists distinct foods newest first, up to the limit", () => {
    const list = recentEntries(
      [
        entry("1", "lunch", { foodId: "f1", loggedAt: "2026-11-20T10:00:00Z" }),
        entry("2", "lunch", { foodId: "f1", loggedAt: "2026-11-22T10:00:00Z" }),
        entry("3", "lunch", {
          recipeId: "r1",
          loggedAt: "2026-11-21T10:00:00Z",
        }),
        entry("4", "lunch", { mealId: "m1", loggedAt: "2026-11-19T10:00:00Z" }),
        entry("5", "lunch", { customName: "Burrito" }),
        entry("6", "lunch", { customName: "burrito" }),
      ],
      4,
    );
    // 6 repeats 5's custom food (case-insensitive), 1 repeats 2's food.
    expect(list.map((r) => r.entry.id)).toEqual(["5", "2", "3", "4"]);
    expect(
      recentEntries([entry("1", "lunch"), entry("2", "lunch", { kcal: 5 })], 1),
    ).toHaveLength(1);
  });

  it("re-logs each kind of entry into another meal", () => {
    const target = { mealSlot: "snack" as const, userMealId: "pre" };
    expect(
      relogInput(entry("a", "lunch", { foodId: "f" }), target, "T"),
    ).toEqual({
      ...target,
      foodId: "f",
      servings: 1,
      loggedAt: "T",
    });
    expect(
      relogInput(
        entry("a", "lunch", { recipeId: "r", servings: 2 }),
        target,
        "T",
      ),
    ).toMatchObject({ recipeId: "r", servings: 2 });
    expect(
      relogInput(entry("a", "lunch", { mealId: "m" }), target, "T"),
    ).toMatchObject({ mealId: "m" });
    expect(
      relogInput(entry("a", "lunch", { customName: "Burrito" }), target, "T"),
    ).toMatchObject({
      kcal: 100,
      proteinG: 10,
      carbsG: 5,
      fatG: 4,
      customName: "Burrito",
    });
    expect(relogInput(entry("a", "lunch"), target, "T")).not.toHaveProperty(
      "customName",
    );
  });

  it("groups earlier days by day and meal, skipping empty ones", () => {
    const day = (iso: string, entries: NutritionEntry[]): FuelToday => ({
      date: iso,
      targets: null,
      consumed: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, waterCups: 0 },
      remainingKcal: 0,
      entriesBySlot: {
        breakfast: entries.filter((e) => e.mealSlot === "breakfast"),
        lunch: entries.filter((e) => e.mealSlot === "lunch"),
        snack: entries.filter((e) => e.mealSlot === "snack"),
        dinner: entries.filter((e) => e.mealSlot === "dinner"),
      },
    });
    const groups = earlierDayGroups(
      [
        {
          iso: "2026-11-22",
          label: "Yesterday",
          fuel: day("2026-11-22", [
            entry("a", "snack", { userMealId: "pre" }),
            entry("b", "lunch"),
          ]),
        },
        { iso: "2026-11-21", label: "Sat 21", fuel: null },
      ],
      MEALS,
    );
    expect(groups.map((g) => g.heading)).toEqual([
      "Yesterday · Pre-workout",
      "Yesterday · Lunch",
    ]);
    expect(groups[0]!.key).toBe("2026-11-22:pre");
  });
});

describe("quick log draft (N2e)", () => {
  const v = (kcal: string, p = "", c = "", f = "", name = "") => ({
    name,
    kcal,
    protein: p,
    carbs: c,
    fat: f,
  });

  it("needs calories; name and macros are optional", () => {
    expect(quickLogDraft(v("")).canLog).toBe(false);
    expect(quickLogDraft(v("0")).canLog).toBe(false);
    expect(quickLogDraft(v("10001")).canLog).toBe(false);
    expect(quickLogDraft(v("abc")).kcal).toBeNull();
    const d = quickLogDraft(v("450", "", "", "", "  "));
    expect(d).toMatchObject({
      kcal: 450,
      canLog: true,
      name: null,
      macroKcal: null,
      mismatch: false,
    });
  });

  it("flags macros that add up to a different total (> 20 kcal)", () => {
    const d = quickLogDraft(v("450", "35", "40", "15", "Takeaway burrito"));
    expect(d.macroKcal).toBe(435);
    expect(d.mismatch).toBe(false);
    const off = quickLogDraft(v("450", "35", "60", "15"));
    expect(off.macroKcal).toBe(515);
    expect(off.mismatch).toBe(true);
    expect(quickLogDraft(v("4,5", "1,5")).kcal).toBe(4.5);
    expect(quickLogDraft(v("100", "-3")).proteinG).toBe(0);
  });
});
