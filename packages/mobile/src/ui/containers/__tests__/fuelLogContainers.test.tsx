/**
 * PER-132 containers: Add to a meal, Your meals, a meal's options, Quick log,
 * the locked Suggest page and the five quick buttons' routing.
 */
import {
  act,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { FuelToday, NutritionEntry } from "@/domain/models/nutrition";
import type { UserMeal } from "@/domain/models/userMeals";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { addDaysISO, localDayISO } from "@/shared/utils";
import { useFuelSheets } from "@/state/fuel-sheets";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useMealQuickActions } from "@/ui/hooks/useMealQuickActions";
import { useLogEntry } from "@/ui/hooks/useLogEntry";
import type { AddToMealProps } from "@/ui/presenters/fuel/AddToMealPresenter";
import type { YourMealsSheetProps } from "@/ui/presenters/fuel/YourMealsSheetPresenter";
import type { MealOptionsSheetProps } from "@/ui/presenters/fuel/MealOptionsSheetPresenter";
import type { QuickLogSheetProps } from "@/ui/presenters/fuel/QuickLogSheetPresenter";
import type { SuggestLockedSheetProps } from "@/ui/presenters/fuel/SuggestLockedSheetPresenter";
import { AddToMealContainer, earlierDayLabel } from "../AddToMealContainer";
import { YourMealsSheetContainer } from "../YourMealsSheetContainer";
import { MealOptionsSheetContainer } from "../MealOptionsSheetContainer";
import { QuickLogSheetContainer } from "../QuickLogSheetContainer";
import { SuggestLockedSheetContainer } from "../SuggestLockedSheetContainer";

const probe: {
  add: AddToMealProps | null;
  your: YourMealsSheetProps | null;
  options: MealOptionsSheetProps | null;
  quick: QuickLogSheetProps | null;
  locked: SuggestLockedSheetProps | null;
} = { add: null, your: null, options: null, quick: null, locked: null };

jest.mock("@/ui/presenters/fuel/AddToMealPresenter", () => ({
  AddToMealPresenter: (p: AddToMealProps) => {
    probe.add = p;
    return null;
  },
}));
jest.mock("@/ui/presenters/fuel/YourMealsSheetPresenter", () => ({
  YourMealsSheetPresenter: (p: YourMealsSheetProps) => {
    probe.your = p;
    return null;
  },
}));
jest.mock("@/ui/presenters/fuel/MealOptionsSheetPresenter", () => ({
  MealOptionsSheetPresenter: (p: MealOptionsSheetProps) => {
    probe.options = p;
    return null;
  },
}));
jest.mock("@/ui/presenters/fuel/QuickLogSheetPresenter", () => ({
  QuickLogSheetPresenter: (p: QuickLogSheetProps) => {
    probe.quick = p;
    return null;
  },
}));
jest.mock("@/ui/presenters/fuel/SuggestLockedSheetPresenter", () => ({
  SuggestLockedSheetPresenter: (p: SuggestLockedSheetProps) => {
    probe.locked = p;
    return null;
  },
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: (...a: unknown[]) => mockPush(...a), back: () => mockBack() },
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));
const mockAiGate = { allowed: true, gateProps: { onUpgrade: jest.fn() } };
jest.mock("@/ui/hooks/useNutritionAiGate", () => ({
  useNutritionAiGate: () => mockAiGate,
}));
const mockGate = { allowed: false, isResolved: true, onUpgrade: jest.fn() };
jest.mock("@/ui/hooks/useMealprintGate", () => ({
  useMealprintGate: () => mockGate,
}));
let mockOnline = true;
jest.mock("@/ui/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => mockOnline,
}));

const mockFetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({ data: { results: [] } }),
  text: async () => "",
}));
(globalThis as Record<string, unknown>).fetch = mockFetch;

const USER = "user-1";
const TODAY = localDayISO();
const YESTERDAY = addDaysISO(TODAY, -1);

