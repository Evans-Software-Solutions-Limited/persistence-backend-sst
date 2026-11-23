/**
 * PER-133 N11–N14 containers: the Meals tab, the Log sheet and the Add to plan
 * sheet. Hooks are mocked; the presenters are probed.
 */
import { act, render } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import type {
  Food,
  FuelToday,
  Meal,
  NutritionEntry,
  Recipe,
} from "@/domain/models/nutrition";
import type { UserMeal } from "@/domain/models/userMeals";
import type {
  NutritionPlan,
  NutritionPlansCache,
} from "@/domain/models/nutritionPlans";
import { addDaysISO, localDayISO, loggedAtNoonUtc } from "@/shared/utils";
import { useFuelSheets } from "@/state/fuel-sheets";
import { useAddRecipeMenu } from "@/state/add-recipe-menu";
import type { MealsTabPresenterProps } from "@/ui/presenters/fuel/MealsTabPresenter";
import type { LogMealSheetProps } from "@/ui/presenters/fuel/LogMealSheetPresenter";
import type { AddToPlanSheetProps } from "@/ui/presenters/fuel/AddToPlanSheetPresenter";
import {
  MealsTabContainer,
  foodSub,
  mealForNow,
  recipeSub,
  savedMealSub,
  savedMealsByUse,
  useMealsTabNew,
} from "../MealsTabContainer";
import { LogMealSheetContainer, logDayLabel } from "../LogMealSheetContainer";
import { AddToPlanSheetContainer } from "../AddToPlanSheetContainer";

const probe: {
  tab: MealsTabPresenterProps | null;
  log: LogMealSheetProps | null;
  plan: AddToPlanSheetProps | null;
} = { tab: null, log: null, plan: null };

jest.mock("@/ui/presenters/fuel/MealsTabPresenter", () => ({
  MealsTabPresenter: (p: MealsTabPresenterProps) => {
    probe.tab = p;
    return null;
  },
}));
jest.mock("@/ui/presenters/fuel/LogMealSheetPresenter", () => ({
  LogMealSheetPresenter: (p: LogMealSheetProps) => {
    probe.log = p;
    return null;
  },
}));
jest.mock("@/ui/presenters/fuel/AddToPlanSheetPresenter", () => ({
  AddToPlanSheetPresenter: (p: AddToPlanSheetProps) => {
    probe.plan = p;
    return null;
  },
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() },
}));

const USER = "user-1";
const TODAY = localDayISO();

// -- mocked hooks -----------------------------------------------------------

const days = new Map<string, FuelToday>();
const foods = new Map<string, Food>();
let cachedTarget: { dailyKcal: number } | null = null;
const mockStorage = {
  getCachedFuelToday: jest.fn(
    (_u: string, iso: string) => days.get(iso) ?? null,
  ),
  getCachedFoodById: jest.fn((id: string) => foods.get(id) ?? null),
  getCachedNutritionTarget: jest.fn(() => cachedTarget),
};
jest.mock("@/ui/hooks/useAdapters", () => ({
  useAdapters: () => ({ storage: mockStorage }),
}));
let mockSession: { userId: string } | null = { userId: USER };
jest.mock("@/ui/hooks/useAuth", () => ({
  useAuth: () => ({ session: mockSession }),
}));
let mockSavedMeals: Meal[] | null = [];
jest.mock("@/ui/hooks/useGetMeals", () => ({
  useGetMeals: () => ({ data: mockSavedMeals }),
}));
let mockRecipes: Recipe[] | null = [];
jest.mock("@/ui/hooks/useGetRecipes", () => ({
  useGetRecipes: () => ({ data: mockRecipes }),
}));
let mockUserMeals: UserMeal[] = [];
jest.mock("@/ui/hooks/useUserMeals", () => ({
  useUserMeals: () => ({ meals: mockUserMeals }),
}));
const mockLogMutate = jest.fn(async (_inputs: unknown[]) => []);
jest.mock("@/ui/hooks/useLogEntries", () => ({
  useLogEntries: () => ({ mutate: mockLogMutate }),
}));
let mockPlansCache: NutritionPlansCache = {
  mine: [],
  fromCoaches: [],
  asOf: null,
  conflictPlanIds: [],
};
const mockSave = jest.fn(async (p: NutritionPlan) => p);
const mockPlansEnabled = jest.fn();
jest.mock("@/ui/hooks/useNutritionPlans", () => ({
  useNutritionPlans: (enabled: boolean) => {
    mockPlansEnabled(enabled);
    return { cache: mockPlansCache, save: mockSave };
  },
}));

