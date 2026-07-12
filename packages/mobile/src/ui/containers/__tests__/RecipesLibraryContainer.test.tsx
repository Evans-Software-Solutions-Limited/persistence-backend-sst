import { act, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Food, Meal, Recipe } from "@/domain/models/nutrition";
import { fail, ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { RecipesLibraryPresenterProps } from "@/ui/presenters/RecipesLibraryPresenter";
import { RecipesLibraryContainer } from "../RecipesLibraryContainer";

const mockProbe: { last: RecipesLibraryPresenterProps | null } = { last: null };
jest.mock("@/ui/presenters/RecipesLibraryPresenter", () => ({
  RecipesLibraryPresenter: (props: RecipesLibraryPresenterProps) => {
    mockProbe.last = props;
    return null;
  },
}));

const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: {
    back: (...args: unknown[]) => mockRouterBack(...args),
    push: (...args: unknown[]) => mockRouterPush(...args),
  },
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
  name: "Oats",
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

function buildMeal(overrides: Partial<Meal> = {}): Meal {
  return {
    id: "m1",
    userId: USER,
    name: "Standard breakfast",
    photoUrl: null,
    totalKcal: 480,
    totalProteinG: 30,
    totalCarbsG: 50,
    totalFatG: 12,
    items: [],
    ...overrides,
  };
}

function buildRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
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
    ...overrides,
  };
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

