import { Alert } from "react-native";
import { act, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import * as Haptics from "expo-haptics";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { localDayISO, previousDayISO } from "@/shared/utils";
import { useAddRecipeMenu } from "@/state/add-recipe-menu";
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
// Holder so a test can re-fire the focus callback (simulate returning to Fuel).
const mockFuelFocus: { cb: (() => void | (() => void)) | null } = { cb: null };

jest.mock("expo-router", () => {
  const React = jest.requireActual("react") as typeof import("react");
  return {
    useRouter: () => ({ push: mockPush }),
    useNavigation: () => ({ addListener: () => () => {} }),
    // Capture + run once on mount (= first focus, which useRefreshOnFocus
    // skips); a test re-fires via mockFuelFocus.cb() to exercise re-entry.
    useFocusEffect: (cb: () => void | (() => void)) => {
      mockFuelFocus.cb = cb;
      React.useEffect(cb, [cb]);
    },
  };
});
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
// Same reason as the AI gate above: `useMealprintEntry` composes
// `useMealprintGate`, which pulls react-query. Its own four-state resolution,
// stalled timer and first-run decision are covered in
// `src/ui/hooks/__tests__/useMealprintHooks.test.tsx`; the assertion here is only
// that the hook's values reach the presenter.
const mockMealprintEntry = {
  state: "unlocked" as const,
  needsSetup: false,
  planProgress: null as null | { loggedCount: number; totalCount: number },
  onPress: jest.fn(),
  onPlanMyDay: jest.fn(),
  onEditPreferences: jest.fn(),
  onUpgrade: jest.fn(),
  onRetry: jest.fn(),
};
const mockUseMealprintEntryCalls: unknown[] = [];
jest.mock("@/ui/hooks/useMealprintEntry", () => ({
  useMealprintEntry: (activePlan: unknown) => {
    mockUseMealprintEntryCalls.push(activePlan);
    return mockMealprintEntry;
  },
}));
const mockMealprintGate = {
  allowed: true,
  isResolved: true,
};
jest.mock("@/ui/hooks/useMealprintGate", () => ({
  useMealprintGate: () => mockMealprintGate,
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
    mockUseMealprintEntryCalls.length = 0;
    mockMealprintEntry.planProgress = null;
    mockMealprintGate.allowed = true;
    mockMealprintGate.isResolved = true;
    jest.clearAllMocks();
  });

  it("re-pulls the day's fuel when the tab regains focus (skips the mount focus)", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFuelToday(USER, localDayISO(), makeFuel());
    const spy = jest.spyOn(adapters.api, "getFuelToday");
    render(
      <Wrapper adapters={adapters}>
        <FuelContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.hasData).toBe(true));
    const before = spy.mock.calls.length;
    // Re-entry (second focus) → refresh; the mount focus was skipped.
    await act(async () => {
      mockFuelFocus.cb?.();
    });
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(before));
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
    expect(p.consumedCarbsG).toBe(50);
    expect(p.macros.map((m) => m.label)).toEqual(["Protein", "Carbs", "Fat"]);
    expect(p.waterGoal).toBe(10);
    expect(p.waterCups).toBe(4);
    // entry name resolved from the cached food
    const breakfast = p.slots.find((s) => s.slot === "breakfast")!;
    expect(breakfast.rows[0]?.name).toBe("Oatmeal");
    // Canvas N1 day label, and the meal's per-meal summary (PER-132).
    expect(p.dateLabel).toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/);
    expect(p.selectedDate).toBe(localDayISO());
    expect(breakfast.kcal).toBe(300);
    expect(breakfast.macroLine).toBe("50g C · 5g F · 10g P");
    // Before Your meals is fetched, the four defaults are placeholders.
    expect(p.slots.map((s) => s.label)).toEqual([
      "Breakfast",
      "Lunch",
      "Snack",
      "Dinner",
    ]);
    // The week strip: 7 days, today selected.
    expect(p.week).toHaveLength(7);
    expect(p.week.find((d) => d.selected)?.state).toBe("today");
  });

  it("groups entries under Your meals once fetched; 1.2.0 entries go to their slot's default (PER-132)", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFoods([food]);
    const fuel = makeFuel();
    const oldEntry = fuel.entriesBySlot.breakfast[0]!;
    fuel.entriesBySlot.snack = [
      { ...oldEntry, id: "e-new", mealSlot: "snack", userMealId: "um-pre" },
      { ...oldEntry, id: "e-old", mealSlot: "snack" },
    ];
    storage.cacheFuelToday(USER, localDayISO(), fuel);
    const meals = [
      ["um-b", "Breakfast", "breakfast", "breakfast"],
      ["um-pre", "Pre-workout", "snack", null],
      ["um-l", "Lunch", "lunch", "lunch"],
      ["um-s", "Snack", "snack", "snack"],
      ["um-d", "Dinner", "dinner", "dinner"],
    ].map(([id, name, logSlot, defaultKey], i) => ({
      id: id as string,
      name: name as string,
      logSlot: logSlot as "snack",
      sortOrder: i,
      defaultKey: defaultKey as "snack" | null,
      clientRequestId: null,
      archivedAt: null,
      updatedAt: "2026-11-20T00:00:00.000Z",
    }));
    storage.cacheUserMeals(USER, meals);
    (adapters.api as InMemoryApiAdapter).userMeals = meals;
    render(
      <Wrapper adapters={adapters}>
        <FuelContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.hasData).toBe(true));
    const p = mockProbe.last!;
    expect(p.slots.map((s) => s.label)).toEqual([
      "Breakfast",
      "Pre-workout",
      "Lunch",
      "Snack",
      "Dinner",
    ]);
    expect(p.slots[1]!.rows.map((r) => r.id)).toEqual(["e-new"]);
    // The entry with no userMealId (1.2.0) sits under the seeded Snack.
    expect(p.slots[3]!.rows.map((r) => r.id)).toEqual(["e-old"]);
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
    expect(mockProbe.last?.quickActions.aiLocked).toBe(true);
  });

  it("Plan and Meals are sections of Fuel, each with its own content (PER-133)", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFuelToday(USER, localDayISO(), makeFuel());
    render(
      <Wrapper adapters={adapters}>
        <FuelContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.hasData).toBe(true));
    expect(mockProbe.last!.section).toBe("log");
    expect(mockProbe.last!.sectionContent).toBeNull();
    act(() => mockProbe.last!.onSection("plan"));
    expect(mockProbe.last!.section).toBe("plan");
    expect(mockProbe.last!.sectionContent).not.toBeNull();
    // The Plan tab reads its data whenever it shows, and opens a coach
    // plan's sheet only while Fuel is focused.
    const content = mockProbe.last!.sectionContent as {
      props: { active: boolean; autoOpen: boolean };
    };
    expect(content.props).toMatchObject({ active: true, autoOpen: true });
    act(() => mockProbe.last!.onRefresh());
    act(() => mockProbe.last!.onSection("meals"));
    expect(mockProbe.last!.section).toBe("meals");
    expect(mockProbe.last!.sectionContent).not.toBeNull();
    act(() => mockProbe.last!.onNew!());
    expect(useAddRecipeMenu.getState().open).toBe(true);
    act(() => useAddRecipeMenu.getState().closeMenu());
    expect(mockPush).not.toHaveBeenCalledWith("/(app)/fuel/recipes");
  });

  it("spec-26 Phase 2 — renders a planned-but-unlogged meal as a ghost row in its mapped slot", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFuelToday(USER, localDayISO(), makeFuel());
    const activePlan = {
      id: "plan-1",
      userId: USER,
      status: "active" as const,
      planDate: localDayISO(),
      groupId: null,
      mealsPerDay: 1,
      effortLevel: "balanced" as const,
      targetKcal: 2200,
      targetProteinG: 160,
      targetCarbsG: 220,
      targetFatG: 70,
      source: "ai",
      createdByUserId: null,
      createdAt: null,
      acceptedAt: null,
      meals: [
        {
          id: "meal-1",
          sortOrder: 0,
          label: "Chicken & rice bowl",
          logSlot: "dinner" as const,
          recipeId: null,
          mealId: null,
          items: null,
          kcal: 640,
          proteinG: 45,
          carbsG: 60,
          fatG: 15,
          aiReason: null,
          state: "planned" as const,
          loggedEntryId: null,
        },
      ],
    };
    storage.cacheMealPlan(USER, activePlan);
    // The hook's automatic background refresh re-fetches from the API and
    // would otherwise overwrite the seeded cache with "no plan" — seed the
    // fake's server-truth too so the refetch agrees.
    (adapters.api as InMemoryApiAdapter).activePlanByDate.set(
      localDayISO(),
      activePlan,
    );
    render(
      <Wrapper adapters={adapters}>
        <FuelContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.hasData).toBe(true));
    const dinner = mockProbe.last!.slots.find((s) => s.slot === "dinner")!;
    expect(dinner.ghostRows).toHaveLength(1);
    // Only the slot's default meal carries the planned rows.
    expect(
      mockProbe.last!.slots.filter((s) => (s.ghostRows?.length ?? 0) > 0),
    ).toHaveLength(1);
    expect(dinner.ghostRows![0]).toMatchObject({
      planId: "plan-1",
      planMealId: "meal-1",
      label: "Chicken & rice bowl",
      kcal: 640,
    });
    // The card passed to useMealprintEntry is the container's own fetched
    // active plan, not a second independent read.
    await waitFor(() =>
      expect(mockUseMealprintEntryCalls.some((p) => p !== null)).toBe(true),
    );
  });

  it("onLogGhost logs the plan meal and it stops appearing as a ghost row", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFuelToday(USER, localDayISO(), makeFuel());
    const plan = {
      id: "plan-1",
      userId: USER,
      status: "active" as const,
      planDate: localDayISO(),
      groupId: null,
      mealsPerDay: 1,
      effortLevel: "balanced" as const,
      targetKcal: 2200,
      targetProteinG: 160,
      targetCarbsG: 220,
      targetFatG: 70,
      source: "ai",
      createdByUserId: null,
      createdAt: null,
      acceptedAt: null,
      meals: [
        {
          id: "meal-1",
          sortOrder: 0,
          label: "Chicken & rice bowl",
          logSlot: "dinner" as const,
          recipeId: null,
          mealId: null,
          items: null,
          kcal: 640,
          proteinG: 45,
          carbsG: 60,
          fatG: 15,
          aiReason: null,
          state: "planned" as const,
          loggedEntryId: null,
        },
      ],
    };
    storage.cacheMealPlan(USER, plan);
    (adapters.api as InMemoryApiAdapter).activePlanByDate.set(
      localDayISO(),
      plan,
    );
    (adapters.api as InMemoryApiAdapter).plans.set("plan-1", plan);
    render(
      <Wrapper adapters={adapters}>
        <FuelContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(
        mockProbe.last?.slots.find((s) => s.slot === "dinner")?.ghostRows,
      ).toHaveLength(1),
    );

    await act(async () => {
      mockProbe.last!.onLogGhost!("plan-1", "meal-1", "dinner");
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(
        storage.getCachedActiveMealPlan(USER, localDayISO())!.meals[0]!.state,
      ).toBe("logged"),
    );
  });

  // amendment 2026-08-fuel-plan-surfacing § B — Edit/Clear from Fuel itself.
  function fixtureActivePlan() {
    return {
      id: "plan-1",
      userId: USER,
      status: "active" as const,
      planDate: localDayISO(),
      groupId: null,
      mealsPerDay: 1,
      effortLevel: "balanced" as const,
      targetKcal: 2200,
      targetProteinG: 160,
      targetCarbsG: 220,
      targetFatG: 70,
      source: "ai",
      createdByUserId: null,
      createdAt: null,
      acceptedAt: null,
      meals: [
        {
          id: "meal-1",
          sortOrder: 0,
          label: "Chicken & rice bowl",
          logSlot: "dinner" as const,
          recipeId: null,
          mealId: null,
          items: null,
          kcal: 640,
          proteinG: 45,
          carbsG: 60,
          fatG: 15,
          aiReason: null,
          state: "planned" as const,
          loggedEntryId: null,
        },
      ],
    };
  }

  it("hides cached Mealprint rows and actions after entitlement loss", async () => {
    mockMealprintGate.allowed = false;
    const { adapters, storage } = makeAdapters();
    storage.cacheFuelToday(USER, localDayISO(), makeFuel());
    storage.cacheMealPlan(USER, fixtureActivePlan());

    render(
      <Wrapper adapters={adapters}>
        <FuelContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.hasData).toBe(true));

    expect(
      mockProbe.last?.slots.find((s) => s.slot === "dinner")?.ghostRows,
    ).toHaveLength(0);
    expect(mockUseMealprintEntryCalls.at(-1)).toBeNull();
  });

  it("onEditPlan pushes the plan-today route", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFuelToday(USER, localDayISO(), makeFuel());
    const plan = fixtureActivePlan();
    storage.cacheMealPlan(USER, plan);
    (adapters.api as InMemoryApiAdapter).activePlanByDate.set(
      localDayISO(),
      plan,
    );
    render(
      <Wrapper adapters={adapters}>
        <FuelContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(
        mockProbe.last?.slots.find((s) => s.slot === "dinner")?.ghostRows,
      ).toHaveLength(1),
    );

    act(() => mockProbe.last!.onEditPlan());

    expect(mockPush).toHaveBeenCalledWith("/(app)/fuel/plan-today");
  });

  it("onClearPlan deletes the active plan, clears its cache, and the ghost rows disappear", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFuelToday(USER, localDayISO(), makeFuel());
    const plan = fixtureActivePlan();
    storage.cacheMealPlan(USER, plan);
    (adapters.api as InMemoryApiAdapter).activePlanByDate.set(
      localDayISO(),
      plan,
    );
    (adapters.api as InMemoryApiAdapter).plans.set("plan-1", plan);
    const deleteSpy = jest.spyOn(adapters.api, "deletePlan");

    render(
      <Wrapper adapters={adapters}>
        <FuelContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(
        mockProbe.last?.slots.find((s) => s.slot === "dinner")?.ghostRows,
      ).toHaveLength(1),
    );

    await act(async () => {
      mockProbe.last!.onClearPlan();
      await Promise.resolve();
    });

    expect(deleteSpy).toHaveBeenCalledWith("plan-1");
    await waitFor(() =>
      expect(storage.getCachedActiveMealPlan(USER, localDayISO())).toBeNull(),
    );
    // ⚠ Revert-verifying: fails unless clearing the plan reloads
    // `activePlan`, which is what makes the ghost row disappear.
    await waitFor(() =>
      expect(
        mockProbe.last?.slots.find((s) => s.slot === "dinner")?.ghostRows,
      ).toHaveLength(0),
    );
    // Logged entries are untouched — only the plan disappeared.
    expect(
      mockProbe.last?.slots.find((s) => s.slot === "breakfast")?.rows,
    ).toHaveLength(1);
  });

  it("surfaces an error and keeps the plan + ghost rows when clearing FAILS (no false success)", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFuelToday(USER, localDayISO(), makeFuel());
    const plan = fixtureActivePlan();
    storage.cacheMealPlan(USER, plan);
    (adapters.api as InMemoryApiAdapter).activePlanByDate.set(
      localDayISO(),
      plan,
    );
    (adapters.api as InMemoryApiAdapter).plans.set("plan-1", plan);
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    jest.spyOn(adapters.api, "deletePlan").mockResolvedValue({
      ok: false,
      error: { message: "network" },
    } as Awaited<ReturnType<InMemoryApiAdapter["deletePlan"]>>);

    render(
      <Wrapper adapters={adapters}>
        <FuelContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(
        mockProbe.last?.slots.find((s) => s.slot === "dinner")?.ghostRows,
      ).toHaveLength(1),
    );

    await act(async () => {
      mockProbe.last!.onClearPlan();
      await Promise.resolve();
    });

    // ⚠ Revert-verifying: if the Result is ignored, the cache is cleared and the
    // ghost row collapses — a false success. The guard keeps both intact and
    // surfaces the failure instead.
    expect(alertSpy).toHaveBeenCalled();
    expect(storage.getCachedActiveMealPlan(USER, localDayISO())).not.toBeNull();
    expect(
      mockProbe.last?.slots.find((s) => s.slot === "dinner")?.ghostRows,
    ).toHaveLength(1);
    alertSpy.mockRestore();
  });

  it("onClearPlan is a no-op when there is no active plan", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFuelToday(USER, localDayISO(), makeFuel());
    const deleteSpy = jest.spyOn(adapters.api, "deletePlan");
    render(
      <Wrapper adapters={adapters}>
        <FuelContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.hasData).toBe(true));

    await act(async () => {
      mockProbe.last!.onClearPlan();
      await Promise.resolve();
    });

    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("a second onClearPlan call while the first is in flight is a no-op", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFuelToday(USER, localDayISO(), makeFuel());
    const plan = fixtureActivePlan();
    storage.cacheMealPlan(USER, plan);
    (adapters.api as InMemoryApiAdapter).activePlanByDate.set(
      localDayISO(),
      plan,
    );
    (adapters.api as InMemoryApiAdapter).plans.set("plan-1", plan);
    let resolveDelete!: (
      r: Awaited<ReturnType<InMemoryApiAdapter["deletePlan"]>>,
    ) => void;
    const deleteSpy = jest
      .spyOn(adapters.api, "deletePlan")
      .mockReturnValue(new Promise((r) => (resolveDelete = r)));

    render(
      <Wrapper adapters={adapters}>
        <FuelContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(
        mockProbe.last?.slots.find((s) => s.slot === "dinner")?.ghostRows,
      ).toHaveLength(1),
    );

    act(() => mockProbe.last!.onClearPlan());
    act(() => mockProbe.last!.onClearPlan());
    expect(deleteSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDelete({ ok: true, value: { deleted: true } });
      await Promise.resolve();
    });
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
    expect(mockProbe.last?.consumedKcal).toBe(2000); // day is in-band…
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

  it("navigates to the targets and Add to a meal routes", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFuelToday(USER, localDayISO(), makeFuel());
    render(
      <Wrapper adapters={adapters}>
        <FuelContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.hasData).toBe(true));
    act(() => mockProbe.last!.onOpenTargets());
    act(() => mockProbe.last!.onAddToMeal("slot:lunch"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/fuel/targets");
    expect(mockPush).toHaveBeenCalledWith(
      "/(app)/fuel/add-to-meal?meal=slot%3Alunch",
    );
  });

  it("opens the scan + quick-add sheets and the calendar modal", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFuelToday(USER, localDayISO(), makeFuel());
    render(
      <Wrapper adapters={adapters}>
        <FuelContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.hasData).toBe(true));

    const q = mockProbe.last!.quickActions;
    act(() => q.onScan());
    expect(useFuelSheets.getState().sheet).toBe("scan");
    act(() => useFuelSheets.getState().close());

    act(() => q.onSearch());
    expect(useFuelSheets.getState().sheet).toBe("quickAdd");
    act(() => useFuelSheets.getState().close());

    act(() => q.onQuickLog());
    expect(useFuelSheets.getState().sheet).toBe("quickLog");
    act(() => useFuelSheets.getState().close());

    // Once Your meals is fetched, the drawers aim at a real meal id.
    await waitFor(() =>
      expect(
        mockProbe.last!.slots.every((m) => !m.key.startsWith("slot:")),
      ).toBe(true),
    );
    act(() => mockProbe.last!.quickActions.onScan());
    expect(useFuelSheets.getState().userMealId).toMatch(/^0000/);
    act(() => useFuelSheets.getState().close());

    act(() => mockProbe.last!.onMealOptions("slot:lunch"));
    expect(useFuelSheets.getState().sheet).toBe("mealOptions");
    expect(useFuelSheets.getState().optionsMealKey).toBe("slot:lunch");
    act(() => mockProbe.last!.onEditMeals());
    expect(useFuelSheets.getState().sheet).toBe("yourMeals");
    act(() => useFuelSheets.getState().close());

    // Snap routes to the upgrade prompt (gate stubbed).
    act(() => q.onSnap());

    // The calendar icon opens the month-grid modal (BRIEF-7 QA-19) — no
    // longer the M9 no-op.
    expect(mockProbe.last!.calendarOpen).toBe(false);
    act(() => mockProbe.last!.onOpenCalendar());
    await waitFor(() => expect(mockProbe.last!.calendarOpen).toBe(true));
    act(() => mockProbe.last!.onCloseCalendar());
    await waitFor(() => expect(mockProbe.last!.calendarOpen).toBe(false));
  });

  describe("day navigation (BRIEF-7 QA-19 + QA-20)", () => {
    it("steps back/forward a day, re-reading the cache + re-labelling the header", async () => {
      const { adapters, storage } = makeAdapters();
      const today = localDayISO();
      const yesterday = previousDayISO(today);
      storage.cacheFuelToday(USER, today, makeFuel());
      storage.cacheFuelToday(USER, yesterday, {
        ...makeFuel(),
        consumed: {
          kcal: 500,
          proteinG: 20,
          carbsG: 60,
          fatG: 10,
          waterCups: 2,
        },
        remainingKcal: 1500,
      });
      render(
        <Wrapper adapters={adapters}>
          <FuelContainer />
        </Wrapper>,
      );
      await waitFor(() => expect(mockProbe.last?.hasData).toBe(true));
      expect(mockProbe.last!.consumedKcal).toBe(300);
      const todayLabel = mockProbe.last!.dateLabel;

      act(() => mockProbe.last!.onSelectDay(yesterday));
      await waitFor(() => expect(mockProbe.last!.consumedKcal).toBe(500));
      expect(mockProbe.last!.dateLabel).not.toBe(todayLabel);
      expect(mockProbe.last!.selectedDate).toBe(yesterday);

      act(() => mockProbe.last!.onSelectDay(today));
      await waitFor(() => expect(mockProbe.last!.consumedKcal).toBe(300));
      expect(mockProbe.last!.dateLabel).toBe(todayLabel);
    });

    it("a future day from the week strip clamps to today (defence in depth)", async () => {
      const { adapters, storage } = makeAdapters();
      storage.cacheFuelToday(USER, localDayISO(), makeFuel());
      render(
        <Wrapper adapters={adapters}>
          <FuelContainer />
        </Wrapper>,
      );
      await waitFor(() => expect(mockProbe.last?.hasData).toBe(true));
      act(() => mockProbe.last!.onSelectDay("2999-01-01"));
      await waitFor(() => expect(mockProbe.last!.hasData).toBe(true));
      expect(mockProbe.last!.selectedDate).toBe(localDayISO());
    });

    it("selecting a day from the calendar modal jumps there and closes it", async () => {
      const { adapters, storage } = makeAdapters();
      const today = localDayISO();
      const yesterday = previousDayISO(today);
      storage.cacheFuelToday(USER, today, makeFuel());
      storage.cacheFuelToday(USER, yesterday, {
        ...makeFuel(),
        consumed: {
          kcal: 500,
          proteinG: 20,
          carbsG: 60,
          fatG: 10,
          waterCups: 2,
        },
        remainingKcal: 1500,
      });
      render(
        <Wrapper adapters={adapters}>
          <FuelContainer />
        </Wrapper>,
      );
      await waitFor(() => expect(mockProbe.last?.hasData).toBe(true));
      act(() => mockProbe.last!.onOpenCalendar());
      expect(mockProbe.last!.calendarOpen).toBe(true);

      act(() => mockProbe.last!.onSelectDate(yesterday));
      await waitFor(() => expect(mockProbe.last!.consumedKcal).toBe(500));
      expect(mockProbe.last!.selectedDate).toBe(yesterday);
      expect(mockProbe.last!.calendarOpen).toBe(false);
    });

    it("selecting a future day from the calendar clamps to today (defence in depth)", async () => {
      const { adapters, storage } = makeAdapters();
      storage.cacheFuelToday(USER, localDayISO(), makeFuel());
      render(
        <Wrapper adapters={adapters}>
          <FuelContainer />
        </Wrapper>,
      );
      await waitFor(() => expect(mockProbe.last?.hasData).toBe(true));
      const future = `${Number(localDayISO().slice(0, 4)) + 1}-01-01`;
      act(() => mockProbe.last!.onSelectDate(future));
      await waitFor(() => expect(mockProbe.last!.hasData).toBe(true));
      expect(mockProbe.last!.selectedDate).toBe(localDayISO());
    });

    it("keeps the shared sheet store's active day in sync with the viewed day (QA-20)", async () => {
      const { adapters, storage } = makeAdapters();
      const today = localDayISO();
      const yesterday = previousDayISO(today);
      storage.cacheFuelToday(USER, today, makeFuel());
      storage.cacheFuelToday(USER, yesterday, makeFuel());
      render(
        <Wrapper adapters={adapters}>
          <FuelContainer />
        </Wrapper>,
      );
      await waitFor(() => expect(mockProbe.last?.hasData).toBe(true));
      expect(useFuelSheets.getState().date).toBe(today);

      act(() => mockProbe.last!.onSelectDay(yesterday));
      await waitFor(() =>
        expect(useFuelSheets.getState().date).toBe(yesterday),
      );
    });
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
