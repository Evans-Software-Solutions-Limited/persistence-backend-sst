import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Food } from "@/domain/models/nutrition";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  useCreateFood,
  useCreateMeal,
  useCreateRecipe,
  useDeleteEntry,
  useEditEntry,
  useGetFuelToday,
  useGetMeals,
  useGetNutritionEntries,
  useGetNutritionTarget,
  useGetRecipe,
  useGetRecipes,
  useGetWaterToday,
  useImportRecipeUrl,
  type ImportRecipeResult,
  useLogEntry,
  useResolveBarcode,
  useSearchFoods,
  useSetTargets,
  useSetWater,
} from "@/ui/hooks";
import { useNutritionAiGate } from "@/ui/hooks/useNutritionAiGate";

// useNutritionAiGate is a thin wrapper over useFeatureGate — mock that so we
// don't need the React-Query/subscription stack just to assert the wiring.
const gateSentinel = {
  allowed: false,
  reason: "tier" as const,
  gateProps: {} as never,
};
const mockUseFeatureGate = jest.fn((_feature: string) => gateSentinel);
jest.mock("@/ui/hooks/useFeatureGate", () => ({
  useFeatureGate: (feature: string) => mockUseFeatureGate(feature as never),
}));

const mockFetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: {} }),
}));
(globalThis as Record<string, unknown>).fetch = mockFetch;

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

const USER = "user-1";
const DATE = "2026-06-21";

function makeAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
  online = true,
): Adapters {
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: USER,
    email: "u@example.com",
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
  const netInfo = {
    isConnected: jest.fn(async () => online),
    // Synchronously push the desired connectivity so `useOnlineStatus`
    // settles deterministically on mount (no probe race).
    subscribe: jest.fn((cb: (c: boolean) => void) => {
      cb(online);
      return () => {};
    }),
  } as unknown as Adapters["netInfo"];
  return {
    api,
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
    netInfo,
  };
}

function wrap(adapters: Adapters) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

function setup(online = true) {
  const api = new InMemoryApiAdapter();
  api.profiles = [
    {
      id: USER,
      email: "u@example.com",
      fullName: "U",
      role: "user",
      fitnessLevel: null,
      avatarUrl: null,
      createdAt: "",
      updatedAt: "",
    },
  ];
  const storage = new InMemoryStorageAdapter();
  return { api, storage, wrapper: wrap(makeAdapters(api, storage, online)) };
}

const food: Food = {
  id: "f1",
  name: "Oats",
  brand: "Quaker",
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

beforeEach(() => {
  mockFetch.mockClear();
  mockUseFeatureGate.mockClear();
});

describe("read hooks (cache-first + refresh)", () => {
  it("useGetFuelToday fetches the day aggregate", async () => {
    const { api, wrapper } = setup();
    api.nutritionTarget = {
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
    };
    const { result } = renderHook(() => useGetFuelToday(DATE), { wrapper });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.data?.remainingKcal).toBe(2000);
    expect(result.current.isStale).toBe(false);
  });

  it("useGetFuelToday seeds from cache first (no flash)", async () => {
    const { storage, wrapper } = setup();
    storage.cacheFuelToday(USER, DATE, {
      date: DATE,
      targets: null,
      consumed: { kcal: 333, proteinG: 0, carbsG: 0, fatG: 0, waterCups: 0 },
      remainingKcal: 0,
      entriesBySlot: { breakfast: [], lunch: [], snack: [], dinner: [] },
    });
    const { result } = renderHook(() => useGetFuelToday(DATE), { wrapper });
    expect(result.current.data?.consumed.kcal).toBe(333); // synchronous cache read
    await waitFor(() => expect(result.current.isRefreshing).toBe(false));
  });

  it("useGetNutritionEntries derives a flat list from the aggregate", async () => {
    const { api, wrapper } = setup();
    await api.logEntry({
      foodId: undefined,
      mealSlot: "lunch",
      servings: 1,
      kcal: 100,
      proteinG: 1,
      carbsG: 1,
      fatG: 1,
      loggedAt: `${DATE}T12:00:00.000Z`,
    });
    const { result } = renderHook(() => useGetNutritionEntries(DATE), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data.length).toBe(1));
  });

  it("useGetWaterToday derives cups + goal", async () => {
    const { api, wrapper } = setup();
    api.nutritionTarget = {
      userId: USER,
      dailyKcal: 2000,
      proteinG: 1,
      carbsG: 1,
      fatG: 1,
      waterCups: 10,
      preset: "custom",
      setByUserId: null,
      setByName: null,
      updatedAt: null,
    };
    await api.setWater(DATE, 4);
    const { result } = renderHook(() => useGetWaterToday(DATE), { wrapper });
    await waitFor(() => expect(result.current.data?.cups).toBe(4));
    expect(result.current.data?.goal).toBe(10);
  });

  it("useGetNutritionTarget returns null when unset, then the target", async () => {
    const { api, wrapper } = setup();
    api.nutritionTarget = {
      userId: USER,
      dailyKcal: 1800,
      proteinG: 1,
      carbsG: 1,
      fatG: 1,
      waterCups: 8,
      preset: "cut",
      setByUserId: null,
      setByName: null,
      updatedAt: null,
    };
    const { result } = renderHook(() => useGetNutritionTarget(), { wrapper });
    await waitFor(() => expect(result.current.data?.dailyKcal).toBe(1800));
  });

  it("useGetRecipes + useGetRecipe", async () => {
    const { api, wrapper } = setup();
    const created = await api.createRecipe({
      name: "Bowl",
      servings: 2,
      ingredients: [],
    });
    const id = created.ok ? created.value.id : "";
    const list = renderHook(() => useGetRecipes(), { wrapper });
    await waitFor(() => expect(list.result.current.data?.length).toBe(1));
    const detail = renderHook(() => useGetRecipe(id), { wrapper });
    await waitFor(() => expect(detail.result.current.data?.name).toBe("Bowl"));
  });

  it("useGetMeals", async () => {
    const { api, wrapper } = setup();
    await api.createMeal({ name: "Combo", items: [] });
    const { result } = renderHook(() => useGetMeals(), { wrapper });
    await waitFor(() => expect(result.current.data?.length).toBe(1));
  });
});