const MEALS: UserMeal[] = (
  [
    ["um-b", "Breakfast", "breakfast", "breakfast"],
    ["um-pre", "Pre-workout", "snack", null],
    ["um-l", "Lunch", "lunch", "lunch"],
  ] as const
).map(([id, name, slot, key], i) => ({
  id,
  name,
  logSlot: slot,
  sortOrder: i,
  defaultKey: key,
  clientRequestId: null,
  archivedAt: null,
  updatedAt: "2026-11-20T00:00:00.000Z",
}));

const entry = (
  id: string,
  extra: Partial<NutritionEntry> = {},
): NutritionEntry => ({
  id,
  userId: USER,
  foodId: null,
  recipeId: null,
  mealId: null,
  mealSlot: "snack",
  servings: 1,
  kcal: 200,
  proteinG: 10,
  carbsG: 20,
  fatG: 5,
  loggedAt: `${YESTERDAY}T12:00:00.000Z`,
  loggedByUserId: null,
  aiEstimated: false,
  aiConfidence: null,
  customName: "Oats",
  userMealId: "um-pre",
  ...extra,
});

const day = (date: string, entries: NutritionEntry[]): FuelToday => ({
  date,
  targets: null,
  consumed: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, waterCups: 0 },
  remainingKcal: 0,
  entriesBySlot: {
    breakfast: entries.filter((e) => e.mealSlot === "breakfast"),
    lunch: entries.filter((e) => e.mealSlot === "lunch"),
    snack: entries.filter((e) => e.mealSlot === "snack"),
    dinner: [],
  },
});

function setup() {
  const api = new InMemoryApiAdapter();
  api.userMeals = MEALS;
  const storage = new InMemoryStorageAdapter();
  storage.initialize();
  storage.cacheUserMeals(USER, MEALS);
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: USER,
    email: "a@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const adapters: Adapters = {
    api,
    auth: {
      getSession: jest.fn(async () => ok(session)),
      onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
        cb(session);
        return () => {};
      }),
      getAccessToken: jest.fn(async () => "t"),
    } as unknown as Adapters["auth"],
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    netInfo: {
      isConnected: async () => true,
      subscribe: () => () => {},
    } as unknown as Adapters["netInfo"],
  };
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
  );
  return { api, storage, Wrapper };
}

beforeEach(() => {
  for (const k of Object.keys(probe)) probe[k as keyof typeof probe] = null;
  mockPush.mockClear();
  mockBack.mockClear();
  mockParams = {};
  mockGate.allowed = false;
  mockGate.isResolved = true;
  mockAiGate.allowed = true;
  mockOnline = true;
  act(() => {
    useFuelSheets.getState().close();
    useFuelSheets.getState().setDate(TODAY);
  });
});

