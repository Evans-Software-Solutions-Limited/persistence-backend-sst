/**
 * PER-134 Mealprint page: the shell (locked / loading / offline / tabs), One
 * meal (N15 → N17 → N18) and Whole day (N15 → N19/N20 → N21 / N22), against
 * the in-memory API and storage. Presenters are probes.
 */
import { act, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type {
  MealSuggestion,
  PlanGeneratedMeal,
  PlanSwapMeal,
} from "@/domain/models/mealprint";
import type {
  NutritionEntry,
  NutritionTarget,
} from "@/domain/models/nutrition";
import type { UserMeal } from "@/domain/models/userMeals";
import type { AuthSession } from "@/domain/ports/auth.port";
import { flattenFuelEntries } from "@/domain/services/nutrition.service";
import { MEALPRINT_DAY_ARCHIVE_ENTITY } from "@/application/commands/mealprintDay.command";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { localDayISO } from "@/shared/utils";
import { useFuelSheets } from "@/state/fuel-sheets";
import { usePlanFlow } from "@/state/plan-flow";
import { usePlanSheets } from "@/state/plan-sheets";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { MealprintDayProps } from "@/ui/presenters/mealprint/MealprintDayPresenter";
import type {
  MealprintLoggedProps,
  MealprintSavedProps,
} from "@/ui/presenters/mealprint/MealprintDoneScreens";
import type { MealprintHomeProps } from "@/ui/presenters/mealprint/MealprintHomePresenter";
import type { MealprintIdeasProps } from "@/ui/presenters/mealprint/MealprintIdeasPresenter";
import type { MealprintLockedProps } from "@/ui/presenters/mealprint/MealprintLockedPresenter";
import type { MealprintReviewProps } from "@/ui/presenters/mealprint/MealprintReviewPresenter";
import type { MealprintStateProps } from "@/ui/presenters/mealprint/MealprintStatePresenter";
import type { MealprintWorkingProps } from "@/ui/presenters/mealprint/MealprintWorkingPresenter";
import { MealprintContainer } from "../MealprintContainer";
import {
  generateFailureState,
  saveErrorMessage,
} from "../MealprintDayContainer";
import { suggestFailureState } from "../MealprintOneMealContainer";

type Probe = {
  screen: string | null;
  home: MealprintHomeProps | null;
  ideas: MealprintIdeasProps | null;
  review: MealprintReviewProps | null;
  day: MealprintDayProps | null;
  saved: MealprintSavedProps | null;
  logged: MealprintLoggedProps | null;
  state: MealprintStateProps | null;
  locked: MealprintLockedProps | null;
  working: MealprintWorkingProps | null;
};
const mockProbe: Probe = {
  screen: null,
  home: null,
  ideas: null,
  review: null,
  day: null,
  saved: null,
  logged: null,
  state: null,
  locked: null,
  working: null,
};
function mockProbeAs<K extends keyof Probe>(key: K, name: string) {
  return (p: Probe[K]) => {
    mockProbe.screen = name;
    mockProbe[key] = p;
    return null;
  };
}

jest.mock("@/ui/presenters/mealprint/MealprintHomePresenter", () => ({
  MealprintHomePresenter: (p: MealprintHomeProps) =>
    mockProbeAs("home", `home-${p.tab}`)(p),
}));
jest.mock("@/ui/presenters/mealprint/MealprintIdeasPresenter", () => ({
  MealprintIdeasPresenter: (p: MealprintIdeasProps) =>
    mockProbeAs("ideas", "ideas")(p),
}));
jest.mock("@/ui/presenters/mealprint/MealprintReviewPresenter", () => ({
  MealprintReviewPresenter: (p: MealprintReviewProps) =>
    mockProbeAs("review", "review")(p),
}));
jest.mock("@/ui/presenters/mealprint/MealprintDayPresenter", () => ({
  MealprintDayPresenter: (p: MealprintDayProps) => mockProbeAs("day", "day")(p),
}));
jest.mock("@/ui/presenters/mealprint/MealprintDoneScreens", () => ({
  MealprintSavedPresenter: (p: MealprintSavedProps) =>
    mockProbeAs("saved", "saved")(p),
  MealprintLoggedPresenter: (p: MealprintLoggedProps) =>
    mockProbeAs("logged", "logged")(p),
}));
jest.mock("@/ui/presenters/mealprint/MealprintStatePresenter", () => ({
  MealprintStatePresenter: (p: MealprintStateProps) =>
    mockProbeAs("state", `state-${p.state}`)(p),
}));
jest.mock("@/ui/presenters/mealprint/MealprintLockedPresenter", () => ({
  MealprintLockedPresenter: (p: MealprintLockedProps) =>
    mockProbeAs("locked", "locked")(p),
}));
jest.mock("@/ui/presenters/mealprint/MealprintWorkingPresenter", () => ({
  MealprintWorkingPresenter: (p: MealprintWorkingProps) =>
    mockProbeAs("working", "working")(p),
}));
jest.mock("@/ui/components/PLogoDrawLoader", () => ({
  PLogoDrawLoader: () => {
    mockProbe.screen = "loading";
    return null;
  },
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  __esModule: true,
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    back: () => mockBack(),
    replace: (...a: unknown[]) => mockReplace(...a),
    canGoBack: () => mockCanGoBack,
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(),
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: "s" },
}));
/** Set by a test to send queued Mealprint-day archives to the fake server. */
let mockDrain: (() => Promise<void>) | null = null;
const mockSync = jest.fn(async () => {
  if (mockDrain) await mockDrain();
});
jest.mock("@/application/commands/sync.command", () => ({
  ...jest.requireActual("@/application/commands/sync.command"),
  processSyncQueue: () => mockSync(),
}));
const mockGate = { allowed: true, isResolved: true, onUpgrade: jest.fn() };
jest.mock("@/ui/hooks/useMealprintGate", () => ({
  useMealprintGate: () => mockGate,
}));
let mockOnline = true;
jest.mock("@/ui/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => mockOnline,
}));

