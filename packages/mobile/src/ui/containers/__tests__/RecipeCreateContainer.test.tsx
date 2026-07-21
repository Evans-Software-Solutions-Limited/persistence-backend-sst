import { act, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Food } from "@/domain/models/nutrition";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { useRecipeDraft } from "@/state/recipe-draft";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { RecipeCreatePresenterProps } from "@/ui/presenters/RecipeCreatePresenter";
import { RecipeCreateContainer } from "../RecipeCreateContainer";

const mockProbe: { last: RecipeCreatePresenterProps | null } = { last: null };
jest.mock("@/ui/presenters/RecipeCreatePresenter", () => ({
  RecipeCreatePresenter: (props: RecipeCreatePresenterProps) => {
    mockProbe.last = props;
    return null;
  },
}));

const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: {
    back: (...args: unknown[]) => mockRouterBack(...args),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
  },
}));

const mockAiGate: { allowed: boolean; onUpgrade: jest.Mock } = {
  allowed: true,
  onUpgrade: jest.fn(),
};
jest.mock("@/ui/hooks/useNutritionAiGate", () => ({
  useNutritionAiGate: () => ({
    allowed: mockAiGate.allowed,
    reason: "tier",
    gateProps: { onUpgrade: mockAiGate.onUpgrade },
  }),
}));

(globalThis as Record<string, unknown>).fetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: {} }),
}));
jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

const USER = "user-1";

const chicken: Food = {
  id: "f-chicken",
  name: "Chicken breast",
  brand: null,
  barcode: null,
  kcal: 165,
  proteinG: 31,
  carbsG: 0,
  fatG: 3.6,
  servingSize: 100,
  servingUnit: "g",
  servingQuantity: null,
  source: "openfoodfacts",
  createdBy: null,
};