describe("useMealQuickActions — the five quick buttons for one meal", () => {
  const meal = MEALS[1]!;

  it("Suggest opens the locked page for Free and Premium (PER-132)", () => {
    const { Wrapper } = setup();
    const { result } = renderHook(() => useMealQuickActions(meal), {
      wrapper: Wrapper,
    });
    expect(result.current.suggestLocked).toBe(true);
    act(() => result.current.onSuggest());
    expect(useFuelSheets.getState().sheet).toBe("suggestLocked");
  });

  it("Suggest waits while the plan is unresolved", () => {
    mockGate.isResolved = false;
    const { Wrapper } = setup();
    const { result } = renderHook(() => useMealQuickActions(meal), {
      wrapper: Wrapper,
    });
    expect(result.current.suggestLocked).toBe(false);
    act(() => result.current.onSuggest());
    expect(useFuelSheets.getState().sheet).toBeNull();
  });

  it("Premium+ goes to the preferences wizard first, then One meal preset to the meal", () => {
    mockGate.allowed = true;
    const { Wrapper, storage } = setup();
    const { result, rerender } = renderHook(() => useMealQuickActions(meal), {
      wrapper: Wrapper,
    });
    act(() => result.current.onSuggest());
    expect(mockPush).toHaveBeenCalledWith(
      "/(app)/fuel/preferences?mode=wizard",
    );

    storage.cacheMealprintPreferences(USER, { isDefault: false } as never);
    const hook2 = renderHook(() => useMealQuickActions(meal), {
      wrapper: Wrapper,
    });
    rerender({});
    act(() => hook2.result.current.onSuggest());
    expect(useFuelSheets.getState()).toMatchObject({
      sheet: "mealprintSuggest",
      slot: "snack",
      userMealId: "um-pre",
    });
  });

  it("each other button opens its drawer aimed at the meal", () => {
    const { Wrapper } = setup();
    const { result } = renderHook(() => useMealQuickActions(meal), {
      wrapper: Wrapper,
    });
    const opened = (fn: () => void) => {
      act(fn);
      const s = useFuelSheets.getState();
      const out = [s.sheet, s.slot, s.userMealId];
      act(() => s.close());
      return out;
    };
    expect(opened(result.current.onScan)).toEqual(["scan", "snack", "um-pre"]);
    expect(opened(result.current.onSearch)).toEqual([
      "quickAdd",
      "snack",
      "um-pre",
    ]);
    expect(opened(result.current.onQuickLog)).toEqual([
      "quickLog",
      "snack",
      "um-pre",
    ]);
    expect(opened(result.current.onSnap)).toEqual(["snap", "snack", "um-pre"]);
  });

  it("Snap upsells without AI and does nothing offline; placeholders send no meal id", () => {
    mockAiGate.allowed = false;
    const { Wrapper } = setup();
    const { result } = renderHook(
      () => useMealQuickActions({ id: "slot:lunch", logSlot: "lunch" }),
      { wrapper: Wrapper },
    );
    act(() => result.current.onSnap());
    expect(mockAiGate.gateProps.onUpgrade).toHaveBeenCalled();
    act(() => result.current.onScan());
    expect(useFuelSheets.getState().userMealId).toBeNull();
    mockOnline = false;
    const offline = renderHook(() => useMealQuickActions(null), {
      wrapper: Wrapper,
    });
    act(() => useFuelSheets.getState().close());
    act(() => offline.result.current.onSnap());
    expect(useFuelSheets.getState().sheet).toBeNull();
    expect(offline.result.current.snapOffline).toBe(true);
  });
});

describe("useLogEntry — logs go into the meal the drawer was opened for", () => {
  it("attaches the meal while the slot matches, not after the slot changes", async () => {
    const { Wrapper, storage } = setup();
    const { result } = renderHook(() => useLogEntry(), { wrapper: Wrapper });
    act(() => useFuelSheets.getState().openScan("snack", "um-pre"));
    await act(async () => {
      await result.current.mutate({
        mealSlot: "snack",
        servings: 1,
        kcal: 1,
        loggedAt: `${TODAY}T12:00:00.000Z`,
      });
      await result.current.mutate({
        mealSlot: "lunch",
        servings: 1,
        kcal: 1,
        loggedAt: `${TODAY}T12:00:00.000Z`,
      });
    });
    const sent = storage
      .getUncompletedMutations()
      .map((q) => JSON.parse(q.payload).userMealId);
    expect(sent).toEqual(["um-pre", undefined]);
  });
});

