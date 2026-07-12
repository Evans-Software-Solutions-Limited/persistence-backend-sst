import { act, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import * as Haptics from "expo-haptics";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Food, Meal } from "@/domain/models/nutrition";
import { fail, ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { localDayISO } from "@/shared/utils";
import { useFuelSheets } from "@/state/fuel-sheets";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { MealDetailPresenterProps } from "@/ui/presenters/MealDetailPresenter";
import { MealDetailContainer } from "../MealDetailContainer";

const mockProbe: { last: MealDetailPresenterProps | null } = { last: null };
jest.mock("@/ui/presenters/MealDetailPresenter", () => ({
  MealDetailPresenter: (props: MealDetailPresenterProps) => {
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

describe("MealDetailContainer", () => {
  beforeEach(() => {
    mockProbe.last = null;
    mockRouterBack.mockClear();
    jest.clearAllMocks();
    act(() =>
      useFuelSheets.setState({ sheet: null, slot: "breakfast", rev: 0 }),
    );
  });

  it("finds the meal in the cached list and renders its macros", async () => {
    const { adapters, api, storage } = makeAdapters();
    storage.cacheMeal(USER, buildMeal());
    jest
      .spyOn(api, "getMeals")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "down", status: 500 }),
      );

    render(
      <Wrapper adapters={adapters}>
        <MealDetailContainer id="m1" />
      </Wrapper>,
    );

    await waitFor(() => expect(mockProbe.last?.found).toBe(true));
    expect(mockProbe.last?.name).toBe("Standard breakfast");
    expect(mockProbe.last?.kcal).toBe(480);
    expect(mockProbe.last?.proteinG).toBe(30);
    expect(mockProbe.last?.itemsSummary).toBeNull();
  });

  it("resolves an item summary when the cached meal has item detail (e.g. freshly saved)", async () => {
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
        <MealDetailContainer id="m1" />
      </Wrapper>,
    );

    await waitFor(() => expect(mockProbe.last?.itemsSummary).toBe("Oats"));
  });

  it("resolves a recipe-referenced item and skips one that resolves to neither a food nor a recipe", async () => {
    const { adapters, api, storage } = makeAdapters();
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
    storage.cacheMeal(
      USER,
      buildMeal({
        items: [
          {
            id: "mi1",
            foodId: null,
            recipeId: "r1",
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
        <MealDetailContainer id="m1" />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(mockProbe.last?.itemsSummary).toBe("Protein oats"),
    );
  });

  it("logs the meal to today, notifies mutated, and routes back", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheMeal(USER, buildMeal());
    render(
      <Wrapper adapters={adapters}>
        <MealDetailContainer id="m1" />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.found).toBe(true));

    await act(async () => {
      mockProbe.last!.onLogToToday();
    });

    const entries = Object.values(
      storage.getCachedFuelToday(USER, localDayISO())!.entriesBySlot,
    ).flat();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.mealId).toBe("m1");
    expect(entries[0]?.servings).toBe(1);
    expect(Haptics.notificationAsync as jest.Mock).toHaveBeenCalled();
    expect(useFuelSheets.getState().rev).toBe(1);
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });

  it("Back routes back", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheMeal(USER, buildMeal());
    render(
      <Wrapper adapters={adapters}>
        <MealDetailContainer id="m1" />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.found).toBe(true));
    mockProbe.last!.onBack();
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });

  it("shows not-found once the list has loaded and no meal matches the id", async () => {
    const { adapters, api } = makeAdapters();
    jest.spyOn(api, "getMeals").mockResolvedValue(ok([]));
    render(
      <Wrapper adapters={adapters}>
        <MealDetailContainer id="missing" />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.isLoading).toBe(false));
    expect(mockProbe.last?.found).toBe(false);
    expect(mockProbe.last?.error).toBeNull();
  });

  it("shows the loading state on a cold cache before the meal list resolves", () => {
    const { adapters, api } = makeAdapters();
    // Never-resolving fetch keeps the read stale + refresh in flight, so the
    // meal isn't cached yet: the presenter must show loading, not "not found".
    jest.spyOn(api, "getMeals").mockReturnValue(new Promise(() => {}) as never);
    render(
      <Wrapper adapters={adapters}>
        <MealDetailContainer id="m1" />
      </Wrapper>,
    );
    expect(mockProbe.last?.isLoading).toBe(true);
    expect(mockProbe.last?.found).toBe(false);
  });

  it("onRetry re-fetches the meal list", async () => {
    const { adapters, api } = makeAdapters();
    const getSpy = jest
      .spyOn(api, "getMeals")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "down", status: 500 }),
      );
    render(
      <Wrapper adapters={adapters}>
        <MealDetailContainer id="m1" />
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