describe("RecipesLibraryContainer", () => {
  beforeEach(() => {
    mockProbe.last = null;
    mockRouterBack.mockClear();
    mockRouterPush.mockClear();
  });

  it("defaults to the Meals tab and renders cached meal rows", async () => {
    const { adapters, api, storage } = makeAdapters();
    storage.cacheMeal(USER, buildMeal());
    // Keep the refresh from wiping the seeded item detail (the real list
    // endpoint omits items) so this render reflects the cached row.
    jest
      .spyOn(api, "getMeals")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "down", status: 500 }),
      );

    render(
      <Wrapper adapters={adapters}>
        <RecipesLibraryContainer />
      </Wrapper>,
    );

    expect(mockProbe.last?.tab).toBe("Meals");
    await waitFor(() =>
      expect(mockProbe.last?.meals).toEqual([
        {
          id: "m1",
          name: "Standard breakfast",
          kcal: 480,
          itemsSummary: null,
        },
      ]),
    );
  });

  it("resolves the meal item summary from cached food/recipe names when items are present", async () => {
    const { adapters, api, storage } = makeAdapters();
    storage.cacheFoods([food]);
    storage.cacheRecipe(USER, buildRecipe());
    storage.cacheMeal(
      USER,
      buildMeal({
        items: [
          {
            id: "mi1",
            foodId: "f1",
            recipeId: null,
            servings: 1,
            sortOrder: 0,
          },
          {
            id: "mi2",
            foodId: null,
            recipeId: "r1",
            servings: 1,
            sortOrder: 1,
          },
        ],
      }),
    );
    jest
      .spyOn(api, "getMeals")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "down", status: 500 }),
      );

    render(
      <Wrapper adapters={adapters}>
        <RecipesLibraryContainer />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(mockProbe.last?.meals[0]?.itemsSummary).toBe(
        "Oats + Protein oats",
      ),
    );
  });

  it("skips an item that resolves to neither a food nor a recipe name when building the item summary", async () => {
    const { adapters, api, storage } = makeAdapters();
    storage.cacheFoods([food]);
    storage.cacheMeal(
      USER,
      buildMeal({
        items: [
          {
            id: "mi1",
            foodId: "f1",
            recipeId: null,
            servings: 1,
            sortOrder: 0,
          },
          {
            id: "mi2",
            foodId: null,
            recipeId: null,
            servings: 1,
            sortOrder: 1,
          },
        ],
      }),
    );
    jest
      .spyOn(api, "getMeals")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "down", status: 500 }),
      );

    render(
      <Wrapper adapters={adapters}>
        <RecipesLibraryContainer />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(mockProbe.last?.meals[0]?.itemsSummary).toBe("Oats"),
    );
  });

  it("drops an item summary to null when neither of its refs resolves to a cached name", async () => {
    const { adapters, api, storage } = makeAdapters();
    // foodId/recipeId both set, but neither "f-missing" nor "r-missing" is
    // actually cached — exercises the `?? null` fallback on both the food
    // and recipe lookup, and the "nothing resolved" -> null summary branch.
    storage.cacheMeal(
      USER,
      buildMeal({
        items: [
          {
            id: "mi1",
            foodId: "f-missing",
            recipeId: null,
            servings: 1,
            sortOrder: 0,
          },
          {
            id: "mi2",
            foodId: null,
            recipeId: "r-missing",
            servings: 1,
            sortOrder: 1,
          },
        ],
      }),
    );
    jest
      .spyOn(api, "getMeals")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "down", status: 500 }),
      );

    render(
      <Wrapper adapters={adapters}>
        <RecipesLibraryContainer />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(mockProbe.last?.meals[0]?.itemsSummary).toBeNull(),
    );
  });

  it("falls back to the raw source label for a non-manual recipe with no source URL", async () => {
    const { adapters, api, storage } = makeAdapters();
    storage.cacheRecipes(USER, [
      buildRecipe({ source: "openfoodfacts", sourceUrl: null }),
    ]);
    jest
      .spyOn(api, "getRecipes")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "down", status: 500 }),
      );

    render(
      <Wrapper adapters={adapters}>
        <RecipesLibraryContainer />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(mockProbe.last?.recipes[0]?.secondaryLine).toBe(
        "1 serving · openfoodfacts",
      ),
    );
  });

  it("renders recipe rows with a servings/source secondary line and macro fields", async () => {
    const { adapters, api, storage } = makeAdapters();
    storage.cacheRecipes(USER, [buildRecipe({ servings: 2 })]);
    jest
      .spyOn(api, "getRecipes")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "down", status: 500 }),
      );

    render(
      <Wrapper adapters={adapters}>
        <RecipesLibraryContainer />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(mockProbe.last?.recipes).toEqual([
        {
          id: "r1",
          name: "Protein oats",
          kcal: 420,
          proteinG: 32,
          carbsG: 58,
          fatG: 8,
          secondaryLine: "2 servings · My recipe",
        },
      ]),
    );
  });

  it("shows a hostname secondary line for an imported recipe", async () => {
    const { adapters, api, storage } = makeAdapters();
    storage.cacheRecipes(USER, [
      buildRecipe({
        source: "web",
        sourceUrl: "https://www.bbcgoodfood.com/recipes/chicken-rice-bowl",
      }),
    ]);
    jest
      .spyOn(api, "getRecipes")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "down", status: 500 }),
      );

    render(
      <Wrapper adapters={adapters}>
        <RecipesLibraryContainer />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(mockProbe.last?.recipes[0]?.secondaryLine).toBe(
        "1 serving · bbcgoodfood.com",
      ),
    );
  });

  it("filters meals by name (case-insensitive), with a no-match empty result", async () => {
    const { adapters, api, storage } = makeAdapters();
    storage.cacheMeals(USER, [
      buildMeal({ id: "m1", name: "Standard breakfast" }),
      buildMeal({ id: "m2", name: "Sushi night" }),
    ]);
    jest
      .spyOn(api, "getMeals")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "down", status: 500 }),
      );

    render(
      <Wrapper adapters={adapters}>
        <RecipesLibraryContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.meals).toHaveLength(2));

    act(() => mockProbe.last!.onQueryChange("SUSHI"));
    await waitFor(() =>
      expect(mockProbe.last?.meals.map((m) => m.id)).toEqual(["m2"]),
    );

    act(() => mockProbe.last!.onQueryChange("zzz-no-match"));
    await waitFor(() => expect(mockProbe.last?.meals).toHaveLength(0));
  });

  it("routes Back, Add, and row selection", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheMeal(USER, buildMeal());
    storage.cacheRecipe(USER, buildRecipe());

    render(
      <Wrapper adapters={adapters}>
        <RecipesLibraryContainer />
      </Wrapper>,
    );

    mockProbe.last!.onBack();
    expect(mockRouterBack).toHaveBeenCalledTimes(1);

    mockProbe.last!.onAdd();
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/fuel/save-meal");

    mockProbe.last!.onSelectMeal("m1");
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/fuel/meal/m1");

    mockProbe.last!.onSelectRecipe("r1");
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/fuel/recipe/r1");
  });

  it("shows a blocking loader when neither tab has cached data yet", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipesLibraryContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.hasData).toBe(false);
    expect(mockProbe.last?.isLoading).toBe(true);
  });

  it("surfaces the error state when the meals fetch fails with no cache", async () => {
    const { adapters, api } = makeAdapters();
    jest
      .spyOn(api, "getMeals")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "down", status: 500 }),
      );
    render(
      <Wrapper adapters={adapters}>
        <RecipesLibraryContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.error).not.toBeNull());
    expect(mockProbe.last?.hasData).toBe(false);
  });

  it("onRefresh re-triggers the current tab's fetch", async () => {
    const { adapters, api, storage } = makeAdapters();
    storage.cacheMeal(USER, buildMeal());
    const getMealsSpy = jest.spyOn(api, "getMeals");
    render(
      <Wrapper adapters={adapters}>
        <RecipesLibraryContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(getMealsSpy).toHaveBeenCalled());
    const callsBefore = getMealsSpy.mock.calls.length;
    await act(async () => {
      mockProbe.last!.onRefresh();
    });
    await waitFor(() =>
      expect(getMealsSpy.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });

  it("switching to the Recipes tab reads from the recipe cache", async () => {
    const { adapters, api, storage } = makeAdapters();
    storage.cacheRecipe(USER, buildRecipe());
    jest
      .spyOn(api, "getRecipes")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "down", status: 500 }),
      );
    render(
      <Wrapper adapters={adapters}>
        <RecipesLibraryContainer />
      </Wrapper>,
    );

    act(() => mockProbe.last!.onTabChange("Recipes"));
    await waitFor(() => expect(mockProbe.last?.tab).toBe("Recipes"));
    expect(mockProbe.last?.hasData).toBe(true);
  });

  it("shows no data on the Recipes tab when nothing is cached there yet", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipesLibraryContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onTabChange("Recipes"));
    expect(mockProbe.last?.tab).toBe("Recipes");
    expect(mockProbe.last?.hasData).toBe(false);
  });

  it("filters recipes by name (case-insensitive), with a no-match empty result", async () => {
    const { adapters, api, storage } = makeAdapters();
    storage.cacheRecipes(USER, [
      buildRecipe({ id: "r1", name: "Protein oats" }),
      buildRecipe({ id: "r2", name: "Beef stir fry" }),
    ]);
    jest
      .spyOn(api, "getRecipes")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "down", status: 500 }),
      );

    render(
      <Wrapper adapters={adapters}>
        <RecipesLibraryContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onTabChange("Recipes"));
    await waitFor(() => expect(mockProbe.last?.recipes).toHaveLength(2));

    act(() => mockProbe.last!.onQueryChange("BEEF"));
    await waitFor(() =>
      expect(mockProbe.last?.recipes.map((r) => r.id)).toEqual(["r2"]),
    );

    act(() => mockProbe.last!.onQueryChange("zzz-no-match"));
    await waitFor(() => expect(mockProbe.last?.recipes).toHaveLength(0));
  });

  it("onRefresh re-triggers the recipes fetch when on the Recipes tab", async () => {
    const { adapters, api, storage } = makeAdapters();
    storage.cacheRecipe(USER, buildRecipe());
    const getRecipesSpy = jest.spyOn(api, "getRecipes");
    render(
      <Wrapper adapters={adapters}>
        <RecipesLibraryContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onTabChange("Recipes"));
    await waitFor(() => expect(getRecipesSpy).toHaveBeenCalled());
    const callsBefore = getRecipesSpy.mock.calls.length;
    await act(async () => {
      mockProbe.last!.onRefresh();
    });
    await waitFor(() =>
      expect(getRecipesSpy.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });
});