describe("mutation hooks (optimistic cache + queue drain)", () => {
  it("useLogEntry recomputes the cached aggregate", async () => {
    const { storage, wrapper } = setup();
    const { result } = renderHook(() => useLogEntry(), { wrapper });
    await act(async () => {
      const entry = await result.current.mutate({
        mealSlot: "breakfast",
        servings: 1,
        kcal: 250,
        proteinG: 20,
        carbsG: 30,
        fatG: 5,
        loggedAt: `${DATE}T08:00:00.000Z`,
      });
      expect(entry?.kcal).toBe(250);
    });
    expect(storage.getCachedFuelToday(USER, DATE)?.consumed.kcal).toBe(250);
  });

  it("useEditEntry + useDeleteEntry update the cached day", async () => {
    const { storage, wrapper } = setup();
    const log = renderHook(() => useLogEntry(), { wrapper });
    let id = "";
    await act(async () => {
      const e = await log.result.current.mutate({
        mealSlot: "lunch",
        servings: 1,
        kcal: 100,
        proteinG: 1,
        carbsG: 1,
        fatG: 1,
        loggedAt: `${DATE}T12:00:00.000Z`,
      });
      id = e!.id;
    });

    const edit = renderHook(() => useEditEntry(), { wrapper });
    await act(async () => {
      await edit.result.current.mutate({
        id,
        date: DATE,
        input: { kcal: 500 },
      });
    });
    expect(storage.getCachedFuelToday(USER, DATE)?.consumed.kcal).toBe(500);

    const del = renderHook(() => useDeleteEntry(), { wrapper });
    await act(async () => {
      await del.result.current.mutate({ id, date: DATE });
    });
    expect(storage.getCachedFuelToday(USER, DATE)?.consumed.kcal).toBe(0);
  });

  it("useSetWater sets cups optimistically", async () => {
    const { storage, wrapper } = setup();
    const { result } = renderHook(() => useSetWater(), { wrapper });
    await act(async () => {
      await result.current.mutate({ date: DATE, cups: 5 });
    });
    expect(storage.getCachedFuelToday(USER, DATE)?.consumed.waterCups).toBe(5);
  });

  it("useSetTargets caches the target", async () => {
    const { storage, wrapper } = setup();
    const { result } = renderHook(() => useSetTargets(), { wrapper });
    await act(async () => {
      const t = await result.current.mutate(
        {
          dailyKcal: 2200,
          proteinG: 160,
          carbsG: 220,
          fatG: 70,
          waterCups: 9,
        },
        DATE,
      );
      expect(t?.dailyKcal).toBe(2200);
    });
    expect(storage.getCachedNutritionTarget(USER)?.dailyKcal).toBe(2200);
  });

  it("useCreateFood creates + caches a custom food", async () => {
    const { storage, wrapper } = setup();
    const { result } = renderHook(() => useCreateFood(), { wrapper });
    let created: Food | null = null;
    await act(async () => {
      created = await result.current.mutate({
        name: "My snack",
        kcal: 200,
        proteinG: 5,
        carbsG: 25,
        fatG: 8,
        servingSize: 50,
        servingUnit: "g",
      });
    });
    expect(created).not.toBeNull();
    expect(storage.getCachedFoodById(created!.id)?.name).toBe("My snack");
  });

  it("useCreateFood surfaces the error and returns null on failure", async () => {
    const { api, wrapper } = setup();
    api.shouldFail = true;
    const { result } = renderHook(() => useCreateFood(), { wrapper });
    let created: Food | null = "x" as unknown as Food;
    await act(async () => {
      created = await result.current.mutate({
        name: "x",
        kcal: 1,
        proteinG: 1,
        carbsG: 1,
        fatG: 1,
        servingSize: 1,
        servingUnit: "g",
      });
    });
    expect(created).toBeNull();
    expect(result.current.error).not.toBeNull();
  });

  it("useCreateRecipe inserts an optimistic recipe with provisional totals", async () => {
    const { storage, wrapper } = setup();
    storage.cacheFoods([food]);
    const { result } = renderHook(() => useCreateRecipe(), { wrapper });
    await act(async () => {
      const r = await result.current.mutate({
        name: "Oat bowl",
        servings: 1,
        ingredients: [
          { foodId: "f1", quantity: 2, unit: "serving", sortOrder: 0 },
        ],
      });
      expect(r?.totalKcal).toBe(300); // 150 × 2 provisional
    });
    expect(storage.getCachedRecipes(USER)).toHaveLength(1);
  });

  it("useCreateMeal inserts an optimistic meal with provisional totals", async () => {
    const { storage, wrapper } = setup();
    storage.cacheFoods([food]);
    const { result } = renderHook(() => useCreateMeal(), { wrapper });
    await act(async () => {
      const m = await result.current.mutate({
        name: "Combo",
        items: [{ foodId: "f1", servings: 2, sortOrder: 0 }],
      });
      expect(m?.totalKcal).toBe(300);
    });
    expect(storage.getCachedMeals(USER)).toHaveLength(1);
  });
});

