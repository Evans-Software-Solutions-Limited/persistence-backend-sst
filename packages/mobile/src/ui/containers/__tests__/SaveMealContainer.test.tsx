import { act, render } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type {
  Food,
  FuelToday,
  NutritionEntry,
} from "@/domain/models/nutrition";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { localDayISO } from "@/shared/utils";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { SaveMealPresenterProps } from "@/ui/presenters/SaveMealPresenter";
import { SaveMealContainer } from "../SaveMealContainer";

const mockProbe: { last: SaveMealPresenterProps | null } = { last: null };
jest.mock("@/ui/presenters/SaveMealPresenter", () => ({
  SaveMealPresenter: (props: SaveMealPresenterProps) => {
    mockProbe.last = props;
    return null;
  },
}));

const mockRouterBack = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { back: (...args: unknown[]) => mockRouterBack(...args) },
}));

(globalThis as Record<string, unknown>).fetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: {} }),
}));

const USER = "user-1";

const food: Food = {
  id: "f1",
  name: "Oatmeal",
  brand: null,
  barcode: null,
  kcal: 300,
  proteinG: 10,
  carbsG: 50,
  fatG: 5,
  servingSize: 100,
  servingUnit: "g",
  source: "user",
  createdBy: USER,
};

function buildEntry(overrides: Partial<NutritionEntry> = {}): NutritionEntry {
  return {
    id: "e1",
    userId: USER,
    foodId: "f1",
    recipeId: null,
    mealId: null,
    mealSlot: "breakfast",
    servings: 1,
    kcal: 300,
    proteinG: 10,
    carbsG: 50,
    fatG: 5,
    loggedAt: `${localDayISO()}T08:00:00.000Z`,
    loggedByUserId: null,
    aiEstimated: false,
    aiConfidence: null,
    customName: null,
    ...overrides,
  };
}

function emptyFuelToday(date: string): FuelToday {
  return {
    date,
    targets: null,
    consumed: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, waterCups: 0 },
    remainingKcal: 0,
    entriesBySlot: { breakfast: [], lunch: [], snack: [], dinner: [] },
  };
}