// -- fixtures ---------------------------------------------------------------

const MEALS: UserMeal[] = (
  [
    ["um-b", "Breakfast", "breakfast", "breakfast"],
    ["um-l", "Lunch", "lunch", "lunch"],
    ["um-s", "Snack", "snack", "snack"],
    ["um-d", "Dinner", "dinner", "dinner"],
  ] as const
).map(([id, name, slot, key], i) => ({
  id,
  name,
  logSlot: slot,
  sortOrder: i,
  defaultKey: key,
  clientRequestId: null,
  archivedAt: null,
  updatedAt: "2026-11-20T00:00:00.000Z",
}));

const meal = (id: string, name: string, extra: Partial<Meal> = {}): Meal => ({
  id,
  userId: USER,
  name,
  photoUrl: null,
  totalKcal: 526,
  totalProteinG: 34,
  totalCarbsG: 48,
  totalFatG: 21,
  items: [],
  ...extra,
});

const recipe = (
  id: string,
  name: string,
  extra: Partial<Recipe> = {},
): Recipe => ({
  id,
  userId: USER,
  name,
  photoUrl: null,
  servings: 2,
  instructions: null,
  source: "manual",
  sourceUrl: null,
  totalKcal: 910,
  totalProteinG: 76,
  totalCarbsG: 96,
  totalFatG: 24,
  ingredients: [],
  ...extra,
});

const food = (id: string, name: string): Food => ({
  id,
  name,
  brand: null,
  barcode: null,
  kcal: 230,
  proteinG: 9,
  carbsG: 46,
  fatG: 1,
  servingSize: 85,
  servingUnit: "g",
  servingQuantity: null,
  source: "openfoodfacts",
  createdBy: null,
});

const entry = (id: string, extra: Partial<NutritionEntry>): NutritionEntry => ({
  id,
  userId: USER,
  foodId: null,
  recipeId: null,
  mealId: null,
  mealSlot: "breakfast",
  servings: 1,
  kcal: 230,
  proteinG: 9,
  carbsG: 46,
  fatG: 1,
  loggedAt: `${TODAY}T12:00:00.000Z`,
  loggedByUserId: null,
  aiEstimated: false,
  aiConfidence: null,
  customName: null,
  ...extra,
});

const day = (
  iso: string,
  entries: NutritionEntry[],
  consumedKcal = 0,
  target: number | null = 2500,
): FuelToday => ({
  date: iso,
  targets:
    target === null
      ? null
      : {
          userId: USER,
          dailyKcal: target,
          proteinG: 150,
          carbsG: 250,
          fatG: 80,
          waterCups: 8,
          preset: null,
          setByUserId: null,
          setByName: null,
          updatedAt: null,
        },
  consumed: {
    kcal: consumedKcal,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    waterCups: 0,
  },
  remainingKcal: 0,
  entriesBySlot: {
    breakfast: entries,
    lunch: [],
    snack: [],
    dinner: [],
  },
});

const plan = (
  id: string,
  name: string,
  meals: NutritionPlan["meals"],
): NutritionPlan => ({
  id,
  ownerId: USER,
  name,
  notes: null,
  source: "manual",
  sourcePlanId: null,
  revision: 1,
  archivedAt: null,
  createdAt: "2026-11-20T00:00:00.000Z",
  updatedAt: "2026-11-20T00:00:00.000Z",
  totals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  meals,
});

