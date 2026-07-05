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
const mockAiGate: {
  allowed: boolean;
  onUpgrade: jest.Mock;
} = { allowed: false, onUpgrade: jest.fn() };
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
    mockAiGate.allowed = false;
    mockAiGate.onUpgrade = jest.fn();
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

  it("resolves yesterday's recipe/meal-referenced entries via the name lookups", async () => {
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
    storage.cacheMeal(USER, meal);
    const y = new Date(`${localDayISO()}T00:00:00.000Z`);
    y.setUTCDate(y.getUTCDate() - 1);
    const yIso = y.toISOString().slice(0, 10);
    storage.cacheFuelToday(USER, yIso, {
      date: yIso,
      targets: null,
      consumed: {
        kcal: 900,
        proteinG: 62,
        carbsG: 108,
        fatG: 20,
        waterCups: 0,
      },
      remainingKcal: 0,
      entriesBySlot: {
        breakfast: [
          {
            id: "y-recipe",
            userId: USER,
            foodId: null,
            recipeId: "r1",
            mealId: null,
            mealSlot: "breakfast",
            servings: 1,
            kcal: 420,
            proteinG: 32,
            carbsG: 58,
            fatG: 8,
            loggedAt: `${yIso}T08:00:00.000Z`,
            loggedByUserId: null,
            aiEstimated: false,
            aiConfidence: null,
          },
          {
            id: "y-meal",
            userId: USER,
            foodId: null,
            recipeId: null,
            mealId: "m1",
            mealSlot: "breakfast",
            servings: 1,
            kcal: 480,
            proteinG: 30,
            carbsG: 50,
            fatG: 12,
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
      expect(mockProbe.last?.yesterday?.items).toEqual([
        "Protein oats",
        "Standard breakfast",
      ]),
    );
  });

  it("onClose is a no-op when the sheet is already hidden (handoff guard)", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <QuickAddSheetContainer />
      </Wrapper>,
    );
    // Never opened — `visible` is false. Calling onClose should not attempt
    // to clear a store slot another sheet might have just claimed.
    act(() => mockProbe.last!.onClose());
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

  it("onSnap routes to the upgrade prompt when the AI gate denies", () => {
    const { adapters } = makeAdapters();
    mockAiGate.allowed = false;
    render(
      <Wrapper adapters={adapters}>
        <QuickAddSheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openQuickAdd("lunch"));
    act(() => mockProbe.last!.onSnap());
    expect(mockAiGate.onUpgrade).toHaveBeenCalled();
    expect(useFuelSheets.getState().sheet).toBe("quickAdd");
  });

  it("onSnap hands off to the snap sheet when the AI gate allows and online", () => {
    const { adapters } = makeAdapters();
    mockAiGate.allowed = true;
    render(
      <Wrapper adapters={adapters}>
        <QuickAddSheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openQuickAdd("lunch"));
    act(() => mockProbe.last!.onSnap());
    expect(useFuelSheets.getState().sheet).toBe("snap");
    expect(useFuelSheets.getState().slot).toBe("lunch");
    expect(mockAiGate.onUpgrade).not.toHaveBeenCalled();
  });

  it("onSnap does nothing when offline, even if the AI gate allows", () => {
    const { adapters } = makeAdapters();
    mockAiGate.allowed = true;
    (adapters as { netInfo: unknown }).netInfo = {
      isConnected: async () => false,
      subscribe: (cb: (c: boolean) => void) => {
        cb(false);
        return () => {};
      },
    };
    render(
      <Wrapper adapters={adapters}>
        <QuickAddSheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openQuickAdd("lunch"));
    act(() => mockProbe.last!.onSnap());
    expect(useFuelSheets.getState().sheet).toBe("quickAdd");
    expect(mockAiGate.onUpgrade).not.toHaveBeenCalled();
  });

  it("passes aiOffline=true to the presenter when offline", async () => {
    const { adapters } = makeAdapters();
    (adapters as { netInfo: unknown }).netInfo = {
      isConnected: async () => false,
      subscribe: (cb: (c: boolean) => void) => {
        cb(false);
        return () => {};
      },
    };
    render(
      <Wrapper adapters={adapters}>
        <QuickAddSheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openQuickAdd("lunch"));
    await waitFor(() => expect(mockProbe.last?.aiOffline).toBe(true));
  });

  describe("free-text (Or describe it…) flow", () => {
    beforeEach(() => {
      mockAiGate.allowed = true;
    });

    it("routes onDescribe to the describe stage", () => {
      const { adapters } = makeAdapters();
      render(
        <Wrapper adapters={adapters}>
          <QuickAddSheetContainer />
        </Wrapper>,
      );
      act(() => useFuelSheets.getState().openQuickAdd("breakfast"));
      act(() => mockProbe.last!.onDescribe());
      expect(mockProbe.last?.stage).toBe("describe");
    });

    it("submits a description, gets a draft, and confirms N entries", async () => {
      const { adapters, storage } = makeAdapters();
      const api = adapters.api as InMemoryApiAdapter;
      api.aiEstimate = {
        foods: [
          {
            name: "Two eggs",
            quantity: 2,
            unit: "egg",
            estimatedGrams: 100,
            kcal: 140,
            proteinG: 12,
            carbsG: 1,
            fatG: 10,
            confidence: 0.9,
          },
          {
            name: "Toast",
            quantity: 1,
            unit: "slice",
            estimatedGrams: 30,
            kcal: 80,
            proteinG: 3,
            carbsG: 15,
            fatG: 1,
            confidence: 0.5,
          },
        ],
        overallConfidence: 0.7,
        notes: null,
      };
      render(
        <Wrapper adapters={adapters}>
          <QuickAddSheetContainer />
        </Wrapper>,
      );
      act(() => useFuelSheets.getState().openQuickAdd("breakfast"));
      act(() => mockProbe.last!.onDescribe());
      act(() => mockProbe.last!.onDescribeTextChange("Two eggs and toast"));

      await act(async () => {
        await mockProbe.last!.onSubmitDescribe();
      });
      await waitFor(() =>
        expect(mockProbe.last?.stage).toBe("describeConfirm"),
      );
      // Low-confidence item (0.5 < 0.7) starts unticked.
      expect(mockProbe.last?.describeItems[0]?.on).toBe(true);
      expect(mockProbe.last?.describeItems[1]?.on).toBe(false);
      expect(mockProbe.last?.describeTotalKcal).toBe(140);

      jest.useFakeTimers();
      await act(async () => {
        await mockProbe.last!.onConfirmDescribe();
      });
      expect(
        storage.getCachedFuelToday(USER, localDayISO())?.entriesBySlot.breakfast
          .length,
      ).toBe(1);
      expect(mockProbe.last?.describeAdded).toBe(true);
      expect(useFuelSheets.getState().sheet).toBe("quickAdd"); // not yet closed

      act(() => jest.advanceTimersByTime(900));
      expect(useFuelSheets.getState().sheet).toBeNull();
      jest.useRealTimers();
    });

    it("shows an error and stays on the describe stage on failure", async () => {
      const { adapters } = makeAdapters();
      const api = adapters.api as InMemoryApiAdapter;
      api.nextAiEstimateError = { status: 422, message: "ai_unreadable" };
      render(
        <Wrapper adapters={adapters}>
          <QuickAddSheetContainer />
        </Wrapper>,
      );
      act(() => useFuelSheets.getState().openQuickAdd("breakfast"));
      act(() => mockProbe.last!.onDescribe());
      act(() => mockProbe.last!.onDescribeTextChange("mystery meal"));

      await act(async () => {
        await mockProbe.last!.onSubmitDescribe();
      });
      expect(mockProbe.last?.stage).toBe("describe");
      expect(mockProbe.last?.describeError).toBeTruthy();
    });

    it("toggling and editing grams recomputes the total in the draft", async () => {
      const { adapters } = makeAdapters();
      const api = adapters.api as InMemoryApiAdapter;
      api.aiEstimate = {
        foods: [
          {
            name: "Oats",
            quantity: 1,
            unit: "bowl",
            estimatedGrams: 100,
            kcal: 200,
            proteinG: 6,
            carbsG: 30,
            fatG: 4,
            confidence: 0.95,
          },
        ],
        overallConfidence: 0.95,
        notes: null,
      };
      render(
        <Wrapper adapters={adapters}>
          <QuickAddSheetContainer />
        </Wrapper>,
      );
      act(() => useFuelSheets.getState().openQuickAdd("breakfast"));
      act(() => mockProbe.last!.onDescribe());
      act(() => mockProbe.last!.onDescribeTextChange("A bowl of oats"));
      await act(async () => {
        await mockProbe.last!.onSubmitDescribe();
      });
      await waitFor(() =>
        expect(mockProbe.last?.stage).toBe("describeConfirm"),
      );

      act(() => mockProbe.last!.onEditDescribeGrams(0, 50));
      await waitFor(() => expect(mockProbe.last?.describeTotalKcal).toBe(100));

      act(() => mockProbe.last!.onToggleDescribeItem(0));
      await waitFor(() => expect(mockProbe.last?.describeTotalKcal).toBe(0));
    });

    it("onSubmitDescribe is a no-op for empty or over-length text", async () => {
      const { adapters } = makeAdapters();
      const api = adapters.api as InMemoryApiAdapter;
      render(
        <Wrapper adapters={adapters}>
          <QuickAddSheetContainer />
        </Wrapper>,
      );
      act(() => useFuelSheets.getState().openQuickAdd("breakfast"));
      act(() => mockProbe.last!.onDescribe());

      act(() => mockProbe.last!.onDescribeTextChange("   "));
      await act(async () => {
        await mockProbe.last!.onSubmitDescribe();
      });
      expect(api.estimateFromTextCalls).toHaveLength(0);

      act(() => mockProbe.last!.onDescribeTextChange("a".repeat(1001)));
      await act(async () => {
        await mockProbe.last!.onSubmitDescribe();
      });
      expect(api.estimateFromTextCalls).toHaveLength(0);
      expect(mockProbe.last?.stage).toBe("describe");
    });

    it("onConfirmDescribe is a no-op when nothing is kept", async () => {
      const { adapters, storage } = makeAdapters();
      render(
        <Wrapper adapters={adapters}>
          <QuickAddSheetContainer />
        </Wrapper>,
      );
      act(() => useFuelSheets.getState().openQuickAdd("breakfast"));
      act(() => mockProbe.last!.onDescribe());
      act(() => mockProbe.last!.onDescribeTextChange("A bowl of oats"));
      await act(async () => {
        await mockProbe.last!.onSubmitDescribe();
      });
      await waitFor(() =>
        expect(mockProbe.last?.stage).toBe("describeConfirm"),
      );

      act(() => mockProbe.last!.onToggleDescribeItem(0)); // untick the only item
      await act(async () => {
        await mockProbe.last!.onConfirmDescribe();
      });
      expect(mockProbe.last?.describeAdded).toBe(false);
      expect(
        storage.getCachedFuelToday(USER, localDayISO())?.entriesBySlot.breakfast
          .length ?? 0,
      ).toBe(0);
      expect(useFuelSheets.getState().sheet).toBe("quickAdd"); // still open
    });
  });
});