describe("AddToMealContainer", () => {
  it("resolves the meal, lists earlier days, and logs the picks into it as one batch", async () => {
    mockParams = { meal: "um-pre" };
    const { Wrapper, storage, api } = setup();
    storage.cacheFuelToday(
      USER,
      YESTERDAY,
      day(YESTERDAY, [
        entry("e1"),
        entry("e2", {
          mealSlot: "lunch",
          userMealId: null,
          customName: "Soup",
        }),
      ]),
    );
    const saved = [
      {
        id: "m1",
        userId: USER,
        name: "Bagel breakfast",
        photoUrl: null,
        totalKcal: 526,
        totalProteinG: 0,
        totalCarbsG: 0,
        totalFatG: 0,
        items: [],
      },
    ];
    const recipes = [
      {
        id: "r1",
        userId: USER,
        name: "Katsu",
        photoUrl: null,
        servings: 2,
        instructions: null,
        source: "manual",
        sourceUrl: null,
        totalKcal: 1560,
        totalProteinG: 0,
        totalCarbsG: 0,
        totalFatG: 0,
        ingredients: [],
      },
    ];
    storage.cacheMeals(USER, saved);
    storage.cacheRecipes(USER, recipes);
    api.meals = saved;
    api.recipes = recipes;
    render(<AddToMealContainer />, { wrapper: Wrapper });
    await waitFor(() => expect(probe.add?.mealName).toBe("Pre-workout"));
    const p = probe.add!;
    expect(p.recentGroups.map((g) => g.heading)).toEqual([
      expect.stringMatching(/ · Pre-workout$/),
      expect.stringMatching(/ · Lunch$/),
    ]);
    expect(p.addLabel).toBe("Pick what to add");
    expect(p.canAdd).toBe(false);

    act(() => probe.add!.onAddAll(p.recentGroups[0]!.key));
    act(() => probe.add!.onToggle("m:m1"));
    act(() => probe.add!.onToggle("r:r1"));
    act(() => probe.add!.onToggle("e:e2"));
    act(() => probe.add!.onToggle("e:e2"));
    expect(probe.add!.addLabel).toBe("Add 3 items · 1,506 kcal");
    expect(probe.add!.recipeRows[0]!.kcal).toBe(780);

    mockFetch.mockClear();
    await act(async () => probe.add!.onAdd());
    const today = storage.getCachedFuelToday(USER, TODAY)!;
    const logged = Object.values(today.entriesBySlot).flat();
    expect(logged).toHaveLength(3);
    expect(
      logged.every((e) => e.userMealId === "um-pre" && e.mealSlot === "snack"),
    ).toBe(true);
    const urls = (mockFetch.mock.calls as unknown as [string][]).map(
      (c) => c[0],
    );
    expect(
      urls.filter((u) => u.endsWith("/nutrition/entries/batch")),
    ).toHaveLength(1);
    expect(mockBack).toHaveBeenCalled();
  });

  it("opens on the tab asked for, ignores unknown groups and falls back to the first meal", async () => {
    mockParams = { meal: "slot:lunch", tab: "saved" };
    const { Wrapper } = setup();
    render(<AddToMealContainer />, { wrapper: Wrapper });
    await waitFor(() => expect(probe.add?.tab).toBe("saved"));
    expect(probe.add!.mealName).toBe("Lunch");
    act(() => probe.add!.onAddAll("nope"));
    await act(async () => probe.add!.onAdd()); // nothing picked: no-op
    expect(mockBack).not.toHaveBeenCalled();
    act(() => probe.add!.onBack());
    expect(mockBack).toHaveBeenCalled();
  });

  it("labels earlier days", () => {
    expect(earlierDayLabel(YESTERDAY, TODAY)).toBe("Yesterday");
    expect(earlierDayLabel("2026-11-18", "2026-11-23")).toMatch(/^Wed 18$/);
  });
});

describe("YourMealsSheetContainer", () => {
  it("saves renames, reorders and adds offline-first", async () => {
    const { Wrapper, storage } = setup();
    render(<YourMealsSheetContainer />, { wrapper: Wrapper });
    act(() => useFuelSheets.getState().openYourMeals());
    await waitFor(() => expect(probe.your?.visible).toBe(true));
    expect(probe.your!.editable).toBe(true);
    expect(probe.your!.meals.map((m) => m.sub)).toEqual([
      "Default",
      "Added by you",
      "Default",
    ]);

    await act(async () => probe.your!.onRename("um-l", "Midday"));
    await act(async () => probe.your!.onReorder(["um-l", "um-b", "um-pre"]));
    await act(async () => probe.your!.onAdd("Supper"));
    const cached = storage.getCachedUserMeals(USER)!;
    expect(cached.map((m) => m.name)).toEqual([
      "Midday",
      "Breakfast",
      "Pre-workout",
      "Supper",
    ]);
    act(() => probe.your!.onClose());
    expect(useFuelSheets.getState().sheet).toBeNull();
  });
});