const planMeal = (
  id: string,
  name: string,
  items = 0,
): NutritionPlan["meals"][number] => ({
  id,
  name,
  logSlot: "breakfast",
  sortOrder: 0,
  totals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  items: Array.from({ length: items }, (_, i) => ({
    id: `it-${i}`,
    kind: "custom" as const,
    foodId: null,
    recipeId: null,
    mealId: null,
    name: "x",
    servings: 1,
    sortOrder: i,
    food: null,
    recipe: null,
    meal: null,
    custom: { name: "x", kcal: 1, proteinG: 0, carbsG: 0, fatG: 0 },
    logEntry: {
      customName: "x",
      servings: 1,
      kcal: 1,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    },
    kcal: 1,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
  })),
});

beforeEach(() => {
  jest.clearAllMocks();
  probe.tab = null;
  probe.log = null;
  probe.plan = null;
  days.clear();
  foods.clear();
  cachedTarget = null;
  mockSession = { userId: USER };
  mockSavedMeals = [];
  mockRecipes = [];
  mockUserMeals = MEALS;
  mockPlansCache = {
    mine: [],
    fromCoaches: [],
    asOf: null,
    conflictPlanIds: [],
  };
  act(() => useFuelSheets.setState({ date: TODAY, rev: 0 }));
  act(() => useAddRecipeMenu.setState({ open: false }));
});

// -- pure helpers ------------------------------------------------------------