describe("useSearchFoods", () => {
  it("returns server results for a query and caches them", async () => {
    const { api, storage, wrapper } = setup();
    api.foods = [food];
    const { result } = renderHook(() => useSearchFoods("oat"), { wrapper });
    await waitFor(() => expect(result.current.results.length).toBe(1));
    expect(storage.getCachedFoodById("f1")).not.toBeNull();
  });

  it("is empty for a short query (no fetch)", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useSearchFoods("o"), { wrapper });
    await waitFor(() => expect(result.current.isSearching).toBe(false));
    expect(result.current.results).toEqual([]);
  });

  it("is empty when offline", async () => {
    const { api, wrapper } = setup(false);
    api.foods = [food];
    const { result } = renderHook(() => useSearchFoods("oat"), { wrapper });
    await waitFor(() => expect(result.current.isSearching).toBe(false));
    expect(result.current.results).toEqual([]);
  });

  it("surfaces a server error", async () => {
    const { api, wrapper } = setup();
    api.shouldFail = true;
    const { result } = renderHook(() => useSearchFoods("oat"), { wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.results).toEqual([]);
  });
});

describe("useResolveBarcode", () => {
  it("returns a cached food without a network call", async () => {
    const { storage, wrapper } = setup();
    storage.cacheFoods([food]);
    const { result } = renderHook(() => useResolveBarcode(), { wrapper });
    let res;
    await act(async () => {
      res = await result.current.resolve("123");
    });
    expect(res).toEqual({ status: "found", food });
  });

  it("returns cache-miss-offline when offline + uncached", async () => {
    const { wrapper } = setup(false);
    const { result } = renderHook(() => useResolveBarcode(), { wrapper });
    let res;
    await act(async () => {
      res = await result.current.resolve("999");
    });
    expect(res).toEqual({ status: "cache-miss-offline" });
  });

  it("resolves online + caches the food", async () => {
    const { api, storage, wrapper } = setup();
    api.foods = [food];
    const { result } = renderHook(() => useResolveBarcode(), { wrapper });
    let res;
    await act(async () => {
      res = await result.current.resolve("123");
    });
    expect(res).toEqual({ status: "found", food });
    expect(storage.getCachedFoodByBarcode("123")).not.toBeNull();
  });

  it("maps 404 → not-found and 503 → service-unavailable", async () => {
    const { api, wrapper } = setup();
    const { result } = renderHook(() => useResolveBarcode(), { wrapper });
    api.nextBarcodeError = { status: 404, message: "barcode_not_found" };
    let res;
    await act(async () => {
      res = await result.current.resolve("404");
    });
    expect(res).toEqual({ status: "not-found" });

    api.nextBarcodeError = { status: 503, message: "food_db_unavailable" };
    await act(async () => {
      res = await result.current.resolve("503");
    });
    expect(res).toEqual({ status: "service-unavailable" });
  });
});