describe("MealOptionsSheetContainer", () => {
  it("copies, saves as a meal, edits meals and clears the meal's entries", async () => {
    const { Wrapper, storage } = setup();
    storage.cacheFuelToday(
      USER,
      TODAY,
      day(TODAY, [
        entry("t1", { loggedAt: `${TODAY}T12:00:00.000Z` }),
        entry("t2", { mealId: "saved", loggedAt: `${TODAY}T12:00:00.000Z` }),
      ]),
    );
    render(<MealOptionsSheetContainer />, { wrapper: Wrapper });
    act(() => useFuelSheets.getState().openMealOptions("um-pre"));
    await waitFor(() => expect(probe.options?.mealName).toBe("Pre-workout"));
    expect(probe.options!.hasEntries).toBe(true);

    act(() => probe.options!.onCopy());
    expect(mockPush).toHaveBeenCalledWith(
      "/(app)/fuel/add-to-meal?meal=um-pre&tab=recent",
    );
    act(() => useFuelSheets.getState().openMealOptions("um-pre"));
    act(() => probe.options!.onSaveAsMeal());
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: "/(app)/fuel/save-meal",
      params: { name: "Pre-workout", entryIds: "t1" },
    });
    act(() => useFuelSheets.getState().openMealOptions("um-pre"));
    act(() => probe.options!.onEditMeals());
    expect(useFuelSheets.getState().sheet).toBe("yourMeals");

    act(() => useFuelSheets.getState().openMealOptions("um-pre"));
    await act(async () => probe.options!.onClear());
    await waitFor(() =>
      expect(
        storage.getCachedFuelToday(USER, TODAY)!.entriesBySlot.snack,
      ).toHaveLength(0),
    );
    act(() => probe.options!.onClose());
  });
});

describe("QuickLogSheetContainer (N2e)", () => {
  it("logs the calories typed into the chosen meal, offline-first", async () => {
    const { Wrapper, storage } = setup();
    render(<QuickLogSheetContainer />, { wrapper: Wrapper });
    act(() => useFuelSheets.getState().openQuickLog("snack", "um-pre"));
    await waitFor(() => expect(probe.quick?.selectedMealKey).toBe("um-pre"));
    expect(probe.quick!.canLog).toBe(false);
    act(() => probe.quick!.onChange("kcal", "450"));
    act(() => probe.quick!.onChange("protein", "35"));
    act(() => probe.quick!.onChange("carbs", "60"));
    act(() => probe.quick!.onChange("fat", "15"));
    act(() => probe.quick!.onChange("name", "Burrito"));
    expect(probe.quick!.warning).toBe(
      "Your macros add up to 515 kcal. We'll log the 450 you typed.",
    );
    expect(probe.quick!.kcalLabel).toBe("450");
    act(() => probe.quick!.onSelectMeal("um-l"));
    expect(probe.quick!.mealLabel).toBe("Lunch");
    await act(async () => probe.quick!.onLog());
    const [e] = storage.getCachedFuelToday(USER, TODAY)!.entriesBySlot.lunch;
    expect(e).toMatchObject({
      kcal: 450,
      customName: "Burrito",
      userMealId: "um-l",
    });
    expect(useFuelSheets.getState().sheet).toBeNull();
  });

  it("defaults to the slot's meal and closes on dismiss", async () => {
    const { Wrapper } = setup();
    render(<QuickLogSheetContainer />, { wrapper: Wrapper });
    act(() => useFuelSheets.getState().openQuickLog("lunch"));
    await waitFor(() => expect(probe.quick?.selectedMealKey).toBe("um-l"));
    await act(async () => probe.quick!.onLog()); // nothing typed: no-op
    expect(useFuelSheets.getState().sheet).toBe("quickLog");
    act(() => probe.quick!.onClose());
    expect(useFuelSheets.getState().sheet).toBeNull();
  });
});

describe("SuggestLockedSheetContainer", () => {
  it("shows for Free/Premium and sends See Premium+ to the paywall", () => {
    const { Wrapper } = setup();
    render(<SuggestLockedSheetContainer />, { wrapper: Wrapper });
    expect(probe.locked!.visible).toBe(false);
    act(() => useFuelSheets.getState().openSuggestLocked());
    expect(probe.locked!.visible).toBe(true);
    act(() => probe.locked!.onUpgrade());
    expect(mockGate.onUpgrade).toHaveBeenCalled();
    expect(useFuelSheets.getState().sheet).toBeNull();
    act(() => useFuelSheets.getState().openSuggestLocked());
    act(() => probe.locked!.onClose());
    expect(useFuelSheets.getState().sheet).toBeNull();
  });
});