function previousDayISO(dayIso: string): string {
  const d = new Date(`${dayIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function makeAdapters(): {
  adapters: Adapters;
  api: InMemoryApiAdapter;
  storage: InMemoryStorageAdapter;
} {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: USER,
    email: "a@b.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  return {
    api,
    storage,
    adapters: {
      api,
      auth,
      storage,
      health: {} as Adapters["health"],
      notifications: {} as Adapters["notifications"],
      payments: {} as Adapters["payments"],
      netInfo: {} as Adapters["netInfo"],
    },
  };
}

function Wrapper({
  adapters,
  children,
}: {
  adapters: Adapters;
  children: ReactNode;
}) {
  return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
}

describe("SaveMealContainer", () => {
  beforeEach(() => {
    mockProbe.last = null;
    mockRouterBack.mockClear();
  });

  it("renders today's and yesterday's logged entries as labeled, unselected rows", () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFoods([food]);
    const todayIso = localDayISO();
    const yIso = previousDayISO(todayIso);
    storage.cacheFuelToday(USER, todayIso, {
      ...emptyFuelToday(todayIso),
      entriesBySlot: {
        breakfast: [
          buildEntry({ id: "e-today", loggedAt: `${todayIso}T08:00:00.000Z` }),
        ],
        lunch: [],
        snack: [],
        dinner: [],
      },
    });
    storage.cacheFuelToday(USER, yIso, {
      ...emptyFuelToday(yIso),
      entriesBySlot: {
        breakfast: [],
        lunch: [],
        snack: [],
        dinner: [
          buildEntry({
            id: "e-yesterday",
            kcal: 540,
            loggedAt: `${yIso}T19:00:00.000Z`,
          }),
        ],
      },
    });

    render(
      <Wrapper adapters={adapters}>
        <SaveMealContainer />
      </Wrapper>,
    );

    expect(mockProbe.last?.rows).toEqual([
      {
        entryId: "e-today",
        label: "Today · Breakfast — Oatmeal · 300 kcal",
        selected: false,
      },
      {
        entryId: "e-yesterday",
        label: "Yesterday · Dinner — Oatmeal · 540 kcal",
        selected: false,
      },
    ]);
  });

  it("resolves recipe-referenced entries and excludes ref-less ones (saved-meal logs, custom entries)", () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheRecipe(USER, {
      id: "r1",
      userId: USER,
      name: "Protein oats",
      photoUrl: null,
      servings: 1,
      instructions: null,
      source: "manual",
      sourceUrl: null,
      totalKcal: 420,
      totalProteinG: 32,
      totalCarbsG: 58,
      totalFatG: 8,
      ingredients: [],
    });
    const todayIso = localDayISO();
    storage.cacheFuelToday(USER, todayIso, {
      ...emptyFuelToday(todayIso),
      entriesBySlot: {
        breakfast: [],
        lunch: [
          buildEntry({
            id: "e-recipe",
            foodId: null,
            recipeId: "r1",
            kcal: 420,
          }),
        ],
        snack: [
          // A saved-meal log (mealId only) — no food/recipe ref, so it can't
          // become a MealItemInput and must be excluded.
          buildEntry({ id: "e-meal", foodId: null, mealId: "m1", kcal: 480 }),
        ],
        dinner: [
          // An AI/custom macro entry (no ref at all) — likewise excluded.
          buildEntry({
            id: "e-custom",
            foodId: null,
            customName: "Salmon dinner",
            kcal: 540,
          }),
        ],
      },
    });

    render(
      <Wrapper adapters={adapters}>
        <SaveMealContainer />
      </Wrapper>,
    );

    expect(mockProbe.last?.rows.map((r) => r.entryId)).toEqual(["e-recipe"]);
    expect(mockProbe.last?.rows[0]?.label).toBe(
      "Today · Lunch — Protein oats · 420 kcal",
    );
  });

  it("shows no rows when neither day has any logged entries", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <SaveMealContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.rows).toEqual([]);
  });

  it("toggling a row flips its selected state", () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFoods([food]);
    const todayIso = localDayISO();
    storage.cacheFuelToday(USER, todayIso, {
      ...emptyFuelToday(todayIso),
      entriesBySlot: {
        breakfast: [buildEntry()],
        lunch: [],
        snack: [],
        dinner: [],
      },
    });
    render(
      <Wrapper adapters={adapters}>
        <SaveMealContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.rows[0]?.selected).toBe(false);

    act(() => mockProbe.last!.onToggleRow("e1"));
    expect(mockProbe.last?.rows[0]?.selected).toBe(true);

    act(() => mockProbe.last!.onToggleRow("e1"));
    expect(mockProbe.last?.rows[0]?.selected).toBe(false);
  });

  it("canSave requires both a non-empty name and at least one selected row", () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFoods([food]);
    const todayIso = localDayISO();
    storage.cacheFuelToday(USER, todayIso, {
      ...emptyFuelToday(todayIso),
      entriesBySlot: {
        breakfast: [buildEntry()],
        lunch: [],
        snack: [],
        dinner: [],
      },
    });
    render(
      <Wrapper adapters={adapters}>
        <SaveMealContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.canSave).toBe(false);

    act(() => mockProbe.last!.onNameChange("My meal"));
    expect(mockProbe.last?.canSave).toBe(false); // still no row selected

    act(() => mockProbe.last!.onToggleRow("e1"));
    expect(mockProbe.last?.canSave).toBe(true);

    act(() => mockProbe.last!.onNameChange(""));
    expect(mockProbe.last?.canSave).toBe(false); // name cleared
  });

  it("Save builds items from the ticked entries and routes back on success", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFoods([food]);
    const todayIso = localDayISO();
    storage.cacheFuelToday(USER, todayIso, {
      ...emptyFuelToday(todayIso),
      entriesBySlot: {
        breakfast: [buildEntry({ id: "e1" })],
        lunch: [
          buildEntry({
            id: "e2",
            foodId: null,
            recipeId: "r1",
            servings: 2,
            kcal: 420,
          }),
        ],
        snack: [],
        dinner: [],
      },
    });
    render(
      <Wrapper adapters={adapters}>
        <SaveMealContainer />
      </Wrapper>,
    );

    act(() => mockProbe.last!.onNameChange("Combo meal"));
    act(() => mockProbe.last!.onToggleRow("e1"));
    act(() => mockProbe.last!.onToggleRow("e2"));
    expect(mockProbe.last?.canSave).toBe(true);

    await act(async () => {
      mockProbe.last!.onSave();
    });

    const created = storage
      .getCachedMeals(USER)
      .find((m) => m.name === "Combo meal");
    expect(created).toBeTruthy();
    expect(
      created?.items.map((i) => ({
        foodId: i.foodId,
        recipeId: i.recipeId,
        servings: i.servings,
        sortOrder: i.sortOrder,
      })),
    ).toEqual([
      { foodId: "f1", recipeId: null, servings: 1, sortOrder: 0 },
      { foodId: null, recipeId: "r1", servings: 2, sortOrder: 1 },
    ]);
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });

  it("Save is a no-op while canSave is false", async () => {
    const { adapters, storage } = makeAdapters();
    const spy = jest.spyOn(storage, "cacheMeal");
    render(
      <Wrapper adapters={adapters}>
        <SaveMealContainer />
      </Wrapper>,
    );
    await act(async () => {
      mockProbe.last!.onSave();
    });
    expect(spy).not.toHaveBeenCalled();
    expect(mockRouterBack).not.toHaveBeenCalled();
  });

  it("Back routes back", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <SaveMealContainer />
      </Wrapper>,
    );
    mockProbe.last!.onBack();
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });
});