describe("useImportRecipeUrl", () => {
  it("returns the parsed pre-fill on success", async () => {
    const { api, wrapper } = setup();
    api.importedRecipe = {
      name: "Soup",
      servings: 4,
      instructions: "Boil",
      ingredients: ["water"],
      sourceUrl: "",
    };
    const { result } = renderHook(() => useImportRecipeUrl(), { wrapper });
    let res;
    await act(async () => {
      res = await result.current.mutate("https://x.test/soup");
    });
    expect(res).toEqual({
      status: "ok",
      recipe: expect.objectContaining({ name: "Soup" }),
    });
  });

  it("maps 422 → no-microdata", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useImportRecipeUrl(), { wrapper });
    let res;
    await act(async () => {
      res = await result.current.mutate("https://x.test/blank");
    });
    expect(res).toEqual({ status: "no-microdata" });
  });

  it("surfaces other errors", async () => {
    const { api, wrapper } = setup();
    api.shouldFail = true;
    const { result } = renderHook(() => useImportRecipeUrl(), { wrapper });
    let res: ImportRecipeResult | undefined;
    await act(async () => {
      res = await result.current.mutate("https://x.test/x");
    });
    expect(res?.status).toBe("error");
  });
});

describe("mutation hooks are no-ops when signed out", () => {
  function noUserWrapper() {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const auth = {
      getSession: jest.fn(async () => ok(null)),
      onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
        cb(null);
        return () => {};
      }),
      getAccessToken: jest.fn(async () => null),
    } as unknown as Adapters["auth"];
    const adapters = { ...makeAdapters(api, storage), auth };
    return { storage, wrapper: wrap(adapters) };
  }

  it("useLogEntry / useSetTargets return null and write nothing", async () => {
    const { storage, wrapper } = noUserWrapper();
    const log = renderHook(() => useLogEntry(), { wrapper });
    const targets = renderHook(() => useSetTargets(), { wrapper });
    await act(async () => {
      expect(
        await log.result.current.mutate({
          mealSlot: "breakfast",
          servings: 1,
          kcal: 1,
          proteinG: 1,
          carbsG: 1,
          fatG: 1,
          loggedAt: `${DATE}T08:00:00.000Z`,
        }),
      ).toBeNull();
      expect(
        await targets.result.current.mutate(
          { dailyKcal: 1, proteinG: 1, carbsG: 1, fatG: 1, waterCups: 1 },
          DATE,
        ),
      ).toBeNull();
    });
    expect(storage.getCachedFuelToday(USER, DATE)).toBeNull();
  });

  it("useEditEntry / useDeleteEntry / useSetWater / create hooks no-op", async () => {
    const { storage, wrapper } = noUserWrapper();
    const edit = renderHook(() => useEditEntry(), { wrapper });
    const del = renderHook(() => useDeleteEntry(), { wrapper });
    const water = renderHook(() => useSetWater(), { wrapper });
    const recipe = renderHook(() => useCreateRecipe(), { wrapper });
    const meal = renderHook(() => useCreateMeal(), { wrapper });
    await act(async () => {
      await edit.result.current.mutate({ id: "x", date: DATE, input: {} });
      await del.result.current.mutate({ id: "x", date: DATE });
      await water.result.current.mutate({ date: DATE, cups: 3 });
      expect(
        await recipe.result.current.mutate({
          name: "r",
          servings: 1,
          ingredients: [],
        }),
      ).toBeNull();
      expect(
        await meal.result.current.mutate({ name: "m", items: [] }),
      ).toBeNull();
    });
    expect(storage.getCachedFuelToday(USER, DATE)).toBeNull();
    expect(storage.getCachedRecipes(USER)).toHaveLength(0);
  });
});

describe("useNutritionAiGate", () => {
  it("delegates to the ai_workout feature gate (Tier-B placeholder)", () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useNutritionAiGate(), { wrapper });
    expect(mockUseFeatureGate).toHaveBeenCalledWith("ai_workout");
    expect(result.current.allowed).toBe(false);
  });
});
