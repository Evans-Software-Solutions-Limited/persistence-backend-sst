import { act, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import * as Haptics from "expo-haptics";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Food, Recipe } from "@/domain/models/nutrition";
import { fail, ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { localDayISO } from "@/shared/utils";
import { useFuelSheets } from "@/state/fuel-sheets";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { RecipeDetailPresenterProps } from "@/ui/presenters/RecipeDetailPresenter";
import { RecipeDetailContainer } from "../RecipeDetailContainer";

const mockProbe: { last: RecipeDetailPresenterProps | null } = { last: null };
jest.mock("@/ui/presenters/RecipeDetailPresenter", () => ({
  RecipeDetailPresenter: (props: RecipeDetailPresenterProps) => {
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
  name: "Chicken breast",
  brand: null,
  barcode: null,
  kcal: 165,
  proteinG: 31,
  carbsG: 0,
  fatG: 3.6,
  servingSize: 100,
  servingUnit: "g",
  source: "user",
  createdBy: USER,
};

function buildRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: "r1",
    userId: USER,
    name: "Chicken & rice bowl",
    photoUrl: null,
    servings: 2,
    instructions: "Cook it well.",
    source: "manual",
    sourceUrl: null,
    totalKcal: 640,
    totalProteinG: 55,
    totalCarbsG: 70,
    totalFatG: 14,
    ingredients: [
      {
        id: "i1",
        foodId: "f1",
        customName: null,
        quantity: 300,
        unit: "g",
        sortOrder: 0,
      },
      {
        id: "i2",
        foodId: null,
        customName: "Jasmine rice",
        quantity: 200,
        unit: "g",
        sortOrder: 1,
      },
    ],
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

describe("RecipeDetailContainer", () => {
  beforeEach(() => {
    mockProbe.last = null;
    mockRouterBack.mockClear();
    jest.clearAllMocks();
    act(() =>
      useFuelSheets.setState({ sheet: null, slot: "breakfast", rev: 0 }),
    );
  });

  it("renders the cached recipe's macros, servings/source line, and resolved ingredient labels", async () => {
    const { adapters, api, storage } = makeAdapters();
    storage.cacheFoods([food]);
    storage.cacheRecipe(USER, buildRecipe());
    jest
      .spyOn(api, "getRecipe")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "down", status: 500 }),
      );

    render(
      <Wrapper adapters={adapters}>
        <RecipeDetailContainer id="r1" />
      </Wrapper>,
    );

    await waitFor(() => expect(mockProbe.last?.found).toBe(true));
    expect(mockProbe.last?.name).toBe("Chicken & rice bowl");
    expect(mockProbe.last?.secondaryLine).toBe("2 servings · My recipe");
    expect(mockProbe.last?.kcal).toBe(640);
    expect(mockProbe.last?.proteinG).toBe(55);
    expect(mockProbe.last?.ingredients).toEqual([
      { id: "i1", label: "Chicken breast · 300 g" },
      { id: "i2", label: "Jasmine rice · 200 g" },
    ]);
    expect(mockProbe.last?.instructions).toBe("Cook it well.");
  });

  it("falls back to the ingredient's custom name when no food is cached for it", async () => {
    const { adapters, api, storage } = makeAdapters();
    storage.cacheRecipe(
      USER,
      buildRecipe({
        ingredients: [
          {
            id: "i1",
            foodId: "missing",
            customName: "Mystery item",
            quantity: 1,
            unit: "unit",
            sortOrder: 0,
          },
        ],
      }),
    );
    jest
      .spyOn(api, "getRecipe")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "down", status: 500 }),
      );

    render(
      <Wrapper adapters={adapters}>
        <RecipeDetailContainer id="r1" />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(mockProbe.last?.ingredients).toEqual([
        { id: "i1", label: "Mystery item · 1 unit" },
      ]),
    );
  });

  it("uses the singular 'serving' label for a single-serving recipe", async () => {
    const { adapters, api, storage } = makeAdapters();
    storage.cacheRecipe(USER, buildRecipe({ servings: 1 }));
    jest
      .spyOn(api, "getRecipe")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "down", status: 500 }),
      );

    render(
      <Wrapper adapters={adapters}>
        <RecipeDetailContainer id="r1" />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(mockProbe.last?.secondaryLine).toBe("1 serving · My recipe"),
    );
  });

  it("falls back to the raw source label when it isn't 'manual' and there's no source URL", async () => {
    const { adapters, api, storage } = makeAdapters();
    storage.cacheRecipe(
      USER,
      buildRecipe({ source: "openfoodfacts", sourceUrl: null }),
    );
    jest
      .spyOn(api, "getRecipe")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "down", status: 500 }),
      );

    render(
      <Wrapper adapters={adapters}>
        <RecipeDetailContainer id="r1" />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(mockProbe.last?.secondaryLine).toBe("2 servings · openfoodfacts"),
    );
  });

  it("shows a hostname secondary line for an imported recipe", async () => {
    const { adapters, api, storage } = makeAdapters();
    storage.cacheRecipe(
      USER,
      buildRecipe({
        source: "web",
        sourceUrl: "https://www.bbcgoodfood.com/recipes/chicken-rice-bowl",
      }),
    );
    jest
      .spyOn(api, "getRecipe")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "down", status: 500 }),
      );

    render(
      <Wrapper adapters={adapters}>
        <RecipeDetailContainer id="r1" />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(mockProbe.last?.secondaryLine).toBe(
        "2 servings · bbcgoodfood.com",
      ),
    );
  });

  it("logs the recipe to today, notifies mutated, and routes back", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheRecipe(USER, buildRecipe());
    render(
      <Wrapper adapters={adapters}>
        <RecipeDetailContainer id="r1" />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.found).toBe(true));

    await act(async () => {
      mockProbe.last!.onLogToToday();
    });

    expect(
      storage.getCachedFuelToday(USER, localDayISO())?.entriesBySlot,
    ).toBeTruthy();
    const entries = Object.values(
      storage.getCachedFuelToday(USER, localDayISO())!.entriesBySlot,
    ).flat();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.recipeId).toBe("r1");
    expect(entries[0]?.servings).toBe(1);
    expect(Haptics.notificationAsync as jest.Mock).toHaveBeenCalled();
    expect(useFuelSheets.getState().rev).toBe(1);
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });

  it("Back routes back", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheRecipe(USER, buildRecipe());
    render(
      <Wrapper adapters={adapters}>
        <RecipeDetailContainer id="r1" />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.found).toBe(true));
    mockProbe.last!.onBack();
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });

  it("surfaces the error state when a recipe id doesn't resolve (no cache, fetch 404s)", async () => {
    const { adapters, api } = makeAdapters();
    jest.spyOn(api, "getRecipe").mockResolvedValue(
      fail({
        kind: "api",
        code: "not_found",
        message: "recipe_not_found",
        status: 404,
      }),
    );
    render(
      <Wrapper adapters={adapters}>
        <RecipeDetailContainer id="missing" />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.error).not.toBeNull());
    expect(mockProbe.last?.found).toBe(false);
  });

  it("onRetry re-fetches the recipe", async () => {
    const { adapters, api } = makeAdapters();
    const getSpy = jest
      .spyOn(api, "getRecipe")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "down", status: 500 }),
      );
    render(
      <Wrapper adapters={adapters}>
        <RecipeDetailContainer id="r1" />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.error).not.toBeNull());
    const callsBefore = getSpy.mock.calls.length;
    await act(async () => {
      mockProbe.last!.onRetry();
    });
    expect(getSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