describe("Meals tab helpers", () => {
  it("savedMealSub counts the foods, or is empty without item detail", () => {
    expect(savedMealSub(meal("a", "A"))).toBe("");
    const items = [0, 1, 2].map((i) => ({
      id: `i${i}`,
      foodId: "f",
      recipeId: null,
      servings: 1,
      sortOrder: i,
    }));
    expect(savedMealSub(meal("a", "A", { items }))).toBe("3 foods");
    expect(savedMealSub(meal("a", "A", { items: items.slice(0, 1) }))).toBe(
      "1 food",
    );
  });

  it("recipeSub says My recipe, or Imported with the site, and the portions", () => {
    expect(recipeSub(recipe("r", "R"))).toBe("My recipe · 2 portions");
    expect(recipeSub(recipe("r", "R", { servings: 1 }))).toBe(
      "My recipe · 1 portion",
    );
    expect(
      recipeSub(
        recipe("r", "R", {
          servings: 6,
          source: "url_import",
          sourceUrl: "https://www.bbcgoodfood.com/recipes/chilli",
        }),
      ),
    ).toBe("Imported · bbcgoodfood.com · 6 portions");
    expect(recipeSub(recipe("r", "R", { sourceUrl: "https://" }))).toBe(
      "Imported · 2 portions",
    );
  });

  it("foodSub shows the food's serving, times the servings logged", () => {
    const e = entry("e", { foodId: "f" });
    expect(foodSub(e, food("f", "Bagel"))).toBe("85 g");
    expect(foodSub({ ...e, servings: 1.5 }, food("f", "Bagel"))).toBe(
      "1.5 × 85 g",
    );
    expect(foodSub({ ...e, servings: 2 }, null)).toBe("2 servings");
    expect(foodSub(e, null)).toBe("1 serving");
    expect(foodSub(e, { ...food("f", "Oil"), servingSize: 13.333 })).toBe(
      "13.3 g",
    );
  });

  it("savedMealsByUse puts the most logged first and keeps ties in order", () => {
    const list = [meal("a", "A"), meal("b", "B"), meal("c", "C")];
    const used = [
      entry("1", { mealId: "c" }),
      entry("2", { mealId: "c" }),
      entry("3", { mealId: "b" }),
      entry("4", { foodId: "f" }),
    ];
    expect(savedMealsByUse(list, used).map((m) => m.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("mealForNow picks the meal for the time of day, else the first", () => {
    expect(mealForNow(MEALS, new Date(2026, 10, 23, 8))?.id).toBe("um-b");
    expect(mealForNow(MEALS, new Date(2026, 10, 23, 19))?.id).toBe("um-d");
    expect(mealForNow([MEALS[1]!], new Date(2026, 10, 23, 8))?.id).toBe("um-l");
    expect(mealForNow([], new Date())).toBeNull();
  });

  it("logDayLabel says Today, Yesterday or the short day", () => {
    expect(logDayLabel(TODAY, TODAY)).toBe("Today");
    expect(logDayLabel(addDaysISO(TODAY, -1), TODAY)).toBe("Yesterday");
    expect(logDayLabel("2026-11-18", "2026-11-23")).toBe("Wed 18");
  });

  it("useMealsTabNew opens the add-recipe menu", () => {
    let open: () => void = () => {};
    function Probe() {
      open = useMealsTabNew();
      return null;
    }
    render(<Probe />);
    act(() => open());
    expect(useAddRecipeMenu.getState().open).toBe(true);
  });
});

// -- MealsTabContainer -------------------------------------------------------

describe("MealsTabContainer", () => {
  it("lists saved meals most used first, with their macros", () => {
    mockSavedMeals = [
      meal("m1", "Bagel breakfast", { photoUrl: "https://x.test/b.jpg" }),
      meal("m2", "Chicken, rice and veg"),
    ];
    days.set(TODAY, day(TODAY, [entry("e1", { mealId: "m2" })]));
    render(<MealsTabContainer />);
    expect(probe.tab?.library).toBe("saved");
    expect(probe.tab?.rows.map((r) => r.key)).toEqual(["m:m2", "m:m1"]);
    expect(probe.tab?.rows[1]).toEqual({
      key: "m:m1",
      name: "Bagel breakfast",
      sub: "",
      photoUrl: "https://x.test/b.jpg",
      kcal: 526,
      carbsG: 48,
      fatG: 21,
      proteinG: 34,
      canOpen: true,
    });
    expect(probe.tab?.loggingKey).toBeNull();
  });

  it("recipes show one portion; unknown totals stay null", () => {
    mockRecipes = [
      recipe("r1", "Tuna pasta salad"),
      recipe("r2", "Turkey chilli", {
        totalKcal: null,
        totalCarbsG: null,
        totalFatG: null,
        totalProteinG: null,
      }),
    ];
    render(<MealsTabContainer />);
    act(() => probe.tab!.onLibrary("recipes"));
    expect(probe.tab?.rows[0]).toEqual(
      expect.objectContaining({
        key: "r:r1",
        sub: "My recipe · 2 portions",
        kcal: 455,
        carbsG: 48,
        fatG: 12,
        proteinG: 38,
        canOpen: true,
      }),
    );
    expect(probe.tab?.rows[1]).toEqual(
      expect.objectContaining({ kcal: null, carbsG: null }),
    );
  });

  it("foods are the distinct foods logged on the cached days, newest first", () => {
    foods.set("f1", food("f1", "Bagel"));
    const yesterday = addDaysISO(TODAY, -1);
    days.set(
      TODAY,
      day(TODAY, [
        entry("e1", { foodId: "f1", loggedAt: `${TODAY}T12:00:00.000Z` }),
        entry("e2", { mealId: "m1" }),
        entry("e3", { recipeId: "r1" }),
      ]),
    );
    days.set(
      yesterday,
      day(yesterday, [
        entry("e4", { foodId: "f1", loggedAt: `${yesterday}T12:00:00.000Z` }),
        entry("e5", {
          customName: "Flat white",
          kcal: 120,
          loggedAt: `${yesterday}T12:00:00.000Z`,
        }),
        entry("e6", {
          foodId: "f-gone",
          customName: null,
          loggedAt: `${yesterday}T11:00:00.000Z`,
        }),
      ]),
    );
    render(<MealsTabContainer />);
    act(() => probe.tab!.onLibrary("foods"));
    expect(probe.tab?.rows.map((r) => [r.name, r.sub, r.canOpen])).toEqual([
      ["Bagel", "85 g", false],
      ["Flat white", "1 serving", false],
      ["Logged food", "1 serving", false],
    ]);
    expect(probe.tab?.rows[0]?.photoUrl).toBeNull();
  });

  it("search filters the picked list by name", () => {
    mockSavedMeals = [
      meal("m1", "Bagel breakfast"),
      meal("m2", "Protein shake"),
    ];
    render(<MealsTabContainer />);
    act(() => probe.tab!.onQuery("  SHAKE "));
    expect(probe.tab?.query).toBe("  SHAKE ");
    expect(probe.tab?.rows.map((r) => r.name)).toEqual(["Protein shake"]);
  });

  it("a meal or recipe row opens its detail page; a food row goes nowhere", () => {
    render(<MealsTabContainer />);
    act(() => probe.tab!.onOpen("m:m 1"));
    act(() => probe.tab!.onOpen("r:r1"));
    act(() => probe.tab!.onOpen("f:food:f1"));
    expect(mockPush.mock.calls).toEqual([
      ["/(app)/fuel/meal/m%201"],
      ["/(app)/fuel/recipe/r1"],
    ]);
  });

  it("+ logs one serving of a saved meal into the meal for now, today", async () => {
    mockSavedMeals = [meal("m1", "Bagel breakfast")];
    render(<MealsTabContainer />);
    const into = mealForNow(MEALS, new Date())!;
    await act(async () => probe.tab!.onLog("m:m1"));
    expect(mockLogMutate).toHaveBeenCalledWith([
      {
        mealSlot: into.logSlot,
        userMealId: into.id,
        mealId: "m1",
        servings: 1,
        loggedAt: loggedAtNoonUtc(TODAY),
      },
    ]);
    expect(Haptics.notificationAsync).toHaveBeenCalled();
    expect(useFuelSheets.getState().rev).toBe(1);
    expect(probe.tab?.loggingKey).toBeNull();
  });

  it("+ logs a recipe portion, and a food at its logged amount", async () => {
    mockRecipes = [recipe("r1", "Tuna pasta salad")];
    foods.set("f1", food("f1", "Bagel"));
    days.set(TODAY, day(TODAY, [entry("e1", { foodId: "f1", servings: 2 })]));
    render(<MealsTabContainer />);
    act(() => probe.tab!.onLibrary("recipes"));
    await act(async () => probe.tab!.onLog("r:r1"));
    expect(mockLogMutate.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ recipeId: "r1", servings: 1 }),
    ]);
    act(() => probe.tab!.onLibrary("foods"));
    await act(async () => probe.tab!.onLog("f:food:f1"));
    expect(mockLogMutate.mock.calls[1]?.[0]).toEqual([
      expect.objectContaining({ foodId: "f1", servings: 2 }),
    ]);
  });

  it("shows the row as logging until the write lands, and ignores a second tap", async () => {
    mockSavedMeals = [meal("m1", "Bagel breakfast")];
    let release: () => void = () => {};
    mockLogMutate.mockImplementationOnce(
      () => new Promise((r) => (release = () => r([]))),
    );
    render(<MealsTabContainer />);
    act(() => probe.tab!.onLog("m:m1"));
    expect(probe.tab?.loggingKey).toBe("m:m1");
    act(() => probe.tab!.onLog("m:m1"));
    expect(mockLogMutate).toHaveBeenCalledTimes(1);
    await act(async () => release());
    expect(probe.tab?.loggingKey).toBeNull();
  });

  it("does nothing for an unknown row or with no meals to log into", async () => {
    render(<MealsTabContainer />);
    await act(async () => probe.tab!.onLog("m:missing"));
    mockUserMeals = [];
    mockSavedMeals = [meal("m1", "Bagel breakfast")];
    render(<MealsTabContainer />);
    await act(async () => probe.tab!.onLog("m:m1"));
    expect(mockLogMutate).not.toHaveBeenCalled();
  });

  it("signed out, nothing is read from the day cache", () => {
    mockSession = null;
    mockSavedMeals = null;
    mockRecipes = null;
    render(<MealsTabContainer />);
    expect(mockStorage.getCachedFuelToday).not.toHaveBeenCalled();
    expect(probe.tab?.rows).toEqual([]);
    act(() => probe.tab!.onLibrary("recipes"));
    expect(probe.tab?.rows).toEqual([]);
  });
});

// -- LogMealSheetContainer ---------------------------------------------------

describe("LogMealSheetContainer (N14)", () => {
  const item = {
    kind: "meal" as const,
    id: "m1",
    name: "Bagel breakfast",
    kcal: 526,
  };
  const mount = (
    over: Partial<Parameters<typeof LogMealSheetContainer>[0]> = {},
  ) => {
    const props = {
      visible: true,
      item,
      onClose: jest.fn(),
      onLogged: jest.fn(),
      ...over,
    };
    return { ...render(<LogMealSheetContainer {...props} />), props };
  };

  it("starts on today, the meal for now and 1×, and says what is left", () => {
    days.set(TODAY, day(TODAY, [], 0, 2501));
    mount();
    const into = mealForNow(MEALS, new Date())!;
    expect(probe.log?.name).toBe("Bagel breakfast");
    expect(probe.log?.day.selectedKey).toBe(TODAY);
    expect(probe.log?.day.options).toHaveLength(7);
    expect(probe.log?.day.options[0]?.label).toBe("Today");
    expect(probe.log?.meal.selectedKey).toBe(into.id);
    expect(probe.log?.meal.options.map((o) => o.label)).toEqual([
      "Breakfast",
      "Lunch",
      "Snack",
      "Dinner",
    ]);
    expect(probe.log?.portion.selectedKey).toBe("1");
    expect(probe.log?.portion.options.map((o) => o.label)).toEqual([
      "0.5×",
      "1×",
      "1.5×",
      "2×",
      "3×",
    ]);
    expect(probe.log?.note).toBe("526 kcal · leaves 1,975 today.");
    expect(probe.log?.kcalLabel).toBe("526");
    expect(probe.log?.canLog).toBe(true);
  });

  it("picking a day, meal and portion changes the log and the note", async () => {
    const yesterday = addDaysISO(TODAY, -1);
    days.set(yesterday, day(yesterday, [], 2400, 2500));
    const { props } = mount();
    act(() => probe.log!.onToggleField("day"));
    expect(probe.log?.openField).toBe("day");
    act(() => probe.log!.onToggleField("day"));
    expect(probe.log?.openField).toBeNull();
    act(() => probe.log!.onToggleField("day"));
    act(() => probe.log!.onPick("day", yesterday));
    expect(probe.log?.openField).toBeNull();
    act(() => probe.log!.onPick("meal", "um-l"));
    act(() => probe.log!.onPick("portion", "2"));
    expect(probe.log?.kcalLabel).toBe("1,052");
    expect(probe.log?.note).toBe("1,052 kcal · 952 over on Yesterday.");
    await act(async () => probe.log!.onLog());
    expect(mockLogMutate).toHaveBeenCalledWith([
      {
        mealSlot: "lunch",
        userMealId: "um-l",
        mealId: "m1",
        servings: 2,
        loggedAt: loggedAtNoonUtc(yesterday),
      },
    ]);
    expect(useFuelSheets.getState().rev).toBe(1);
    expect(props.onLogged).toHaveBeenCalled();
  });

  it("a recipe logs by recipeId; with no cached day the note is just kcal", async () => {
    mount({ item: { kind: "recipe", id: "r1", name: "Chilli", kcal: 420.4 } });
    expect(probe.log?.note).toBe("420 kcal.");
    await act(async () => probe.log!.onLog());
    expect(mockLogMutate.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ recipeId: "r1", servings: 1 }),
    ]);
  });

  it("falls back to the cached target when the day has none", () => {
    cachedTarget = { dailyKcal: 2000 };
    days.set(TODAY, day(TODAY, [], 500, null));
    mount();
    expect(probe.log?.note).toBe("526 kcal · leaves 974 today.");
  });

  it("starts on the day Fuel is showing, never after today", () => {
    const past = addDaysISO(TODAY, -3);
    act(() => useFuelSheets.setState({ date: past }));
    mount();
    expect(probe.log?.day.selectedKey).toBe(past);
    act(() => useFuelSheets.setState({ date: addDaysISO(TODAY, 2) }));
    expect(probe.log?.day.selectedKey).toBe(TODAY);
  });

  it("can't log without an item or a meal, nor twice at once", async () => {
    mockUserMeals = [];
    mount({ item: null });
    expect(probe.log?.canLog).toBe(false);
    expect(probe.log?.name).toBe("");
    await act(async () => probe.log!.onLog());
    expect(mockLogMutate).not.toHaveBeenCalled();

    mockUserMeals = MEALS;
    let release: () => void = () => {};
    mockLogMutate.mockImplementationOnce(
      () => new Promise((r) => (release = () => r([]))),
    );
    mount();
    act(() => probe.log!.onLog());
    expect(probe.log?.logging).toBe(true);
    act(() => probe.log!.onLog());
    expect(mockLogMutate).toHaveBeenCalledTimes(1);
    await act(async () => release());
    expect(probe.log?.logging).toBe(false);
  });

  it("signed out the note is just kcal", () => {
    mockSession = null;
    mount();
    expect(probe.log?.note).toBe("526 kcal.");
  });

  it("closing calls onClose; hidden it keeps its state", () => {
    const { props } = mount({ visible: false });
    act(() => probe.log!.onClose());
    expect(props.onClose).toHaveBeenCalled();
  });
});

