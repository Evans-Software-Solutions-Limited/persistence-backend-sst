import { act, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import * as Haptics from "expo-haptics";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { localDayISO } from "@/shared/utils";
import { useFuelSheets } from "@/state/fuel-sheets";
import type {
  Food,
  FuelToday,
  NutritionTarget,
} from "@/domain/models/nutrition";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { FuelPresenterProps } from "@/ui/presenters/FuelPresenter";
import { FuelContainer } from "../FuelContainer";

const mockPush = jest.fn();
const mockProbe: { last: FuelPresenterProps | null } = { last: null };

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useNavigation: () => ({ addListener: () => () => {} }),
}));
jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));
jest.mock("@/ui/presenters/FuelPresenter", () => ({
  FuelPresenter: (props: FuelPresenterProps) => {
    mockProbe.last = props;
    return null;
  },
}));
// The AI gate pulls react-query (useMySubscription) which needs a provider;
// the gate's own logic is unit-tested elsewhere — stub it locked for M9.
jest.mock("@/ui/hooks/useNutritionAiGate", () => ({
  useNutritionAiGate: () => ({
    allowed: false,
    reason: "tier",
    gateProps: { onUpgrade: jest.fn() },
  }),
}));

const mockFetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: {} }),
}));
(globalThis as Record<string, unknown>).fetch = mockFetch;

const USER = "user-1";

const target: NutritionTarget = {
  userId: USER,
  dailyKcal: 2000,
  proteinG: 150,
  carbsG: 200,
  fatG: 60,
  waterCups: 10,
  preset: "custom",
  setByUserId: null,
  setByName: null,
  updatedAt: null,
};

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
  servingQuantity: null,
  source: "user",
  createdBy: USER,
};

function makeFuel(): FuelToday {
  return {
    date: localDayISO(),
    targets: target,
    consumed: { kcal: 300, proteinG: 10, carbsG: 50, fatG: 5, waterCups: 4 },
    remainingKcal: 1700,
    entriesBySlot: {
      breakfast: [
        {
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
        },
      ],
      lunch: [],
      snack: [],
      dinner: [],
    },
  };
}

