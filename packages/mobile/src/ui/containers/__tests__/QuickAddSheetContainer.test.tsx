import { act, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import * as Haptics from "expo-haptics";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { localDayISO } from "@/shared/utils";
import type { Food, Meal } from "@/domain/models/nutrition";
import { useFuelSheets } from "@/state/fuel-sheets";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { QuickAddSheetProps } from "@/ui/presenters/QuickAddSheetPresenter";
import { QuickAddSheetContainer } from "../QuickAddSheetContainer";

const mockProbe: { last: QuickAddSheetProps | null } = { last: null };

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));
jest.mock("@/ui/presenters/QuickAddSheetPresenter", () => ({
  QuickAddSheetPresenter: (props: QuickAddSheetProps) => {
    mockProbe.last = props;
    return null;
  },
}));
jest.mock("@/ui/hooks/useNutritionAiGate", () => ({
  useNutritionAiGate: () => ({
    allowed: false,
    reason: "tier",
    gateProps: { onUpgrade: jest.fn() },
  }),
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
  barcode: "1",
  kcal: 300,
  proteinG: 10,
  carbsG: 50,
  fatG: 5,
  servingSize: 100,
  servingUnit: "g",
  source: "user",
  createdBy: USER,
};
const meal: Meal = {
  id: "m1",
  userId: USER,
  name: "Standard breakfast",
  photoUrl: null,
  totalKcal: 480,
  totalProteinG: 30,
  totalCarbsG: 50,
  totalFatG: 12,
  items: [],
};

function makeAdapters() {
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
        subscribe: () => () => {},
      } as unknown as Adapters["netInfo"],
    } as Adapters,
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

describe("QuickAddSheetContainer", () => {
  beforeEach(() => {
    mockProbe.last = null;
    jest.clearAllMocks();
    act(() =>
      useFuelSheets.setState({ sheet: null, slot: "breakfast", rev: 0 }),
    );
  });

  it("is hidden until opened, then shows the menu for the slot", () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheMeals(USER, [meal]);
    render(
      <Wrapper adapters={adapters}>
        <QuickAddSheetContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.visible).toBe(false);
    act(() => useFuelSheets.getState().openQuickAdd("lunch"));
    expect(mockProbe.last?.visible).toBe(true);
    expect(mockProbe.last?.mealLabel).toBe("Lunch");
    expect(mockProbe.last?.stage).toBe("menu");
    expect(mockProbe.last?.aiLocked).toBe(true);
  });

  it("surfaces saved meals and logs one on tap", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheMeals(USER, [meal]);
    render(
      <Wrapper adapters={adapters}>
        <QuickAddSheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openQuickAdd("dinner"));
    await waitFor(() =>
      expect(mockProbe.last?.savedMeals.some((m) => m.id === "m1")).toBe(true),
    );

    await act(async () => {
      mockProbe.last!.onLogMeal("m1");
    });
    expect(
      storage.getCachedFuelToday(USER, localDayISO())?.entriesBySlot.dinner
        .length,
    ).toBe(1);
    expect(Haptics.notificationAsync as jest.Mock).toHaveBeenCalled();
    expect(useFuelSheets.getState().sheet).toBeNull();
  });

  it("opens the search stage, selects a food, and logs it", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFoods([food]);
    render(
      <Wrapper adapters={adapters}>
        <QuickAddSheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openQuickAdd("snack"));
    act(() => mockProbe.last!.onSearch());
    expect(mockProbe.last?.stage).toBe("search");

    act(() => mockProbe.last!.onSelect(food));
    await waitFor(() => expect(mockProbe.last?.selected?.id).toBe("f1"));

    await act(async () => {
      mockProbe.last!.onAdd();
    });
    expect(
      storage.getCachedFuelToday(USER, localDayISO())?.entriesBySlot.snack
        .length,
    ).toBe(1);
    expect(useFuelSheets.getState().rev).toBe(1);
  });

  it("hands off to the scan sheet", () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheMeals(USER, [meal]);
    render(
      <Wrapper adapters={adapters}>
        <QuickAddSheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openQuickAdd("breakfast"));
    act(() => mockProbe.last!.onScan());
    expect(useFuelSheets.getState().sheet).toBe("scan");
  });

  it("re-logs yesterday's entries for the slot", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFoods([food]);
    const y = new Date(`${localDayISO()}T00:00:00.000Z`);
    y.setUTCDate(y.getUTCDate() - 1);
    const yIso = y.toISOString().slice(0, 10);
    storage.cacheFuelToday(USER, yIso, {
      date: yIso,
      targets: null,
      consumed: { kcal: 300, proteinG: 10, carbsG: 50, fatG: 5, waterCups: 0 },
      remainingKcal: 0,
      entriesBySlot: {
        breakfast: [
          {
            id: "y1",
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
            loggedAt: `${yIso}T08:00:00.000Z`,
            loggedByUserId: null,
            aiEstimated: false,
            aiConfidence: null,
          },
        ],
        lunch: [],
        snack: [],
        dinner: [],
      },
    });
    render(
      <Wrapper adapters={adapters}>
        <QuickAddSheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openQuickAdd("breakfast"));
    await waitFor(() =>
      expect(mockProbe.last?.yesterday?.items.length).toBe(1),
    );

    await act(async () => {
      mockProbe.last!.onLogYesterday();
    });
    expect(
      storage.getCachedFuelToday(USER, localDayISO())?.entriesBySlot.breakfast
        .length,
    ).toBe(1);
    expect(useFuelSheets.getState().sheet).toBeNull();
  });

  it("toggles between search and menu and clears a selection", () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheMeals(USER, [meal]);
    render(
      <Wrapper adapters={adapters}>
        <QuickAddSheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openQuickAdd("lunch"));
    act(() => mockProbe.last!.onManual());
    expect(mockProbe.last?.stage).toBe("search");
    act(() => mockProbe.last!.onSelect(food));
    act(() => mockProbe.last!.onClearSelection());
    expect(mockProbe.last?.selected).toBeNull();
    act(() => mockProbe.last!.onBackToMenu());
    expect(mockProbe.last?.stage).toBe("menu");
    act(() => mockProbe.last!.onSnap());
  });
});