const USER = "user-1";
const TODAY = localDayISO();
const MEALS: UserMeal[] = (
  [
    ["um-b", "Breakfast", "breakfast", "breakfast"],
    ["um-pre", "Pre-workout", "snack", null],
    ["um-l", "Lunch", "lunch", "lunch"],
    ["um-d", "Dinner", "dinner", "dinner"],
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
const TARGET: NutritionTarget = {
  userId: USER,
  dailyKcal: 2500,
  proteinG: 180,
  carbsG: 300,
  fatG: 60,
  waterCups: 8,
  preset: "custom",
  setByUserId: null,
  setByName: null,
  updatedAt: "2026-11-20T00:00:00.000Z",
};

const idea = (name: string): MealSuggestion => ({
  name,
  reason: "fits",
  items: [
    {
      candidateId: `food-${name}`,
      kind: "food",
      name: `${name} base`,
      servings: 1,
      servingLabel: "1 × 100 g",
      kcal: 400,
      proteinG: 30,
      carbsG: 40,
      fatG: 10,
      unverified: false,
    },
    {
      candidateId: `recipe-${name}`,
      kind: "recipe",
      name: `${name} sauce`,
      servings: 1,
      servingLabel: "1 × 30 ml",
      kcal: 100,
      proteinG: 1,
      carbsG: 10,
      fatG: 5,
      unverified: false,
    },
  ],
  kcal: 500,
  proteinG: 31,
  carbsG: 50,
  fatG: 15,
  containsUnverified: false,
  partialEnforcementOnly: false,
  cheat: false,
  isOrder: false,
  tag: null,
});

const genMeal = (
  name: string,
  label: string,
  logSlot: PlanGeneratedMeal["logSlot"],
  over: Partial<PlanGeneratedMeal> = {},
): PlanGeneratedMeal => ({
  name,
  reason: "fits",
  label,
  logSlot,
  items: [
    {
      candidateId: `food-${name}`,
      kind: "food",
      servings: 1,
      name: `${name} food`,
      kcal: 600,
      proteinG: 40,
      carbsG: 70,
      fatG: 15,
    },
  ],
  kcal: 600,
  proteinG: 40,
  carbsG: 70,
  fatG: 15,
  containsUnverified: false,
  flaggedUnsafe: false,
  ...over,
});

const swapMeal = (name: string, kcal: number): PlanSwapMeal => ({
  name,
  reason: "swap",
  logSlot: "lunch",
  items: [
    {
      candidateId: `food-${name}`,
      kind: "food",
      servings: 1,
      name: `${name} food`,
      kcal,
      proteinG: 40,
      carbsG: 60,
      fatG: 12,
    },
  ],
  kcal,
  proteinG: 40,
  carbsG: 60,
  fatG: 12,
  containsUnverified: false,
});

const entry = (
  id: string,
  over: Partial<NutritionEntry> = {},
): NutritionEntry => ({
  id,
  userId: USER,
  foodId: "food-x",
  recipeId: null,
  mealId: null,
  mealSlot: "breakfast",
  servings: 1,
  kcal: 300,
  proteinG: 20,
  carbsG: 30,
  fatG: 10,
  loggedAt: `${TODAY}T08:00:00.000Z`,
  loggedByUserId: null,
  aiEstimated: false,
  aiConfidence: null,
  customName: "Toast",
  userMealId: "um-b",
  ...over,
});

function setup() {
  const api = new InMemoryApiAdapter();
  api.userMeals = MEALS;
  api.nutritionTarget = TARGET;
  const storage = new InMemoryStorageAdapter();
  void storage.initialize();
  storage.cacheUserMeals(USER, MEALS);
  storage.cacheNutritionTarget(USER, TARGET);
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
  const view = renderWithTheme(
    <AdapterProvider adapters={adapters}>
      <MealprintContainer />
    </AdapterProvider>,
  );
  return { api, storage, view };
}

/** Queued archives of the accepted day, sent the way the sync queue would. */
function sendArchives(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
) {
  mockDrain = async () => {
    for (const e of storage.getPendingMutations()) {
      if (e.entityType !== MEALPRINT_DAY_ARCHIVE_ENTITY) continue;
      await api.patchPlan(e.entityId!, { status: "archived" });
      storage.markMutationCompleted(e.id);
    }
  };
}

/** No active dated day left for today: not cached, not on the server. */
function noTodaysPlan(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
  id: string,
) {
  expect(storage.getCachedActiveMealPlan(USER, TODAY)).toBeNull();
  expect(api.plans.get(id)!.status).toBe("archived");
}

beforeEach(() => {
  for (const k of Object.keys(mockProbe)) {
    (mockProbe as Record<string, unknown>)[k] = null;
  }
  mockPush.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
  mockSync.mockClear();
  mockDrain = null;
  mockGate.allowed = true;
  mockGate.isResolved = true;
  mockGate.onUpgrade.mockClear();
  mockOnline = true;
  mockCanGoBack = true;
  mockParams = {};
  usePlanFlow.getState().reset();
  usePlanSheets.setState({ selectedPlanId: null, fuelSection: null });
  act(() => {
    useFuelSheets.getState().close();
    useFuelSheets.getState().setDate(TODAY);
  });
});

// -- Shell -----------------------------------------------------------------------

describe("MealprintContainer — the shell", () => {
  it("without Premium+ it is the locked page (N26)", () => {
    mockGate.allowed = false;
    setup();
    expect(mockProbe.screen).toBe("locked");
    act(() => mockProbe.locked!.onUpgrade());
    expect(mockGate.onUpgrade).toHaveBeenCalled();
    act(() => mockProbe.locked!.onBack());
    expect(mockBack).toHaveBeenCalled();
  });

  it("waits for the plan, or says offline when it can't find out", () => {
    mockGate.isResolved = false;
    const first = setup();
    expect(mockProbe.screen).toBe("loading");
    first.view.unmount();
    mockOnline = false;
    setup();
    expect(mockProbe.screen).toBe("state-offline");
    mockCanGoBack = false;
    act(() => mockProbe.state!.onSecondary());
    expect(mockReplace).toHaveBeenCalledWith("/(app)/(tabs)/fuel");
  });

  it("opens on the tab it was asked for and switches tabs", async () => {
    mockParams = { mode: "day" };
    setup();
    await waitFor(() => expect(mockProbe.screen).toBe("home-day"));
    act(() => mockProbe.home!.onTab("meal"));
    await waitFor(() => expect(mockProbe.screen).toBe("home-meal"));
  });

  it("offline, each tab shows the offline state", () => {
    mockOnline = false;
    const r = setup();
    expect(mockProbe.screen).toBe("state-offline");
    r.view.unmount();
    mockParams = { mode: "day" };
    setup();
    expect(mockProbe.screen).toBe("state-offline");
  });
});

// -- One meal --------------------------------------------------------------------

describe("Mealprint One meal (N15 → N17 → N18)", () => {
  it("asks, lists ideas, reviews and logs the ticked items into the chosen meal", async () => {
    mockParams = { mode: "meal", slot: "snack", userMealId: "um-pre" };
    const { api, storage } = setup();
    api.mealSuggestResult = {
      suggestions: [idea("Bowl"), idea("Wrap")],
      emptyReason: null,
      remaining: { kcal: 1900, proteinG: 140, carbsG: 250, fatG: 40 },
      containsUnverified: false,
      partialEnforcementOnly: false,
      labelCheckRequired: true,
    };
    await waitFor(() =>
      expect(mockProbe.home?.meal?.left).toEqual({
        kcal: 2500,
        proteinG: 180,
        carbsG: 300,
        fatG: 60,
      }),
    );
    expect(mockProbe.home!.meal!.leftLabel).toBe("Left today");
    act(() => mockProbe.home!.meal!.onShape("meal"));
    act(() => mockProbe.home!.onSteer("something warm"));
    await act(async () => mockProbe.home!.onSubmit());
    await waitFor(() => expect(mockProbe.screen).toBe("ideas"));
    expect(api.suggestMealsCalls[0]).toMatchObject({
      shape: "meal",
      steer: "something warm",
      occasion: "on_plan",
      date: TODAY,
      notWantedMeals: [],
    });
    expect(mockProbe.ideas!.ideas.map((i) => i.name)).toEqual(["Bowl", "Wrap"]);

    // Show me something else excludes what was shown.
    await act(async () => mockProbe.ideas!.onMore());
    await waitFor(() => expect(api.suggestMealsCalls).toHaveLength(2));
    expect(
      api.suggestMealsCalls[1]!.notWantedMeals!.map((m) => m.name),
    ).toEqual(["Bowl", "Wrap"]);
    await waitFor(() => expect(mockProbe.screen).toBe("ideas"));

    act(() => mockProbe.ideas!.onSelect(0));
    expect(mockProbe.screen).toBe("review");
    expect(mockProbe.review!.logToName).toBe("Pre-workout");
    act(() => mockProbe.review!.onToggleItem(1));
    expect(mockProbe.review!.totals.kcal).toBe(400);
    act(() => mockProbe.review!.onOpenLogTo());
    expect(mockProbe.review!.logToOpen).toBe(true);
    act(() => mockProbe.review!.onPickLogTo("um-l"));
    expect(mockProbe.review!.logToName).toBe("Lunch");
    await act(async () => mockProbe.review!.onLog());
    expect(mockProbe.review!.added).toBe(true);
    const logged = flattenFuelEntries(storage.getCachedFuelToday(USER, TODAY)!);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      foodId: "food-Bowl",
      mealSlot: "lunch",
      userMealId: "um-l",
      customName: "Bowl base",
    });
    expect(mockSync).toHaveBeenCalled();
    await waitFor(() => expect(mockBack).toHaveBeenCalled(), { timeout: 2000 });
  });

  it("back from review goes to ideas, back from ideas to the start; cheat meal sends either", async () => {
    mockParams = { mode: "meal" };
    const { api } = setup();
    api.mealSuggestResult = {
      ...api.mealSuggestResult,
      suggestions: [idea("Bowl")],
      emptyReason: null,
    };
    await waitFor(() => expect(mockProbe.screen).toBe("home-meal"));
    act(() => mockProbe.home!.meal!.onOccasion("cheat_meal"));
    await act(async () => mockProbe.home!.onSubmit());
    await waitFor(() => expect(mockProbe.screen).toBe("ideas"));
    expect(api.suggestMealsCalls[0]).toMatchObject({
      shape: "either",
      occasion: "cheat_meal",
    });
    act(() => mockProbe.ideas!.onSelect(0));
    act(() => mockProbe.review!.onBackToIdeas());
    expect(mockProbe.screen).toBe("ideas");
    act(() => mockProbe.ideas!.onPreferences());
    expect(mockPush).toHaveBeenCalledWith(
      "/(app)/fuel/preferences?mode=editor",
    );
    act(() => mockProbe.ideas!.onBack());
    expect(mockProbe.screen).toBe("home-meal");
  });

  it("a steer over 200 characters is refused by the form", async () => {
    mockParams = { mode: "meal" };
    const { api } = setup();
    await waitFor(() => expect(mockProbe.screen).toBe("home-meal"));
    act(() => mockProbe.home!.onSteer("x".repeat(201)));
    await act(async () => mockProbe.home!.onSubmit());
    await waitFor(() => expect(mockProbe.home!.steerError).toMatch(/200/));
    expect(api.suggestMealsCalls).toHaveLength(0);
  });

  it.each([
    [429, "state-cap"],
    [422, "state-none"],
    [503, "state-down"],
  ])("a %s answer shows %s", async (status, screen) => {
    mockParams = { mode: "meal" };
    const { api } = setup();
    api.nextMealSuggestError = { status, message: "x" };
    await waitFor(() => expect(mockProbe.screen).toBe("home-meal"));
    await act(async () => mockProbe.home!.onSubmit());
    await waitFor(() => expect(mockProbe.screen).toBe(screen));
    if (screen === "state-down") {
      api.nextMealSuggestError = null;
      api.mealSuggestResult = {
        ...api.mealSuggestResult,
        suggestions: [idea("Bowl")],
        emptyReason: null,
      };
      await act(async () => mockProbe.state!.onPrimary());
      await waitFor(() => expect(mockProbe.screen).toBe("ideas"));
    } else {
      act(() => mockProbe.state!.onPrimary());
      expect(mockProbe.screen).toBe("home-meal");
    }
  });

  it("a 402 shows the locked page", async () => {
    mockParams = { mode: "meal" };
    const { api } = setup();
    api.nextMealSuggestError = { status: 402, message: "x" };
    await waitFor(() => expect(mockProbe.screen).toBe("home-meal"));
    await act(async () => mockProbe.home!.onSubmit());
    await waitFor(() => expect(mockProbe.screen).toBe("locked"));
  });

  it.each([
    ["no_targets", "state-no_target"],
    ["budget_exhausted", "state-full"],
    ["no_candidates", "state-none"],
  ] as const)("an empty answer (%s) shows %s", async (reason, screen) => {
    mockParams = { mode: "meal" };
    const { api } = setup();
    api.mealSuggestResult = {
      ...api.mealSuggestResult,
      suggestions: [],
      emptyReason: reason,
    };
    await waitFor(() => expect(mockProbe.screen).toBe("home-meal"));
    await act(async () => mockProbe.home!.onSubmit());
    await waitFor(() => expect(mockProbe.screen).toBe(screen));
    act(() => mockProbe.state!.onBack());
    expect(mockProbe.screen).toBe("home-meal");
  });

  it("picks failure states by status", () => {
    expect(suggestFailureState({ status: 429 })).toBe("cap");
    expect(suggestFailureState({ status: 422 })).toBe("none");
    expect(suggestFailureState({ status: undefined })).toBe("down");
  });
});