function makeAdapters(): {
  adapters: Adapters;
  storage: InMemoryStorageAdapter;
} {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: USER,
    email: "alex@example.com",
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

describe("FuelContainer", () => {
  beforeEach(() => {
    mockProbe.last = null;
    mockPush.mockClear();
    jest.clearAllMocks();
  });

  it("derives the presenter view-model from the cached day aggregate", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFoods([food]);
    storage.cacheFuelToday(USER, localDayISO(), makeFuel());

    render(
      <Wrapper adapters={adapters}>
        <FuelContainer />
      </Wrapper>,
    );

    await waitFor(() => expect(mockProbe.last?.hasData).toBe(true));
    const p = mockProbe.last!;
    expect(p.consumedKcal).toBe(300);
    expect(p.targetKcal).toBe(2000);
    expect(p.remainingKcal).toBe(1700);
    expect(p.ringPct).toBeCloseTo(0.15, 5);
    expect(p.macros).toHaveLength(3);
    expect(p.waterGoal).toBe(10);
    expect(p.waterCups).toBe(4);
    // entry name resolved from the cached food
    const breakfast = p.slots.find((s) => s.slot === "breakfast")!;
    expect(breakfast.rows[0]?.name).toBe("Oatmeal");
    expect(p.dateLabel).toMatch(/·/);
  });

  it("locks the AI (Snap) affordance in M9", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFuelToday(USER, localDayISO(), makeFuel());
    render(
      <Wrapper adapters={adapters}>
        <FuelContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.hasData).toBe(true));
    expect(mockProbe.last?.aiLocked).toBe(true);
  });

  it("does not fire the goal-hit haptic on cold start into an already-in-band day", async () => {
    const { adapters, storage } = makeAdapters();
    // consumed == targets → every macro in band → goalHit.all true at hydrate.
    storage.cacheFuelToday(USER, localDayISO(), {
      ...makeFuel(),
      consumed: {
        kcal: 2000,
        proteinG: 150,
        carbsG: 200,
        fatG: 60,
        waterCups: 4,
      },
      remainingKcal: 0,
    });
    render(
      <Wrapper adapters={adapters}>
        <FuelContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.hasData).toBe(true));
    expect(mockProbe.last?.celebrate).toBe(true); // day is in-band…
    // …but opening the tab must NOT buzz — the haptic is for a live transition.
    expect(Haptics.notificationAsync as jest.Mock).not.toHaveBeenCalled();
  });

  it("setting water fires a selection haptic and optimistically reloads", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFuelToday(USER, localDayISO(), makeFuel());
    render(
      <Wrapper adapters={adapters}>
        <FuelContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.hasData).toBe(true));

    await act(async () => {
      mockProbe.last!.onSetWater(7);
    });

    expect(Haptics.selectionAsync as jest.Mock).toHaveBeenCalled();
    await waitFor(() => expect(mockProbe.last?.waterCups).toBe(7));
  });

  it("navigates to the targets + recipes routes", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFuelToday(USER, localDayISO(), makeFuel());
    render(
      <Wrapper adapters={adapters}>
        <FuelContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.hasData).toBe(true));
    act(() => mockProbe.last!.onOpenTargets());
    act(() => mockProbe.last!.onRecipes());
    expect(mockPush).toHaveBeenCalledWith("/(app)/fuel/targets");
    expect(mockPush).toHaveBeenCalledWith("/(app)/fuel/recipes");
  });

  it("opens the scan + quick-add sheets and is calendar-safe", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFuelToday(USER, localDayISO(), makeFuel());
    render(
      <Wrapper adapters={adapters}>
        <FuelContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.hasData).toBe(true));

    act(() => mockProbe.last!.onScan());
    expect(useFuelSheets.getState().sheet).toBe("scan");
    act(() => useFuelSheets.getState().close());

    act(() => mockProbe.last!.onSearch());
    expect(useFuelSheets.getState().sheet).toBe("quickAdd");
    act(() => useFuelSheets.getState().close());

    act(() => mockProbe.last!.onAddToSlot("dinner"));
    expect(useFuelSheets.getState().sheet).toBe("quickAdd");
    expect(useFuelSheets.getState().slot).toBe("dinner");
    act(() => useFuelSheets.getState().close());

    act(() => mockProbe.last!.onLog());
    expect(useFuelSheets.getState().sheet).toBe("quickAdd");

    // Snap routes to the upgrade prompt (gate stubbed); calendar is a no-op.
    act(() => mockProbe.last!.onSnap());
    act(() => mockProbe.last!.onOpenCalendar());
  });

  it("delete optimistically removes the entry and drains the DELETE", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFoods([food]);
    storage.cacheFuelToday(USER, localDayISO(), makeFuel());

    render(
      <Wrapper adapters={adapters}>
        <FuelContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.hasData).toBe(true));
    expect(
      mockProbe.last!.slots.find((s) => s.slot === "breakfast")!.rows,
    ).toHaveLength(1);

    // Swipe→Delete calls onDeleteEntry directly (no confirm dialog): the entry
    // drops from the log immediately and the DELETE drains behind it.
    await act(async () => {
      mockProbe.last!.onDeleteEntry!("e1", "breakfast");
    });
    await waitFor(() =>
      expect(
        mockProbe.last!.slots.find((s) => s.slot === "breakfast")!.rows,
      ).toHaveLength(0),
    );
    expect(mockProbe.last!.consumedKcal).toBe(0);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.test/nutrition/entries/e1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("exposes a P/C/F macro breakdown on each logged row", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFoods([food]);
    storage.cacheFuelToday(USER, localDayISO(), makeFuel());
    render(
      <Wrapper adapters={adapters}>
        <FuelContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.hasData).toBe(true));
    const row = mockProbe.last!.slots.find((s) => s.slot === "breakfast")!
      .rows[0]!;
    expect(row.proteinG).toBe(10);
    expect(row.carbsG).toBe(50);
    expect(row.fatG).toBe(5);
  });
});