function makeAdapters(): {
  adapters: Adapters;
  api: InMemoryApiAdapter;
  storage: InMemoryStorageAdapter;
} {
  const api = new InMemoryApiAdapter();
  api.foods = [chicken];
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
      netInfo: {
        isConnected: async () => true,
        subscribe: (cb: (c: boolean) => void) => {
          cb(true);
          return () => {};
        },
      } as unknown as Adapters["netInfo"],
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

describe("RecipeCreateContainer", () => {
  beforeEach(() => {
    mockProbe.last = null;
    mockRouterBack.mockClear();
    mockRouterReplace.mockClear();
    mockAiGate.allowed = true;
    mockAiGate.onUpgrade.mockClear();
    useRecipeDraft.getState().clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("starts blank with one empty row when there is no seed", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.name).toBe("");
    expect(mockProbe.last?.rows).toHaveLength(1);
    expect(mockProbe.last?.rows[0]).toEqual(
      expect.objectContaining({ name: "", foodId: null }),
    );
  });

  it("prefills from the recipe-draft seed on mount, then clears the store", () => {
    useRecipeDraft.getState().setSeed({
      title: "Chicken & rice bowl",
      servings: 2,
      instructions: "Cook it.",
      ingredients: [
        { name: "Chicken breast", quantity: 300, unit: "g" },
        { name: "Jasmine rice", quantity: 200, unit: "g" },
      ],
      source: "import",
    });
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.name).toBe("Chicken & rice bowl");
    expect(mockProbe.last?.servings).toBe(2);
    expect(mockProbe.last?.instructions).toBe("Cook it.");
    expect(mockProbe.last?.rows).toHaveLength(2);
    expect(mockProbe.last?.rows[0]).toEqual(
      expect.objectContaining({
        name: "Chicken breast",
        quantity: 300,
        unit: "g",
      }),
    );
    expect(useRecipeDraft.getState().seed).toBeNull();
  });

  it("onAddRow appends an empty row; onRemoveRow removes by id", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onAddRow());
    expect(mockProbe.last?.rows).toHaveLength(2);
    const secondId = mockProbe.last!.rows[1].id;
    act(() => mockProbe.last!.onRemoveRow(secondId));
    expect(mockProbe.last?.rows).toHaveLength(1);
  });

  it("onChangeRowName unlinks a previously linked row", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    const id = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onLinkFood(id, chicken));
    expect(mockProbe.last?.rows[0].foodId).toBe("f-chicken");

    act(() => mockProbe.last!.onChangeRowName(id, "something else"));
    expect(mockProbe.last?.rows[0].foodId).toBeNull();
    expect(mockProbe.last?.rows[0].name).toBe("something else");
  });

  it("onOpenRowSearch activates the row and prefills the query from its name", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    const id = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onChangeRowName(id, "chick"));
    act(() => mockProbe.last!.onOpenRowSearch(id));
    expect(mockProbe.last?.activeSearchRowId).toBe(id);
    expect(mockProbe.last?.searchQuery).toBe("chick");
  });

  it("surfaces matching search results and links a food on selection", async () => {
    jest.useFakeTimers();
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    const id = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onOpenRowSearch(id));
    act(() => mockProbe.last!.onSearchQueryChange("chick"));
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    jest.useRealTimers();
    await waitFor(() =>
      expect(mockProbe.last?.searchResults).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "f-chicken" })]),
      ),
    );

    act(() => mockProbe.last!.onLinkFood(id, chicken));
    expect(mockProbe.last?.rows[0]).toEqual(
      expect.objectContaining({
        foodId: "f-chicken",
        foodName: "Chicken breast",
      }),
    );
    expect(mockProbe.last?.activeSearchRowId).toBeNull();
  });

  it("closes the search box via onCloseRowSearch", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    const id = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onOpenRowSearch(id));
    act(() => mockProbe.last!.onCloseRowSearch());
    expect(mockProbe.last?.activeSearchRowId).toBeNull();
  });

  it("onCreateWithAi routes to the upgrade prompt when the AI gate denies", async () => {
    mockAiGate.allowed = false;
    const { adapters, api } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    const id = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onChangeRowName(id, "Obscure thing"));
    await act(async () => {
      mockProbe.last!.onCreateWithAi(id);
    });
    expect(mockAiGate.onUpgrade).toHaveBeenCalledTimes(1);
    expect(api.resolveIngredientCalls).toHaveLength(0);
  });

  it("onCreateWithAi resolves and links the row on success, caching the food", async () => {
    const { adapters, storage } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    const id = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onChangeRowName(id, "Obscure thing"));
    await act(async () => {
      mockProbe.last!.onCreateWithAi(id);
    });
    await waitFor(() => expect(mockProbe.last?.rows[0].foodId).not.toBeNull());
    const foodId = mockProbe.last!.rows[0].foodId!;
    expect(storage.getCachedFoodById(foodId)).not.toBeNull();
  });

  it("onCreateWithAi surfaces the daily-limit message on 429", async () => {
    const { adapters, api } = makeAdapters();
    api.nextRecipeAiError = { status: 429, message: "ai_daily_limit" };
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    const id = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onChangeRowName(id, "Obscure thing"));
    await act(async () => {
      mockProbe.last!.onCreateWithAi(id);
    });
    await waitFor(() =>
      expect(mockProbe.last?.rowMessages[id]).toMatch(/Daily AI limit/),
    );

    // Retrying successfully must clear the stale message for this row.
    api.nextRecipeAiError = null;
    await act(async () => {
      mockProbe.last!.onCreateWithAi(id);
    });
    await waitFor(() => expect(mockProbe.last?.rows[0].foodId).not.toBeNull());
    expect(mockProbe.last?.rowMessages[id]).toBeUndefined();
  });

  it("live macro total reflects a linked row's food scaled by quantity", () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFoods([chicken]);
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    const id = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onLinkFood(id, chicken));
    act(() => mockProbe.last!.onChangeRowQuantity(id, 200));
    // 200g of a per-100g food → doubled.
    expect(mockProbe.last?.macroTotal.kcal).toBe(330);
    expect(mockProbe.last?.macroTotal.proteinG).toBe(62);
  });

  it("divides the displayed live macro total by servings once set", () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFoods([chicken]);
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    const id = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onLinkFood(id, chicken));
    act(() => mockProbe.last!.onChangeRowQuantity(id, 200));
    // 200g of a per-100g food → 330 kcal whole-recipe.
    act(() => mockProbe.last!.onServingsChange(3));
    expect(mockProbe.last?.macroTotal.kcal).toBe(110); // 330 / 3, rounded
    expect(mockProbe.last?.macroTotal.proteinG).toBe(21); // 62 / 3, rounded
  });

  it("guards a zero/null servings value in the displayed macro total (whole total unchanged)", () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFoods([chicken]);
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    const id = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onLinkFood(id, chicken));
    act(() => mockProbe.last!.onChangeRowQuantity(id, 200));
    act(() => mockProbe.last!.onServingsChange(0));
    expect(mockProbe.last?.macroTotal.kcal).toBe(330);
    act(() => mockProbe.last!.onServingsChange(null));
    expect(mockProbe.last?.macroTotal.kcal).toBe(330);
  });

  it("canSave is false with no name, true once a name + a named/linked row exist", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.canSave).toBe(false);
    const id = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onChangeRowName(id, "Rice"));
    expect(mockProbe.last?.canSave).toBe(false); // name still empty
    act(() => mockProbe.last!.onNameChange("My recipe"));
    expect(mockProbe.last?.canSave).toBe(true);
  });

  it("onSave builds foodId ingredients for linked rows and customName for unlinked rows, then navigates", async () => {
    const { adapters, storage } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onNameChange("Bowl"));
    const firstId = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onLinkFood(firstId, chicken));
    act(() => mockProbe.last!.onChangeRowQuantity(firstId, 150));
    act(() => mockProbe.last!.onAddRow());
    const secondId = mockProbe.last!.rows[1].id;
    act(() => mockProbe.last!.onChangeRowName(secondId, "Soy sauce"));
    act(() => mockProbe.last!.onChangeRowQuantity(secondId, 2));
    act(() => mockProbe.last!.onChangeRowUnit(secondId, "tbsp"));

    await act(async () => {
      mockProbe.last!.onSave();
    });

    // onSave is optimistic: the recipe is written straight to the local
    // cache (`createRecipeCommand`), not through `api.createRecipe` — the
    // sync queue flush is what eventually POSTs it.
    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalled());
    const routedTo = String(mockRouterReplace.mock.calls[0]![0]);
    const recipeId = routedTo.split("/").pop()!;
    const saved = storage.getCachedRecipe(USER, recipeId);
    expect(saved?.ingredients).toEqual([
      expect.objectContaining({ foodId: "f-chicken", quantity: 150 }),
      expect.objectContaining({
        customName: "Soy sauce",
        quantity: 2,
        unit: "tbsp",
      }),
    ]);
  });

  it("onSave is a no-op when canSave is false", async () => {
    const { adapters, storage } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    await act(async () => {
      mockProbe.last!.onSave();
    });
    expect(storage.getCachedRecipes(USER)).toHaveLength(0);
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it("onSave defaults a row's quantity to 1 and omits blank instructions", async () => {
    const { adapters, storage } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onNameChange("Bowl"));
    const id = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onChangeRowName(id, "Salt")); // unlinked, quantity stays null

    await act(async () => {
      mockProbe.last!.onSave();
    });
    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalled());
    const recipeId = String(mockRouterReplace.mock.calls[0]![0])
      .split("/")
      .pop()!;
    const saved = storage.getCachedRecipe(USER, recipeId);
    expect(saved?.ingredients).toEqual([
      expect.objectContaining({ customName: "Salt", quantity: 1 }),
    ]);
    expect(saved?.instructions).toBeNull();
  });

  it("row edits, links, and AI-resolves only affect the targeted row", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    const firstId = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onAddRow());
    const secondId = mockProbe.last!.rows[1].id;

    act(() => mockProbe.last!.onChangeRowName(secondId, "Rice"));
    act(() => mockProbe.last!.onChangeRowQuantity(secondId, 50));
    act(() => mockProbe.last!.onChangeRowUnit(secondId, "g"));
    act(() => mockProbe.last!.onLinkFood(secondId, chicken));

    const first = mockProbe.last!.rows.find((r) => r.id === firstId)!;
    expect(first).toEqual(
      expect.objectContaining({
        name: "",
        quantity: null,
        unit: "",
        foodId: null,
      }),
    );

    await act(async () => {
      mockProbe.last!.onCreateWithAi(secondId);
    });
    await waitFor(() =>
      expect(
        mockProbe.last!.rows.find((r) => r.id === secondId)!.foodId,
      ).not.toBeNull(),
    );
    expect(
      mockProbe.last!.rows.find((r) => r.id === firstId)!.foodId,
    ).toBeNull();
  });

  it("onOpenRowSearch defaults the query to empty when the row can't be found", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onOpenRowSearch("no-such-row"));
    expect(mockProbe.last?.activeSearchRowId).toBe("no-such-row");
    expect(mockProbe.last?.searchQuery).toBe("");
  });

  it("onRemoveRow clears the active search when removing the row being searched", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    const id = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onOpenRowSearch(id));
    expect(mockProbe.last?.activeSearchRowId).toBe(id);
    act(() => mockProbe.last!.onRemoveRow(id));
    expect(mockProbe.last?.activeSearchRowId).toBeNull();
  });

  it("prefills a seed ingredient's blank unit as an empty string", () => {
    useRecipeDraft.getState().setSeed({
      title: "Soup",
      servings: null,
      instructions: null,
      ingredients: [{ name: "Water", quantity: null, unit: null }],
      source: "import",
    });
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.rows[0]).toEqual(
      expect.objectContaining({ name: "Water", unit: "" }),
    );
  });

  it("onCreateWithAi is a no-op when the row id can't be found", async () => {
    const { adapters, api } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    await act(async () => {
      mockProbe.last!.onCreateWithAi("missing-row");
    });
    expect(api.resolveIngredientCalls).toHaveLength(0);
  });

  it("onCreateWithAi is a no-op when both the row name and the search query are blank", async () => {
    const { adapters, api } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    const id = mockProbe.last!.rows[0].id;
    await act(async () => {
      mockProbe.last!.onCreateWithAi(id);
    });
    expect(api.resolveIngredientCalls).toHaveLength(0);
  });

  it("onCreateWithAi falls back to the open search query when the row name is blank", async () => {
    const { adapters, api } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    const id = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onOpenRowSearch(id));
    act(() => mockProbe.last!.onSearchQueryChange("chicken"));
    await act(async () => {
      mockProbe.last!.onCreateWithAi(id);
    });
    await waitFor(() =>
      expect(api.resolveIngredientCalls).toEqual([{ name: "chicken" }]),
    );
  });

  it("onCreateWithAi surfaces the generic message on a non-429 failure", async () => {
    const { adapters, api } = makeAdapters();
    api.nextRecipeAiError = { status: 500, message: "server_error" };
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    const id = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onChangeRowName(id, "Obscure thing"));
    await act(async () => {
      mockProbe.last!.onCreateWithAi(id);
    });
    await waitFor(() => expect(mockProbe.last?.rowMessages[id]).toBeTruthy());
    expect(mockProbe.last?.rowMessages[id]).not.toMatch(/Daily AI limit/);
  });

  it("Back routes back", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onBack());
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });

  it("onLinkFood defaults a blank quantity/unit from the linked food's own serving", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    const id = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onLinkFood(id, chicken));
    expect(mockProbe.last?.rows[0]).toEqual(
      expect.objectContaining({ quantity: 100, unit: "g" }),
    );
  });

  it("onLinkFood does not override an already-set quantity/unit", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    const id = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onChangeRowQuantity(id, 50));
    act(() => mockProbe.last!.onChangeRowUnit(id, "tbsp"));
    act(() => mockProbe.last!.onLinkFood(id, chicken));
    expect(mockProbe.last?.rows[0]).toEqual(
      expect.objectContaining({ quantity: 50, unit: "tbsp" }),
    );
  });

  it("seeds providedTotals from an import seed's per-serving nutrition × servings, displayed back per-serving", () => {
    useRecipeDraft.getState().setSeed({
      title: "Soup",
      servings: 4,
      instructions: null,
      ingredients: [{ name: "Water", quantity: null, unit: null }],
      source: "import",
      nutrition: { kcal: 100, proteinG: 5, carbsG: 10, fatG: 2 },
      sourceUrl: "https://x.test/soup",
    });
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    // The seed's per-serving nutrition (100/5/10/2) is scaled ×4 servings into
    // `providedTotals` (whole-recipe, sent on save unchanged) — the DISPLAYED
    // pill total divides that back down by servings, landing back on the
    // original per-serving figures.
    expect(mockProbe.last?.macroTotal).toEqual({
      kcal: 100,
      proteinG: 5,
      carbsG: 10,
      fatG: 2,
    });
    expect(mockProbe.last?.macrosProvided).toBe(true);
  });

  it("an import seed without nutrition leaves providedTotals null but still routes source=url_import on save", async () => {
    useRecipeDraft.getState().setSeed({
      title: "Soup",
      servings: null,
      instructions: null,
      ingredients: [{ name: "Water", quantity: null, unit: null }],
      source: "import",
      nutrition: null,
      sourceUrl: "https://x.test/soup",
    });
    const { adapters, storage } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.macrosProvided).toBe(false);

    await act(async () => {
      mockProbe.last!.onSave();
    });
    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalled());
    const recipeId = String(mockRouterReplace.mock.calls[0]![0])
      .split("/")
      .pop()!;
    const saved = storage.getCachedRecipe(USER, recipeId);
    expect(saved?.source).toBe("url_import");
    expect(saved?.sourceUrl).toBe("https://x.test/soup");
  });

  it("linking a food after an import seed clears providedTotals (back to ingredient-derived)", () => {
    useRecipeDraft.getState().setSeed({
      title: "Soup",
      servings: 2,
      instructions: null,
      ingredients: [{ name: "Chicken breast", quantity: null, unit: null }],
      source: "import",
      nutrition: { kcal: 100, proteinG: 5, carbsG: 10, fatG: 2 },
      sourceUrl: "https://x.test/soup",
    });
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.macrosProvided).toBe(true);
    const id = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onLinkFood(id, chicken));
    expect(mockProbe.last?.macrosProvided).toBe(false);
  });

  it("onEstimateWholeRecipe routes to the upgrade prompt when the AI gate denies", async () => {
    mockAiGate.allowed = false;
    const { adapters, api } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    await act(async () => {
      mockProbe.last!.onEstimateWholeRecipe();
    });
    expect(mockAiGate.onUpgrade).toHaveBeenCalledTimes(1);
    expect(api.estimateRecipeCalls).toHaveLength(0);
  });

  it("onEstimateWholeRecipe sets the macro total from the AI estimate on success", async () => {
    const { adapters, api } = makeAdapters();
    api.estimatedRecipeMacros = {
      kcal: 620,
      proteinG: 40,
      carbsG: 55,
      fatG: 22,
      confidence: 0.8,
    };
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onNameChange("Bowl"));
    const id = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onChangeRowName(id, "Chicken breast"));
    await act(async () => {
      mockProbe.last!.onEstimateWholeRecipe();
    });
    await waitFor(() =>
      expect(mockProbe.last?.macroTotal).toEqual({
        kcal: 620,
        proteinG: 40,
        carbsG: 55,
        fatG: 22,
      }),
    );
    expect(mockProbe.last?.macrosProvided).toBe(true);
    expect(api.estimateRecipeCalls).toEqual([
      { name: "Bowl", ingredients: ["Chicken breast"], servings: undefined },
    ]);
  });

  it("onEstimateWholeRecipe includes a row's structured quantity in the ingredient line", async () => {
    const { adapters, api } = makeAdapters();
    api.estimatedRecipeMacros = {
      kcal: 100,
      proteinG: 5,
      carbsG: 10,
      fatG: 2,
      confidence: 0.6,
    };
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onNameChange("Bowl"));
    const id = mockProbe.last!.rows[0].id;
    act(() => mockProbe.last!.onChangeRowName(id, "Chicken breast"));
    act(() => mockProbe.last!.onChangeRowQuantity(id, 200));
    await act(async () => {
      mockProbe.last!.onEstimateWholeRecipe();
    });
    expect(api.estimateRecipeCalls).toEqual([
      {
        name: "Bowl",
        ingredients: ["200 Chicken breast"],
        servings: undefined,
      },
    ]);
  });

  it("onEstimateWholeRecipe surfaces the daily-limit message on 429", async () => {
    const { adapters, api } = makeAdapters();
    api.nextRecipeAiError = { status: 429, message: "ai_daily_limit" };
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onNameChange("Bowl"));
    await act(async () => {
      mockProbe.last!.onEstimateWholeRecipe();
    });
    await waitFor(() =>
      expect(mockProbe.last?.estimateRecipeMessage).toMatch(/Daily AI limit/),
    );
    expect(mockProbe.last?.macrosProvided).toBe(false);
  });

  it("onSave includes source/sourceUrl/providedTotals in the enqueued POST body for an import seed", async () => {
    useRecipeDraft.getState().setSeed({
      title: "Soup",
      servings: 4,
      instructions: null,
      ingredients: [{ name: "Water", quantity: null, unit: null }],
      source: "import",
      nutrition: { kcal: 100, proteinG: 5, carbsG: 10, fatG: 2 },
      sourceUrl: "https://x.test/soup",
    });
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    await act(async () => {
      mockProbe.last!.onSave();
    });
    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalled());
    // The optimistic write flushes synchronously inside `onSave` (`useCreateRecipe`
    // awaits `processSyncQueue` before returning) — by the time we assert, the
    // mutation has already been marked `completed` and dropped from
    // `getPendingMutations()`, so assert on the actual POST body instead.
    const fetchMock = (globalThis as unknown as { fetch: jest.Mock }).fetch;
    const recipePosts = fetchMock.mock.calls.filter(([url]: [string]) =>
      url.endsWith("/recipes"),
    );
    // The mock isn't cleared between `it` blocks in this file — take the most
    // recent /recipes POST (this test's own), not the first ever recorded.
    const recipePost = recipePosts[recipePosts.length - 1];
    expect(recipePost).toBeDefined();
    const body = JSON.parse(recipePost[1].body as string);
    expect(body).toEqual(
      expect.objectContaining({
        source: "url_import",
        sourceUrl: "https://x.test/soup",
        providedTotals: { kcal: 400, proteinG: 20, carbsG: 40, fatG: 8 },
      }),
    );
  });

  it("a snap-photo seed saves with source=ai_extracted", async () => {
    useRecipeDraft.getState().setSeed({
      title: "Traybake",
      servings: 2,
      instructions: null,
      ingredients: [{ name: "Chicken", quantity: null, unit: null }],
      source: "snap",
    });
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeCreateContainer />
      </Wrapper>,
    );
    await act(async () => {
      mockProbe.last!.onSave();
    });
    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalled());
    const fetchMock = (globalThis as unknown as { fetch: jest.Mock }).fetch;
    const recipePosts = fetchMock.mock.calls.filter(([url]: [string]) =>
      url.endsWith("/recipes"),
    );
    const body = JSON.parse(
      recipePosts[recipePosts.length - 1][1].body as string,
    );
    expect(body.source).toBe("ai_extracted");
  });
});