// -- Whole day ---------------------------------------------------------------------

function dayResult(meals: PlanGeneratedMeal[]) {
  return {
    meals,
    mealsPerDay: meals.length,
    emptyReason: null,
    target: { kcal: 2500, proteinG: 180, carbsG: 300, fatG: 60 },
    totals: { kcal: 1200, proteinG: 80, carbsG: 140, fatG: 30 },
    withinTolerance: true,
    labelCheckRequired: true,
  };
}

async function openDay(meals: PlanGeneratedMeal[]) {
  mockParams = { mode: "day" };
  const env = setup();
  env.api.planGenerateResult = dayResult(meals);
  await waitFor(() => expect(mockProbe.screen).toBe("home-day"));
  return env;
}

async function generateDay(meals: PlanGeneratedMeal[]) {
  const env = await openDay(meals);
  await act(async () => mockProbe.home!.onSubmit());
  await waitFor(() => expect(mockProbe.screen).toBe("day"));
  return env;
}

const idOf = (slot: string) =>
  mockProbe.day!.meals.find((m) => m.slot === slot)!.localId;

describe("Mealprint Whole day (N15 → N19/N20)", () => {
  it("N15 shows the target, Your meals and cooking; generates from Your meals", async () => {
    const { api } = await openDay([genMeal("Oats", "Breakfast", "breakfast")]);
    const day = mockProbe.home!.day!;
    expect(day.target).toEqual({
      kcal: 2500,
      proteinG: 180,
      carbsG: 300,
      fatG: 60,
    });
    expect(day.mealsText).toBe("Breakfast, Pre-workout, Lunch, Dinner");
    act(() => day.onOpenEffort());
    expect(mockProbe.home!.day!.effortSheetOpen).toBe(true);
    act(() => mockProbe.home!.day!.onPickEffort("quick"));
    expect(mockProbe.home!.day!.effortLevel).toBe("quick");
    act(() => mockProbe.home!.day!.onEditMeals());
    expect(useFuelSheets.getState().sheet).toBe("yourMeals");
    act(() => useFuelSheets.getState().close());
    act(() => mockProbe.home!.onSteer("light dinner"));
    await act(async () => mockProbe.home!.onSubmit());
    await waitFor(() => expect(mockProbe.screen).toBe("day"));
    expect(api.generatePlanCalls[0]).toMatchObject({
      planDate: TODAY,
      effortLevel: "quick",
      steer: "light dinner",
      meals: [
        { name: "Breakfast", logSlot: "breakfast" },
        { name: "Pre-workout", logSlot: "snack" },
        { name: "Lunch", logSlot: "lunch" },
        { name: "Dinner", logSlot: "dinner" },
      ],
    });
    expect(api.generatePlanCalls[0]!.mealsPerDay).toBeUndefined();
    expect(mockProbe.day!.meals[0]).toMatchObject({
      slot: "Breakfast",
      name: "Oats",
      portionLabel: "×1",
    });
  });

  it("swap: 3 options, Show 3 others excludes them, feedback goes in steer, pick and Undo", async () => {
    const { api } = await generateDay([
      genMeal("Oats", "Breakfast", "breakfast"),
      genMeal("Bowl", "Lunch", "lunch"),
    ]);
    api.planSwapResult = {
      meal: swapMeal("Chilli", 612),
      options: [
        swapMeal("Chilli", 612),
        swapMeal("Cod", 540),
        swapMeal("Tikka", 700),
      ],
      emptyReason: null,
      labelCheckRequired: true,
    };
    const lunch = idOf("Lunch");
    await act(async () => mockProbe.day!.onSwap(lunch));
    await waitFor(() => expect(mockProbe.day!.swap?.options).toHaveLength(3));
    expect(api.swapPlanMealCalls[0]).toMatchObject({
      count: 3,
      logSlot: "lunch",
      heldTotals: { kcal: 600 },
      notWantedMeals: [{ name: "Bowl", ingredients: ["Bowl food"] }],
    });
    expect(mockProbe.day!.swap!.options[0]).toMatchObject({
      delta: "+12 kcal",
      deltaQuiet: true,
    });
    expect(mockProbe.day!.swap!.options[1]).toMatchObject({
      delta: "−60 kcal",
      deltaQuiet: false,
    });
    expect(mockProbe.day!.blockedLabel).toBe(
      "Pick a replacement or keep the meal",
    );

    await act(async () => mockProbe.day!.swap!.onMore());
    await waitFor(() => expect(api.swapPlanMealCalls).toHaveLength(2));
    expect(
      api.swapPlanMealCalls[1]!.notWantedMeals!.map((m) => m.name),
    ).toEqual(["Bowl", "Chilli", "Cod", "Tikka"]);

    act(() => mockProbe.day!.swap!.onChip("High protein"));
    act(() => mockProbe.day!.swap!.onFeedback("no rice"));
    await act(async () => mockProbe.day!.swap!.onSend());
    await waitFor(() => expect(api.swapPlanMealCalls).toHaveLength(3));
    expect(api.swapPlanMealCalls[2]!.steer).toBe("High protein, no rice");
    await waitFor(() =>
      expect(mockProbe.day!.swap!.sentFor).toBe("High protein, no rice"),
    );

    await waitFor(() => expect(mockProbe.day!.swap!.loading).toBe(false));
    act(() => mockProbe.day!.swap!.onPick(1));
    expect(mockProbe.day!.swap).toBeNull();
    const swapped = mockProbe.day!.meals.find((m) => m.localId === lunch)!;
    expect(swapped).toMatchObject({
      name: "Cod",
      swapped: true,
      slot: "Lunch",
    });

    act(() => mockProbe.day!.onUndo(lunch));
    expect(mockProbe.day!.meals.find((m) => m.localId === lunch)!.name).toBe(
      "Bowl",
    );
  });

  it("swap with nothing back says so; a failure shows its message; tapping Swap again closes", async () => {
    const { api } = await generateDay([genMeal("Bowl", "Lunch", "lunch")]);
    const lunch = idOf("Lunch");
    api.planSwapResult = {
      meal: null,
      options: [],
      emptyReason: "no_candidates",
      labelCheckRequired: true,
    };
    await act(async () => mockProbe.day!.onSwap(lunch));
    await waitFor(() =>
      expect(mockProbe.day!.swap!.error).toBe(
        "No replacement matched. Try different feedback.",
      ),
    );
    api.nextPlanSwapError = { status: 429, message: "x" };
    await act(async () => mockProbe.day!.swap!.onMore());
    await waitFor(() =>
      expect(mockProbe.day!.swap!.error).toMatch(/today's swaps/),
    );
    act(() => mockProbe.day!.onSwap(lunch));
    expect(mockProbe.day!.swap).toBeNull();
  });

  it("an older server without options still offers its one meal", async () => {
    const { api } = await generateDay([genMeal("Bowl", "Lunch", "lunch")]);
    api.planSwapResult = {
      meal: swapMeal("Chilli", 612),
      emptyReason: null,
      labelCheckRequired: true,
    };
    await act(async () => mockProbe.day!.onSwap(idOf("Lunch")));
    await waitFor(() => expect(mockProbe.day!.swap!.options).toHaveLength(1));
    act(() => mockProbe.day!.swap!.onClose());
    expect(mockProbe.day!.swap).toBeNull();
  });

  it("portion stepper, Remove, and a flagged meal blocking the way out", async () => {
    await generateDay([
      genMeal("Oats", "Breakfast", "breakfast"),
      genMeal("Bowl", "Lunch", "lunch", { flaggedUnsafe: true }),
    ]);
    expect(mockProbe.day!.blockedLabel).toBe(
      "Swap the flagged meal to continue",
    );
    expect(mockProbe.day!.swap).toBeNull();
    const oats = idOf("Breakfast");
    act(() => mockProbe.day!.onTapMeal(oats));
    expect(mockProbe.day!.openId).toBe(oats);
    act(() => mockProbe.day!.onMore(oats));
    let row = mockProbe.day!.meals.find((m) => m.localId === oats)!;
    expect(row).toMatchObject({ portionLabel: "×1.25", kcal: 750 });
    act(() => mockProbe.day!.onLess(oats));
    row = mockProbe.day!.meals.find((m) => m.localId === oats)!;
    expect(row.portionLabel).toBe("×1");
    act(() => mockProbe.day!.onTapMeal(oats));
    expect(mockProbe.day!.openId).toBeNull();
    act(() => mockProbe.day!.onRemove(idOf("Lunch")));
    expect(mockProbe.day!.meals).toHaveLength(1);
    expect(mockProbe.day!.blockedLabel).toBeNull();
    act(() => mockProbe.day!.onRemove(oats));
    expect(mockProbe.day!.blockedLabel).toBe("Every meal was removed");
  });

  it("generate failures and empty answers show their states", async () => {
    const { api } = await openDay([]);
    api.nextPlanGenerateError = { status: 503, message: "x" };
    await act(async () => mockProbe.home!.onSubmit());
    await waitFor(() => expect(mockProbe.screen).toBe("state-down"));
    api.nextPlanGenerateError = null;
    api.planGenerateResult = {
      ...dayResult([]),
      emptyReason: "no_targets",
      target: null,
    };
    await act(async () => mockProbe.state!.onPrimary());
    await waitFor(() => expect(mockProbe.screen).toBe("state-no_target"));
    act(() => mockProbe.state!.onBack());
    await waitFor(() => expect(mockProbe.screen).toBe("home-day"));
    api.nextPlanGenerateError = { status: 402, message: "x" };
    await act(async () => mockProbe.home!.onSubmit());
    await waitFor(() => expect(mockProbe.screen).toBe("locked"));
  });

  it("maps generate and save failures to words", () => {
    expect(generateFailureState(429)).toBe("cap");
    expect(generateFailureState(422)).toBe("none");
    expect(generateFailureState(500)).toBe("down");
    expect(saveErrorMessage(403)).toMatch(/Premium/);
    expect(saveErrorMessage(409)).toMatch(/can't be saved/);
    expect(saveErrorMessage(undefined)).toMatch(/connection/);
  });
});

describe("Mealprint Whole day — Save as a plan (N21)", () => {
  it("accepts the day, saves it as a list plan, archives the dated day, then View in Plan", async () => {
    const { api, storage } = await generateDay([
      genMeal("Oats", "Breakfast", "breakfast"),
      genMeal("Bowl", "Lunch", "lunch"),
    ]);
    await act(async () => mockProbe.day!.onSave());
    await waitFor(() => expect(mockProbe.screen).toBe("saved"));
    expect(api.acceptPlanCalls[0]!.meals.map((m) => m.label)).toEqual([
      "Breakfast",
      "Lunch",
    ]);
    expect(api.mealprintSaves).toEqual([
      {
        input: { fromMealprintPlanId: "plan-1" },
        key: "mealprint-save-plan-1",
      },
    ]);
    // The archive is queued; the cached dated day is gone at once.
    expect(storage.getCachedActiveMealPlan(USER, TODAY)).toBeNull();
    expect(
      storage
        .getPendingMutations()
        .filter((m) => m.entityType === MEALPRINT_DAY_ARCHIVE_ENTITY)
        .map((m) => [m.method, m.endpoint]),
    ).toEqual([["PATCH", "/nutrition/plans/plan-1"]]);
    expect(
      storage.getCachedNutritionPlans(USER)!.mine.map((p) => p.id),
    ).toEqual(["plan-from-plan-1"]);
    expect(mockProbe.saved).toMatchObject({ name: "Mealprint", mealCount: 2 });

    // Rename on the saved screen queues an edit of the plan.
    act(() => mockProbe.saved!.onName("Training day"));
    await act(async () => mockProbe.saved!.onNameDone());
    await waitFor(() => expect(mockProbe.saved!.name).toBe("Training day"));
    expect(
      storage
        .getPendingMutations()
        .some(
          (m) => m.method === "PUT" && m.endpoint.includes("plan-from-plan-1"),
        ),
    ).toBe(true);
    expect(storage.getCachedNutritionPlans(USER)!.mine[0]!.name).toBe(
      "Training day",
    );

    act(() => mockProbe.saved!.onViewInPlan());
    expect(usePlanSheets.getState()).toMatchObject({
      selectedPlanId: "plan-from-plan-1",
      fuelSection: "plan",
    });
    expect(mockBack).toHaveBeenCalled();
  });

  it("an empty name is refused", async () => {
    await generateDay([genMeal("Oats", "Breakfast", "breakfast")]);
    await act(async () => mockProbe.day!.onSave());
    await waitFor(() => expect(mockProbe.screen).toBe("saved"));
    act(() => mockProbe.saved!.onName("  "));
    await act(async () => mockProbe.saved!.onNameDone());
    await waitFor(() => expect(mockProbe.saved!.nameError).toBeTruthy());
  });

  it("Add to shopping list saves the plan and adds it; on N21 it opens the list", async () => {
    const { api, storage } = await generateDay([
      genMeal("Oats", "Breakfast", "breakfast"),
    ]);
    await act(async () => mockProbe.day!.onShoppingList());
    await waitFor(() => expect(mockProbe.screen).toBe("saved"));
    expect(api.mealprintSaves).toHaveLength(1);
    await waitFor(() => expect(mockProbe.saved!.inShoppingList).toBe(true));
    expect(
      storage
        .getCachedPlansShopping(USER)!
        .list!.plans.map((p) => p.nutritionPlanId),
    ).toEqual(["plan-from-plan-1"]);
    act(() => mockProbe.saved!.onShoppingList());
    expect(mockPush).toHaveBeenCalledWith("/(app)/fuel/plans-shopping");
  });

  it("N21 Add to shopping list adds then opens the list", async () => {
    await generateDay([genMeal("Oats", "Breakfast", "breakfast")]);
    await act(async () => mockProbe.day!.onSave());
    await waitFor(() => expect(mockProbe.screen).toBe("saved"));
    await act(async () => mockProbe.saved!.onShoppingList());
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/(app)/fuel/plans-shopping"),
    );
    act(() => mockProbe.saved!.onClose());
    expect(mockBack).toHaveBeenCalled();
  });

  it("a failed save keeps the accepted day and retries with the same key", async () => {
    const { api } = await generateDay([
      genMeal("Oats", "Breakfast", "breakfast"),
    ]);
    api.mealprintSaveFailures.push({
      kind: "api",
      code: "server",
      status: 409,
      message: "x",
    });
    await act(async () => mockProbe.day!.onSave());
    await waitFor(() =>
      expect(mockProbe.day!.errorMessage).toBe(saveErrorMessage(409)),
    );
    await act(async () => mockProbe.day!.onSave());
    await waitFor(() => expect(mockProbe.screen).toBe("saved"));
    expect(api.acceptPlanCalls).toHaveLength(1);
    expect(api.mealprintSaves.map((s) => s.key)).toEqual([
      "mealprint-save-plan-1",
      "mealprint-save-plan-1",
    ]);
  });

  it("an edit after a failed save drops the stale accepted day, cached and on the server", async () => {
    const { api, storage } = await generateDay([
      genMeal("Oats", "Breakfast", "breakfast"),
    ]);
    sendArchives(api, storage);
    api.mealprintSaveFailures.push({
      kind: "api",
      code: "network",
      message: "x",
    });
    await act(async () => mockProbe.day!.onSave());
    await waitFor(() => expect(mockProbe.day!.errorMessage).toBeTruthy());
    expect(storage.getCachedActiveMealPlan(USER, TODAY)!.id).toBe("plan-1");
    act(() => mockProbe.day!.onMore(idOf("Breakfast")));
    await waitFor(() => noTodaysPlan(api, storage, "plan-1"));
    await act(async () => mockProbe.day!.onSave());
    await waitFor(() => expect(mockProbe.screen).toBe("saved"));
    expect(api.acceptPlanCalls).toHaveLength(2);
  });

  it("today already has a Mealprint plan: Replace it archives that one and saves", async () => {
    const { api } = await generateDay([
      genMeal("Oats", "Breakfast", "breakfast"),
    ]);
    const old = {
      id: "old-plan",
      userId: USER,
      status: "active" as const,
      planDate: TODAY,
      groupId: null,
      mealsPerDay: 1,
      effortLevel: "balanced" as const,
      targetKcal: 2500,
      targetProteinG: 180,
      targetCarbsG: 300,
      targetFatG: 60,
      source: "ai",
      createdByUserId: null,
      createdAt: null,
      acceptedAt: null,
      meals: [],
    };
    api.plans.set("old-plan", old);
    api.activePlanByDate.set(TODAY, old);
    api.nextAcceptPlanError = {
      kind: "api",
      code: "server",
      status: 409,
      message: "exists",
      planErrorCode: "active_plan_exists",
      activePlanDate: TODAY,
    };
    await act(async () => mockProbe.day!.onSave());
    await waitFor(() =>
      expect(mockProbe.day!.errorMessage).toBe(
        "You already have a Mealprint plan for today.",
      ),
    );
    expect(mockProbe.day!.errorAction!.label).toBe("Replace it");
    api.nextAcceptPlanError = null;
    await act(async () => mockProbe.day!.errorAction!.onPress());
    await waitFor(() => expect(mockProbe.screen).toBe("saved"));
    expect(api.plans.get("old-plan")!.status).toBe("archived");
  });

  it.each([
    ["unresolvable_items", /no longer available/],
    ["avoidance_violation", /preferences changed/],
    ["portion_violation", /too large/],
  ] as const)("an accept failure (%s) is explained", async (code, text) => {
    const { api } = await generateDay([
      genMeal("Oats", "Breakfast", "breakfast"),
    ]);
    api.nextAcceptPlanError = {
      kind: "api",
      code: "server",
      status: 400,
      message: "x",
      planErrorCode: code,
      unresolvableItems: ["food:food-Oats"],
    };
    await act(async () => mockProbe.day!.onSave());
    await waitFor(() => expect(mockProbe.day!.errorMessage).toMatch(text));
    if (code === "unresolvable_items") {
      expect(mockProbe.day!.meals[0]!.flagged).toBe(true);
    }
    if (code === "avoidance_violation") {
      act(() => mockProbe.day!.errorAction!.onPress());
      await waitFor(() => expect(mockProbe.screen).toBe("home-day"));
    }
  });
});

describe("Mealprint Whole day — Log all today (N22)", () => {
  it("logs meals without food, skips the rest, and Undo takes them off", async () => {
    const { storage } = await openDay([
      genMeal("Oats", "Breakfast", "breakfast"),
      genMeal("Bowl", "Lunch", "lunch"),
      genMeal("Stew", "Dinner", "dinner"),
    ]);
    storage.cacheFuelToday(USER, TODAY, {
      date: TODAY,
      targets: TARGET,
      consumed: { kcal: 300, proteinG: 20, carbsG: 30, fatG: 10, waterCups: 0 },
      remainingKcal: 2200,
      entriesBySlot: {
        breakfast: [entry("e-toast")],
        lunch: [],
        snack: [],
        dinner: [],
      },
    });
    await act(async () => mockProbe.home!.onSubmit());
    await waitFor(() => expect(mockProbe.screen).toBe("day"));
    await act(async () => mockProbe.day!.onLogAll());
    await waitFor(() => expect(mockProbe.screen).toBe("logged"));
    expect(mockProbe.logged).toMatchObject({
      loggedCount: 2,
      skippedNames: "Breakfast",
      eatenKcal: 1500,
      targetKcal: 2500,
    });
    expect(mockProbe.logged!.rows[0]).toMatchObject({
      mealName: "Breakfast",
      detail: "Skipped · already has food",
      kcal: null,
    });
    const after = flattenFuelEntries(storage.getCachedFuelToday(USER, TODAY)!);
    expect(after.map((e) => e.userMealId).sort()).toEqual([
      "um-b",
      "um-d",
      "um-l",
    ]);
    expect(mockSync).toHaveBeenCalled();

    await act(async () => mockProbe.logged!.onUndo());
    expect(mockProbe.logged!.undone).toBe(true);
    const undone = flattenFuelEntries(storage.getCachedFuelToday(USER, TODAY)!);
    expect(undone.map((e) => e.id)).toEqual(["e-toast"]);

    act(() => mockProbe.logged!.onViewInLog());
    expect(usePlanSheets.getState().fuelSection).toBe("log");
    expect(mockBack).toHaveBeenCalled();
  });

  it("when every meal already has food there's nothing to log", async () => {
    const { storage } = await openDay([
      genMeal("Oats", "Breakfast", "breakfast"),
    ]);
    storage.cacheFuelToday(USER, TODAY, {
      date: TODAY,
      targets: null,
      consumed: { kcal: 300, proteinG: 20, carbsG: 30, fatG: 10, waterCups: 0 },
      remainingKcal: 0,
      entriesBySlot: {
        breakfast: [entry("e-toast")],
        lunch: [],
        snack: [],
        dinner: [],
      },
    });
    await act(async () => mockProbe.home!.onSubmit());
    await waitFor(() => expect(mockProbe.screen).toBe("day"));
    await act(async () => mockProbe.day!.onLogAll());
    expect(mockProbe.screen).toBe("day");
    expect(mockProbe.day!.errorMessage).toMatch(/nothing to log/);
  });

  it("offline in the builder: busy, with a line saying so", async () => {
    await generateDay([genMeal("Oats", "Breakfast", "breakfast")]);
    mockOnline = false;
    act(() => mockProbe.day!.onTapMeal(idOf("Breakfast")));
    expect(mockProbe.day!.busy).toBe(true);
    expect(mockProbe.day!.errorMessage).toMatch(/offline/);
  });

  it("a failed drain after Log all and Undo is logged, not shown", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await generateDay([genMeal("Bowl", "Lunch", "lunch")]);
    mockSync.mockRejectedValueOnce(new Error("offline"));
    await act(async () => mockProbe.day!.onLogAll());
    await waitFor(() => expect(mockProbe.screen).toBe("logged"));
    mockSync.mockRejectedValueOnce(new Error("offline"));
    await act(async () => mockProbe.logged!.onUndo());
    expect(mockProbe.logged!.undone).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

describe("Mealprint — the edges", () => {
  it("Whole day: preferences, closing the cooking sheet, a chip off again, and the daily limit", async () => {
    const { api } = await openDay([genMeal("Bowl", "Lunch", "lunch")]);
    act(() => mockProbe.home!.onPreferences());
    expect(mockPush).toHaveBeenCalledWith(
      "/(app)/fuel/preferences?mode=editor",
    );
    act(() => mockProbe.home!.day!.onOpenEffort());
    act(() => mockProbe.home!.day!.onCloseEffort());
    expect(mockProbe.home!.day!.effortSheetOpen).toBe(false);

    await act(async () => mockProbe.home!.onSubmit());
    await waitFor(() => expect(mockProbe.screen).toBe("day"));
    api.planSwapResult = {
      meal: swapMeal("Chilli", 600),
      options: [swapMeal("Chilli", 600)],
      emptyReason: null,
      labelCheckRequired: true,
    };
    await act(async () => mockProbe.day!.onSwap(idOf("Lunch")));
    await waitFor(() => expect(mockProbe.day!.swap?.options).toHaveLength(1));
    act(() => mockProbe.day!.swap!.onChip("Lighter"));
    act(() => mockProbe.day!.swap!.onChip("Lighter"));
    expect(mockProbe.day!.swap!.chips.every((c) => !c.on)).toBe(true);
    // Tapping a meal while a swap is open does nothing.
    act(() => mockProbe.day!.onTapMeal(idOf("Lunch")));
    expect(mockProbe.day!.openId).toBeNull();
    act(() => mockProbe.day!.swap!.onClose());

    act(() => mockProbe.day!.onBack());
    expect(mockBack).toHaveBeenCalled();
  });

  it("Whole day: a 429 shows the daily limit and its button goes back", async () => {
    const { api } = await openDay([]);
    api.nextPlanGenerateError = { status: 429, message: "x" };
    await act(async () => mockProbe.home!.onSubmit());
    await waitFor(() => expect(mockProbe.screen).toBe("state-cap"));
    act(() => mockProbe.state!.onPrimary());
    await waitFor(() => expect(mockProbe.screen).toBe("home-day"));
  });

  it("Whole day: the swap search fills up at 20 meals left out", async () => {
    const { api } = await generateDay([genMeal("Bowl", "Lunch", "lunch")]);
    const many = Array.from({ length: 10 }, (_, i) => swapMeal(`M${i}`, 600));
    api.planSwapResult = {
      meal: many[0]!,
      options: many,
      emptyReason: null,
      labelCheckRequired: true,
    };
    await act(async () => mockProbe.day!.onSwap(idOf("Lunch")));
    await waitFor(() => expect(mockProbe.day!.swap?.options).toHaveLength(10));
    await act(async () => mockProbe.day!.swap!.onMore());
    await waitFor(() => expect(mockProbe.day!.swap!.options).toHaveLength(10));
    api.planSwapResult = {
      ...api.planSwapResult,
      options: Array.from({ length: 10 }, (_, i) => swapMeal(`N${i}`, 600)),
    };
    await act(async () => mockProbe.day!.swap!.onMore());
    await waitFor(() =>
      expect(mockProbe.day!.swap!.options[0]!.name).toBe("N0"),
    );
    await act(async () => mockProbe.day!.swap!.onMore());
    await waitFor(() =>
      expect(mockProbe.day!.swap!.error).toMatch(/replacement limit/),
    );
  });

  it("One meal: the search fills up; Log to sheet closes; a failed drain is only logged", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockParams = { mode: "meal" };
    const { api } = setup();
    api.mealSuggestResult = {
      ...api.mealSuggestResult,
      suggestions: Array.from({ length: 11 }, (_, i) => idea(`I${i}`)),
      emptyReason: null,
    };
    await waitFor(() => expect(mockProbe.screen).toBe("home-meal"));
    await act(async () => mockProbe.home!.onSubmit());
    await waitFor(() => expect(mockProbe.screen).toBe("ideas"));
    api.mealSuggestResult = {
      ...api.mealSuggestResult,
      suggestions: Array.from({ length: 11 }, (_, i) => idea(`J${i}`)),
    };
    await act(async () => mockProbe.ideas!.onMore());
    await waitFor(() => expect(api.suggestMealsCalls).toHaveLength(2));
    await waitFor(() => expect(mockProbe.ideas?.ideas[0]?.name).toBe("J0"));
    await act(async () => mockProbe.ideas!.onMore());
    await waitFor(() => expect(mockProbe.ideas!.notice).toMatch(/limit/));
    expect(api.suggestMealsCalls).toHaveLength(2);

    act(() => mockProbe.ideas!.onSelect(0));
    act(() => mockProbe.review!.onOpenLogTo());
    act(() => mockProbe.review!.onCloseLogTo());
    expect(mockProbe.review!.logToOpen).toBe(false);
    mockSync.mockRejectedValueOnce(new Error("offline"));
    await act(async () => mockProbe.review!.onLog());
    expect(mockProbe.review!.added).toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("Mealprint Whole day — the accepted day never lingers (Inspector Brad #579)", () => {
  const failSave = (api: InMemoryApiAdapter) =>
    api.mealprintSaveFailures.push({
      kind: "api",
      code: "server",
      status: 409,
      message: "plan_meal_nutrition_unavailable",
    });

  it("a failed save then leaving archives it, cached and on the server", async () => {
    const { api, storage, view } = await generateDay([
      genMeal("Oats", "Breakfast", "breakfast"),
    ]);
    sendArchives(api, storage);
    failSave(api);
    await act(async () => mockProbe.day!.onSave());
    await waitFor(() => expect(mockProbe.day!.errorMessage).toBeTruthy());
    expect(storage.getCachedActiveMealPlan(USER, TODAY)!.id).toBe("plan-1");
    await act(async () => view.unmount());
    await waitFor(() => noTodaysPlan(api, storage, "plan-1"));
  });

  it("offline, leaving still takes it off the phone and queues the archive", async () => {
    const { api, storage, view } = await generateDay([
      genMeal("Oats", "Breakfast", "breakfast"),
    ]);
    failSave(api);
    await act(async () => mockProbe.day!.onSave());
    await waitFor(() => expect(mockProbe.day!.errorMessage).toBeTruthy());
    await act(async () => view.unmount());
    expect(storage.getCachedActiveMealPlan(USER, TODAY)).toBeNull();
    expect(
      storage
        .getPendingMutations()
        .filter((m) => m.entityType === MEALPRINT_DAY_ARCHIVE_ENTITY),
    ).toHaveLength(1);
    expect(api.plans.get("plan-1")!.status).toBe("active");
    // When the queue drains later, it lands.
    sendArchives(api, storage);
    await mockDrain!();
    noTodaysPlan(api, storage, "plan-1");
  });

  it("Log all after a failed save archives it too", async () => {
    const { api, storage } = await generateDay([
      genMeal("Oats", "Breakfast", "breakfast"),
    ]);
    sendArchives(api, storage);
    failSave(api);
    await act(async () => mockProbe.day!.onSave());
    await waitFor(() => expect(mockProbe.day!.errorMessage).toBeTruthy());
    await act(async () => mockProbe.day!.onLogAll());
    await waitFor(() => expect(mockProbe.screen).toBe("logged"));
    await waitFor(() => noTodaysPlan(api, storage, "plan-1"));
  });

  it("leaving after a successful save doesn't archive anything twice", async () => {
    const { storage, view } = await generateDay([
      genMeal("Oats", "Breakfast", "breakfast"),
    ]);
    await act(async () => mockProbe.day!.onSave());
    await waitFor(() => expect(mockProbe.screen).toBe("saved"));
    await act(async () => view.unmount());
    expect(
      storage
        .getPendingMutations()
        .filter((m) => m.entityType === MEALPRINT_DAY_ARCHIVE_ENTITY),
    ).toHaveLength(1);
  });
});

describe("Mealprint Whole day — leaving mid-save (Inspector Brad #579, round 2)", () => {
  /** Hold a call until `release()`; returns the release function. */
  function hold<T extends (...a: never[]) => Promise<unknown>>(
    obj: Record<string, unknown>,
    key: string,
  ): () => void {
    const real = obj[key] as T;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    obj[key] = async (...a: Parameters<T>) => {
      await gate;
      return real.apply(obj, a);
    };
    return release;
  }
  const queuedArchives = (storage: InMemoryStorageAdapter) =>
    storage
      .getPendingMutations()
      .filter((m) => m.entityType === MEALPRINT_DAY_ARCHIVE_ENTITY);

  it("left while the day was being accepted: no save, nothing cached, archive queued", async () => {
    const { api, storage, view } = await generateDay([
      genMeal("Oats", "Breakfast", "breakfast"),
    ]);
    const release = hold(
      api as unknown as Record<string, unknown>,
      "acceptPlan",
    );
    let saving!: Promise<void>;
    act(() => {
      saving = Promise.resolve(mockProbe.day!.onSave());
    });
    await act(async () => view.unmount());
    expect(queuedArchives(storage)).toHaveLength(0);
    // Accept resolves after the screen is gone (and caches the day).
    await act(async () => {
      release();
      await saving;
    });
    await waitFor(() => expect(queuedArchives(storage)).toHaveLength(1));
    expect(storage.getCachedActiveMealPlan(USER, TODAY)).toBeNull();
    expect(api.mealprintSaves).toHaveLength(0);
    expect(queuedArchives(storage)[0]!.endpoint).toBe(
      "/nutrition/plans/plan-1",
    );
  });

  it("left while saving and the save failed: nothing cached, archive queued", async () => {
    const { api, storage, view } = await generateDay([
      genMeal("Oats", "Breakfast", "breakfast"),
    ]);
    api.mealprintSaveFailures.push({
      kind: "api",
      code: "server",
      status: 409,
      message: "plan_meal_nutrition_unavailable",
    });
    const release = hold(
      api as unknown as Record<string, unknown>,
      "savePlanFromMealprint",
    );
    let saving!: Promise<void>;
    act(() => {
      saving = Promise.resolve(mockProbe.day!.onSave());
    });
    await waitFor(() => expect(api.acceptPlanCalls).toHaveLength(1));
    await waitFor(() =>
      expect(storage.getCachedActiveMealPlan(USER, TODAY)?.id).toBe("plan-1"),
    );
    await act(async () => view.unmount());
    await act(async () => {
      release();
      await saving;
    });
    await waitFor(() => expect(api.mealprintSaves).toHaveLength(1));
    await waitFor(() =>
      expect(storage.getCachedActiveMealPlan(USER, TODAY)).toBeNull(),
    );
    expect(queuedArchives(storage)).toHaveLength(1);
  });
});

describe("Mealprint Whole day — what each swap leaves out (Inspector Brad #579)", () => {
  it("swapping several meals in a row never fills the list; Show 3 others still leaves out what that meal showed", async () => {
    const slots = [
      ["Oats", "Breakfast", "breakfast"],
      ["Bagel", "Pre-workout", "snack"],
      ["Bowl", "Lunch", "lunch"],
      ["Stew", "Dinner", "dinner"],
    ] as const;
    const { api } = await generateDay(
      slots.map(([n, l, s]) => genMeal(n, l, s)),
    );
    let round = 0;
    const nextOptions = () => {
      round += 1;
      const opts = [1, 2, 3].map((i) => swapMeal(`R${round}-${i}`, 600));
      api.planSwapResult = {
        meal: opts[0]!,
        options: opts,
        emptyReason: null,
        labelCheckRequired: true,
      };
      return opts;
    };
    // Two rounds on each of four meals, picking each time: 8 swaps, 24+
    // meals shown in all, far past the server's 20.
    for (let pass = 0; pass < 2; pass++) {
      for (const [, label] of slots) {
        nextOptions();
        const before = api.swapPlanMealCalls.length;
        await act(async () => mockProbe.day!.onSwap(idOf(label)));
        await waitFor(() =>
          expect(api.swapPlanMealCalls).toHaveLength(before + 1),
        );
        await waitFor(() => expect(mockProbe.day!.swap?.loading).toBe(false));
        expect(mockProbe.day!.swap!.error).toBeNull();
        expect(
          api.swapPlanMealCalls[before]!.notWantedMeals!.length,
        ).toBeLessThanOrEqual(1);
        act(() => mockProbe.day!.swap!.onPick(0));
      }
    }

    // Within one meal's panel, Show 3 others still leaves out its options.
    const shown = nextOptions();
    const start = api.swapPlanMealCalls.length;
    await act(async () => mockProbe.day!.onSwap(idOf("Lunch")));
    await waitFor(() => expect(mockProbe.day!.swap?.options).toHaveLength(3));
    nextOptions();
    await act(async () => mockProbe.day!.swap!.onMore());
    await waitFor(() => expect(api.swapPlanMealCalls).toHaveLength(start + 2));
    const excluded = api.swapPlanMealCalls[start + 1]!.notWantedMeals!.map(
      (m) => m.name,
    );
    for (const o of shown) expect(excluded).toContain(o.name);
  });
});