// -- AddToPlanSheetContainer -------------------------------------------------

describe("AddToPlanSheetContainer (N13 Add to plan)", () => {
  const savedMeal = meal("m1", "Bagel breakfast");
  const mount = (
    over: Partial<Parameters<typeof AddToPlanSheetContainer>[0]> = {},
  ) => {
    const props = {
      visible: true,
      source: { kind: "meal" as const, meal: savedMeal },
      onClose: jest.fn(),
      ...over,
    };
    return { ...render(<AddToPlanSheetContainer {...props} />), props };
  };

  it("offers only my visible plans and reads them only while open", () => {
    mockPlansCache = {
      ...mockPlansCache,
      mine: [
        plan("p1", "Training day", [
          planMeal("pm1", "Breakfast"),
          planMeal("pm2", "Lunch"),
        ]),
        { ...plan("p-old", "Old", []), archivedAt: "2026-11-01T00:00:00.000Z" },
        plan("p2", "Rest day", []),
      ],
    };
    mount();
    expect(mockPlansEnabled).toHaveBeenCalledWith(true);
    expect(probe.plan?.itemName).toBe("Bagel breakfast");
    expect(probe.plan?.plans).toEqual([
      { id: "p1", name: "Training day" },
      { id: "p2", name: "Rest day" },
    ]);
    expect(probe.plan?.selectedPlanId).toBe("p1");
    expect(probe.plan?.meals.map((m) => m.id)).toEqual(["pm1", "pm2"]);
    expect(probe.plan?.selectedMealId).toBe("pm1");
    expect(probe.plan?.note).toBe(
      "Adding to your Training day plan, not today's log",
    );
    expect(probe.plan?.addLabel).toBe("Add to Training day");
    expect(probe.plan?.canAdd).toBe(true);

    act(() => probe.plan!.onSelectMeal("pm2"));
    expect(probe.plan?.selectedMealId).toBe("pm2");
    act(() => probe.plan!.onSelectPlan("p2"));
    expect(probe.plan?.selectedPlanId).toBe("p2");
    expect(probe.plan?.meals).toEqual([]);
    expect(probe.plan?.canAdd).toBe(false);
  });

  it("adds the saved meal to the picked plan meal and saves the plan", async () => {
    mockPlansCache = {
      ...mockPlansCache,
      mine: [
        plan("p1", "Training day", [
          planMeal("pm1", "Breakfast"),
          planMeal("pm2", "Lunch", 1),
        ]),
      ],
    };
    const { props } = mount();
    act(() => probe.plan!.onSelectMeal("pm2"));
    await act(async () => probe.plan!.onAdd());
    expect(mockSave).toHaveBeenCalledTimes(1);
    const saved = mockSave.mock.calls[0]![0];
    const lunch = saved.meals.find((m) => m.id === "pm2")!;
    expect(lunch.items).toHaveLength(2);
    expect(lunch.items[1]).toEqual(
      expect.objectContaining({
        kind: "meal",
        mealId: "m1",
        servings: 1,
        kcal: 526,
        sortOrder: 1,
      }),
    );
    expect(lunch.items[1]?.id.startsWith("local-")).toBe(true);
    expect(saved.totals.kcal).toBe(527);
    expect(Haptics.notificationAsync).toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it("adds a recipe as one portion", async () => {
    mockPlansCache = {
      ...mockPlansCache,
      mine: [plan("p1", "Training day", [planMeal("pm1", "Breakfast")])],
    };
    mount({
      source: { kind: "recipe", recipe: recipe("r1", "Tuna pasta salad") },
    });
    expect(probe.plan?.itemName).toBe("Tuna pasta salad");
    await act(async () => probe.plan!.onAdd());
    const item = mockSave.mock.calls[0]![0].meals[0]!.items[0]!;
    expect(item).toEqual(
      expect.objectContaining({ kind: "recipe", recipeId: "r1", kcal: 455 }),
    );
  });

  it("a full plan meal can't take more", async () => {
    mockPlansCache = {
      ...mockPlansCache,
      mine: [plan("p1", "Training day", [planMeal("pm1", "Breakfast", 50)])],
    };
    mount();
    expect(probe.plan?.canAdd).toBe(false);
    expect(probe.plan?.note).toBe("Breakfast is full. Pick another meal.");
    await act(async () => probe.plan!.onAdd());
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("with no plans, or nothing to add, it adds nothing", async () => {
    mount({ source: null, visible: false });
    expect(mockPlansEnabled).toHaveBeenCalledWith(false);
    expect(probe.plan?.plans).toEqual([]);
    expect(probe.plan?.itemName).toBe("");
    expect(probe.plan?.addLabel).toBe("Add to plan");
    expect(probe.plan?.note).toBe("");
    expect(probe.plan?.selectedPlanId).toBeNull();
    expect(probe.plan?.selectedMealId).toBeNull();
    await act(async () => probe.plan!.onAdd());
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("ignores a second tap while saving", async () => {
    mockPlansCache = {
      ...mockPlansCache,
      mine: [plan("p1", "Training day", [planMeal("pm1", "Breakfast")])],
    };
    let release: () => void = () => {};
    mockSave.mockImplementationOnce(
      (p) => new Promise((r) => (release = () => r(p))),
    );
    mount();
    act(() => probe.plan!.onAdd());
    expect(probe.plan?.adding).toBe(true);
    act(() => probe.plan!.onAdd());
    expect(mockSave).toHaveBeenCalledTimes(1);
    await act(async () => release());
    expect(probe.plan?.adding).toBe(false);
  });
});
