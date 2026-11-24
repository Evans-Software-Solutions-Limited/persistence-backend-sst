/**
 * PER-133 N5 containers: New plan → Build → Saved, Edit a plan, Add to a
 * meal in plan mode. Presenters are probes; hooks are mocked at their
 * module boundary so each test drives the real container logic.
 */
import { act, render } from "@testing-library/react-native";
import type {
  FuelToday,
  NutritionEntry,
  NutritionTarget,
} from "@/domain/models/nutrition";
import type {
  NutritionPlan,
  NutritionPlansCache,
} from "@/domain/models/nutritionPlans";
import { PLAN_ITEMS_PER_MEAL_MAX } from "@/domain/models/nutritionPlans";
import type { UserMeal } from "@/domain/models/userMeals";
import {
  emptyPlanMeal,
  newDraftPlan,
  planItemFromFood,
} from "@/domain/services/nutritionPlans.service";
import { addDaysISO, localDayISO } from "@/shared/utils";
import { useFuelSheets } from "@/state/fuel-sheets";
import { usePlanDraft } from "@/state/plan-draft";
import { usePlanSheets } from "@/state/plan-sheets";
import type { DateCalendarModalProps } from "@/ui/components/DatePickerField";
import type { NewPlanProps } from "@/ui/presenters/fuel/plans/NewPlanPresenter";
import type { PlanSavedProps } from "@/ui/presenters/fuel/plans/PlanSavedPresenter";
import type { PlanBuilderProps } from "@/ui/presenters/fuel/plans/PlanBuilderPresenter";
import type { PlanMealsSheetProps } from "@/ui/presenters/fuel/plans/PlanMealsSheetPresenter";
import type { PlanItemAmountSheetProps } from "@/ui/presenters/fuel/plans/PlanItemAmountSheetPresenter";
import type { PlanOptionsSheetProps } from "@/ui/presenters/fuel/plans/PlanOptionsSheetPresenter";
import type { PlanAddFoodProps } from "@/ui/presenters/fuel/plans/PlanAddFoodPresenter";
import type { PlanQuickItemSheetProps } from "@/ui/presenters/fuel/plans/PlanQuickItemSheetPresenter";
import { FOOD, MEAL, RECIPE } from "./planFixtures";
import {
  NewPlanContainer,
  DAY_NOT_ON_PHONE,
  DAY_TOO_MANY_MEALS,
} from "../NewPlanContainer";
import { PlanEditContainer } from "../PlanEditContainer";
import { PlanAddFoodContainer } from "../PlanAddFoodContainer";
import { NOT_ON_PHONE, SAVE_FAILED } from "../PlanBuilderContainer";

// -- Probes -------------------------------------------------------------------

const probe: {
  newPlan: NewPlanProps | null;
  saved: PlanSavedProps | null;
  builder: PlanBuilderProps | null;
  mealsSheet: PlanMealsSheetProps | null;
  amount: PlanItemAmountSheetProps | null;
  options: PlanOptionsSheetProps | null;
  add: PlanAddFoodProps | null;
  quick: PlanQuickItemSheetProps | null;
  calendar: DateCalendarModalProps | null;
} = {
  newPlan: null,
  saved: null,
  builder: null,
  mealsSheet: null,
  amount: null,
  options: null,
  add: null,
  quick: null,
  calendar: null,
};

jest.mock("@/ui/presenters/fuel/plans/NewPlanPresenter", () => ({
  NewPlanPresenter: (p: NewPlanProps) => {
    probe.newPlan = p;
    return null;
  },
}));
jest.mock("@/ui/presenters/fuel/plans/PlanSavedPresenter", () => ({
  PlanSavedPresenter: (p: PlanSavedProps) => {
    probe.saved = p;
    return null;
  },
}));
jest.mock("@/ui/presenters/fuel/plans/PlanBuilderPresenter", () => ({
  PlanBuilderPresenter: (p: PlanBuilderProps) => {
    probe.builder = p;
    return null;
  },
}));
jest.mock("@/ui/presenters/fuel/plans/PlanMealsSheetPresenter", () => ({
  PlanMealsSheetPresenter: (p: PlanMealsSheetProps) => {
    probe.mealsSheet = p;
    return null;
  },
}));
jest.mock("@/ui/presenters/fuel/plans/PlanItemAmountSheetPresenter", () => ({
  PlanItemAmountSheetPresenter: (p: PlanItemAmountSheetProps) => {
    probe.amount = p;
    return null;
  },
}));
jest.mock("@/ui/presenters/fuel/plans/PlanOptionsSheetPresenter", () => ({
  PlanOptionsSheetPresenter: (p: PlanOptionsSheetProps) => {
    probe.options = p;
    return null;
  },
}));
jest.mock("@/ui/presenters/fuel/plans/PlanAddFoodPresenter", () => ({
  PlanAddFoodPresenter: (p: PlanAddFoodProps) => {
    probe.add = p;
    return null;
  },
}));
jest.mock("@/ui/presenters/fuel/plans/PlanQuickItemSheetPresenter", () => ({
  PlanQuickItemSheetPresenter: (p: PlanQuickItemSheetProps) => {
    probe.quick = p;
    return null;
  },
}));
jest.mock("@/ui/components/DatePickerField", () => ({
  DateCalendarModal: (p: DateCalendarModalProps) => {
    probe.calendar = p;
    return null;
  },
}));

// -- Router + hooks -------------------------------------------------------------

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  __esModule: true,
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    back: () => mockBack(),
    replace: (...a: unknown[]) => mockReplace(...a),
  },
  useLocalSearchParams: () => mockParams,
}));

const USER = "u";
const TODAY = localDayISO();
const YESTERDAY = addDaysISO(TODAY, -1);
const days = new Map<string, FuelToday>();
const mockStorage = {
  getCachedFuelToday: (_u: string, iso: string) => days.get(iso) ?? null,
  getCachedFoodById: (id: string) => (id === FOOD.id ? FOOD : null),
};
jest.mock("@/ui/hooks/useAdapters", () => ({
  useAdapters: () => ({ storage: mockStorage }),
}));
jest.mock("@/ui/hooks/useAuth", () => ({
  useAuth: () => ({ session: { userId: "u" } }),
}));

let mockTarget: NutritionTarget | null = null;
jest.mock("@/ui/hooks/useGetNutritionTarget", () => ({
  useGetNutritionTarget: () => ({ data: mockTarget }),
}));

const mockMeals: UserMeal[] = (
  [
    ["um-b", "Breakfast", "breakfast", "breakfast"],
    ["um-l", "Lunch", "lunch", "lunch"],
    ["um-s", "Snacks", "snack", "snack"],
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
const mockMealList = [MEAL];
const mockRecipeList = [RECIPE];
const mockSaveMeals = jest.fn(async () => true);
jest.mock("@/ui/hooks/useUserMeals", () => ({
  useUserMeals: () => ({
    meals: mockMeals,
    isPlaceholder: false,
    save: mockSaveMeals,
    reload: jest.fn(),
  }),
}));
jest.mock("@/ui/hooks/useGetMeals", () => ({
  useGetMeals: () => ({ data: mockMealList }),
}));
jest.mock("@/ui/hooks/useGetRecipes", () => ({
  useGetRecipes: () => ({ data: mockRecipeList }),
}));

let mockCache: NutritionPlansCache = {
  mine: [],
  fromCoaches: [],
  asOf: null,
  conflictPlanIds: [],
};
let mockPlansLoading = false;
const mockCreate = jest.fn(
  async (p: NutritionPlan) => p as NutritionPlan | null,
);
const mockSavePlan = jest.fn(
  async (p: NutritionPlan) => p as NutritionPlan | null,
);
const mockRemove = jest.fn(async () => {});
const mockDuplicate = jest.fn(async (p: NutritionPlan) => ({
  ...p,
  id: "local-copy",
}));
const mockSetPlanIncluded = jest.fn(async () => {});
jest.mock("@/ui/hooks/useNutritionPlans", () => ({
  useNutritionPlans: () => ({
    cache: mockCache,
    isLoading: mockPlansLoading,
    create: mockCreate,
    save: mockSavePlan,
    remove: mockRemove,
    duplicate: mockDuplicate,
  }),
  usePlansShoppingList: () => ({ setPlanIncluded: mockSetPlanIncluded }),
}));

const mockManualGate = {
  allowed: true,
  isResolved: true,
  onUpgrade: jest.fn(),
};
jest.mock("@/ui/hooks/useManualMealPlansGate", () => ({
  useManualMealPlansGate: () => mockManualGate,
}));
const mockMealprintGate = { allowed: true };
jest.mock("@/ui/hooks/useMealprintGate", () => ({
  useMealprintGate: () => mockMealprintGate,
}));
let mockSearch = { results: [] as (typeof FOOD)[], isSearching: false };
jest.mock("@/ui/hooks/useSearchFoods", () => ({
  useSearchFoods: () => mockSearch,
}));

// -- Fixtures ---------------------------------------------------------------------

const TARGET: NutritionTarget = {
  userId: USER,
  dailyKcal: 2371,
  proteinG: 178,
  carbsG: 240,
  fatG: 77,
  waterCups: 8,
  preset: null,
  setByUserId: null,
  setByName: null,
  updatedAt: null,
};

const entry = (id: string, extra: Partial<NutritionEntry>): NutritionEntry => ({
  id,
  userId: USER,
  foodId: null,
  recipeId: null,
  mealId: null,
  mealSlot: "breakfast",
  servings: 1,
  kcal: 300,
  proteinG: 10,
  carbsG: 30,
  fatG: 10,
  loggedAt: `${YESTERDAY}T08:00:00.000Z`,
  loggedByUserId: null,
  aiEstimated: false,
  aiConfidence: null,
  customName: "Porridge",
  userMealId: "um-b",
  ...extra,
});

const fuelDay = (date: string, entries: NutritionEntry[]): FuelToday => ({
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

const myPlan = (): NutritionPlan => {
  const base = newDraftPlan({
    id: "p1",
    ownerId: USER,
    name: "Training day",
    meals: [
      emptyPlanMeal("pm-b", "Breakfast", "breakfast", 0),
      emptyPlanMeal("pm-l", "Lunch", "lunch", 1),
    ],
    now: "2026-11-20T00:00:00.000Z",
  });
  base.meals[0].items = [planItemFromFood("it-1", FOOD, 1)];
  return { ...base, totals: { ...base.totals, kcal: 198 } };
};

const coachPlan = (): NutritionPlan => ({ ...myPlan(), id: "c1", name: "Cut" });

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(probe))
    (probe as Record<string, unknown>)[k] = null;
  mockParams = {};
  mockTarget = TARGET;
  mockPlansLoading = false;
  mockManualGate.allowed = true;
  mockManualGate.isResolved = true;
  mockMealprintGate.allowed = true;
  mockSearch = { results: [], isSearching: false };
  days.clear();
  mockCache = {
    mine: [myPlan()],
    fromCoaches: [
      {
        plan: coachPlan(),
        coach: { id: "co", name: "Sam", avatarUrl: null },
        assignmentId: "a1",
        note: null,
        status: "added",
        sentAt: "2026-11-20T00:00:00.000Z",
        addedAt: null,
        updatedSinceSeen: false,
      },
    ],
    asOf: null,
    conflictPlanIds: [],
  };
  usePlanDraft.getState().clear();
  useFuelSheets.setState({ sheet: null });
});

const draft = () => usePlanDraft.getState().draft!;

// -- New plan ------------------------------------------------------------------------

describe("NewPlanContainer (N28 → N29 → N33)", () => {
  it("sends a Free user to the paywall once and shows nothing", () => {
    mockManualGate.allowed = false;
    const view = render(<NewPlanContainer />);
    view.rerender(<NewPlanContainer />);
    expect(probe.newPlan).toBeNull();
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockManualGate.onUpgrade).toHaveBeenCalledTimes(1);
  });

  it("waits for the subscription before showing anything", () => {
    mockManualGate.isResolved = false;
    render(<NewPlanContainer />);
    expect(probe.newPlan).toBeNull();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("shows the person's target and Your meals, all ticked", () => {
    render(<NewPlanContainer />);
    const p = probe.newPlan!;
    expect(p.targetValue).toBe("2,371 kcal");
    expect(p.mealsText).toBe("Breakfast, Lunch, Snacks");
    expect(p.ctaLabel).toBe("Start building");
    expect(p.canContinue).toBe(false); // no name yet
    expect(p.options.map((o) => o.label)).toEqual([
      "Empty meals",
      "A day you logged",
      "One of your plans",
      "Let Mealprint fill it",
    ]);
    expect(p.options[2].sub).toBe("Duplicate one of your plans and change it");
    act(() => p.onTarget());
    expect(mockPush).toHaveBeenCalledWith("/(app)/fuel/targets");
    act(() => p.onBack());
    expect(mockBack).toHaveBeenCalled();
  });

  it("says Set a target when there is none", () => {
    mockTarget = null;
    mockCache = { ...mockCache, mine: [] };
    render(<NewPlanContainer />);
    expect(probe.newPlan!.targetValue).toBe("Set a target");
    expect(probe.newPlan!.options[2].sub).toBe(
      "You have no plans of your own yet",
    );
  });

  it("builds empty meals from the ticked Your meals, then saves to N33", async () => {
    render(<NewPlanContainer />);
    act(() => probe.newPlan!.onEditMeals());
    expect(probe.mealsSheet!.visible).toBe(true);
    act(() => probe.mealsSheet!.onToggle("um-s"));
    expect(probe.newPlan!.mealsText).toBe("Breakfast, Lunch");
    act(() => probe.mealsSheet!.onToggle("um-s"));
    act(() => probe.mealsSheet!.onToggle("um-l"));
    act(() => probe.newPlan!.onName("  Rest   day "));
    expect(probe.newPlan!.canContinue).toBe(true);
    act(() => probe.newPlan!.onContinue());

    expect(draft().name).toBe("Rest day");
    expect(draft().meals.map((m) => m.name)).toEqual(["Breakfast", "Snacks"]);
    const b = probe.builder!;
    expect(b.mode).toBe("new");
    expect(b.subtitle).toBe("Mine · target 2,371 kcal");
    expect(b.ctaLabel).toBe("Add something to save");
    expect(b.canSave).toBe(false);

    // Back returns to N28.
    act(() => b.onBack());
    probe.builder = null;
    act(() => probe.newPlan!.onContinue());
    act(() =>
      usePlanDraft
        .getState()
        .addItems(draft().meals[0].id, [planItemFromFood("x", FOOD, 1)]),
    );
    expect(probe.builder!.ctaLabel).toBe("Save plan");
    await act(async () => probe.builder!.onSave());
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Rest day" }),
    );
    const s = probe.saved!;
    expect(s).toMatchObject({ name: "Rest day", mealCount: 2, kcal: 198 });

    await act(async () => s.onShoppingList());
    expect(mockSetPlanIncluded).toHaveBeenCalledWith(
      expect.stringMatching(/^local-/),
      true,
    );
    expect(mockPush).toHaveBeenCalledWith("/(app)/fuel/plans-shopping");
  });

  it("View in Plan goes back and drops the draft", async () => {
    render(<NewPlanContainer />);
    act(() => probe.newPlan!.onName("Rest day"));
    act(() => probe.newPlan!.onContinue());
    act(() =>
      usePlanDraft
        .getState()
        .addItems(draft().meals[0].id, [planItemFromFood("x", FOOD, 1)]),
    );
    await act(async () => probe.builder!.onSave());
    const savedId = usePlanDraft.getState().draft!.id;
    usePlanSheets.setState({ selectedPlanId: "some-other-plan" });
    act(() => probe.saved!.onViewInPlan());
    expect(mockBack).toHaveBeenCalled();
    expect(usePlanDraft.getState().draft).toBeNull();
    // The Plan tab opens on the plan just saved (Inspector Brad #554).
    expect(usePlanSheets.getState().selectedPlanId).toBe(savedId);
  });

  it("shows a note when a save fails", async () => {
    mockCreate.mockResolvedValueOnce(null);
    render(<NewPlanContainer />);
    act(() => probe.newPlan!.onName("Rest day"));
    act(() => probe.newPlan!.onContinue());
    act(() =>
      usePlanDraft
        .getState()
        .addItems(draft().meals[0].id, [planItemFromFood("x", FOOD, 1)]),
    );
    await act(async () => probe.builder!.onSave());
    expect(probe.builder!.notice).toBe(SAVE_FAILED);
    expect(probe.saved).toBeNull();
  });

  it("?from=day opens the calendar and copies a cached day", () => {
    days.set(
      YESTERDAY,
      fuelDay(YESTERDAY, [
        entry("e1", { foodId: "f1", kcal: 198 }),
        entry("e2", {
          mealSlot: "lunch",
          userMealId: "um-l",
          customName: "Soup",
        }),
      ]),
    );
    mockParams = { from: "day" };
    render(<NewPlanContainer />);
    expect(probe.newPlan!.calendarVisible).toBe(true);
    expect(probe.newPlan!.options[1].selected).toBe(true);

    act(() => probe.newPlan!.onPickDay(addDaysISO(TODAY, -5)));
    expect(probe.newPlan!.options[1].sub).toBe(DAY_NOT_ON_PHONE);
    act(() => probe.newPlan!.onName("Copy"));
    expect(probe.newPlan!.canContinue).toBe(false);

    act(() => probe.newPlan!.onOption("day"));
    act(() => probe.newPlan!.onPickDay(YESTERDAY));
    expect(probe.newPlan!.options[1].sub).toMatch(
      / · copies what you ate, then edit$/,
    );
    act(() => probe.newPlan!.onContinue());
    const meals = draft().meals;
    expect(meals.map((m) => m.name)).toEqual(["Breakfast", "Lunch", "Snacks"]);
    expect(meals[0].items[0]).toMatchObject({
      kind: "food",
      name: "Protein bar",
    });
    expect(meals[1].items[0]).toMatchObject({ kind: "custom", name: "Soup" });
    act(() => probe.newPlan!.onCloseCalendar());
  });

  it("won't copy a day with food in more meals than a plan holds", () => {
    // Inspector Brad, #554: 22 of Your meals, food logged in each.
    const extra: UserMeal[] = Array.from({ length: 22 }, (_, i) => ({
      ...mockMeals[2],
      id: `um-x${i}`,
      name: `Extra ${i}`,
      defaultKey: null,
      sortOrder: 3 + i,
    }));
    mockMeals.push(...extra);
    try {
      days.set(
        YESTERDAY,
        fuelDay(
          YESTERDAY,
          extra.map((m, i) =>
            entry(`x${i}`, {
              mealSlot: "snack",
              userMealId: m.id,
              customName: `Food ${i}`,
            }),
          ),
        ),
      );
      mockParams = { from: "day" };
      render(<NewPlanContainer />);
      act(() => probe.newPlan!.onPickDay(YESTERDAY));
      act(() => probe.newPlan!.onName("Big day"));
      expect(probe.newPlan!.options[1].sub).toBe(DAY_TOO_MANY_MEALS);
      expect(probe.newPlan!.canContinue).toBe(false);
      act(() => probe.newPlan!.onContinue());
      expect(usePlanDraft.getState().draft).toBeNull();
    } finally {
      mockMeals.splice(3);
    }
  });

  it("?from=plan picks one of my plans and copies it", () => {
    mockParams = { from: "plan" };
    render(<NewPlanContainer />);
    expect(probe.newPlan!.planPickerVisible).toBe(true);
    expect(probe.newPlan!.plans).toEqual([
      { id: "p1", name: "Training day", sub: "2 meals · 198 kcal" },
    ]);
    act(() => probe.newPlan!.onPickPlan("p1"));
    expect(probe.newPlan!.options[2].sub).toBe(
      "Duplicate Training day and change it",
    );
    act(() => probe.newPlan!.onName("Copy"));
    act(() => probe.newPlan!.onContinue());
    expect(draft().meals[0].items[0].name).toBe("Protein bar");
    expect(draft().meals[0].items[0].id).not.toBe("it-1");
    act(() => probe.newPlan!.onClosePlanPicker());
  });

  it("keeps the picked plan when its local id syncs to a server id", () => {
    // Inspector Brad, #554: the pick followed the alias.
    mockCache = {
      ...mockCache,
      mine: [{ ...myPlan(), id: "local-a" }],
    };
    mockParams = { from: "plan" };
    const { rerender } = render(<NewPlanContainer />);
    act(() => probe.newPlan!.onPickPlan("local-a"));
    act(() => probe.newPlan!.onName("Copy"));
    mockCache = {
      ...mockCache,
      mine: [myPlan()],
      aliases: { "local-a": "p1" },
    };
    rerender(<NewPlanContainer />);
    expect(probe.newPlan!.options[2].sub).toBe(
      "Duplicate Training day and change it",
    );
    expect(probe.newPlan!.canContinue).toBe(true);
  });

  it("Let Mealprint fill it opens Mealprint, or the locked page", () => {
    render(<NewPlanContainer />);
    act(() => probe.newPlan!.onOption("mealprint"));
    expect(probe.newPlan!.ctaLabel).toBe("Continue in Mealprint");
    expect(probe.newPlan!.canContinue).toBe(true);
    act(() => probe.newPlan!.onContinue());
    expect(useFuelSheets.getState().sheet).toBe("mealprintPlan");
    expect(mockBack).toHaveBeenCalled();

    mockMealprintGate.allowed = false;
    render(<NewPlanContainer />);
    act(() => probe.newPlan!.onOption("mealprint"));
    act(() => probe.newPlan!.onContinue());
    expect(useFuelSheets.getState().sheet).toBe("suggestLocked");
  });
});

// -- Edit + builder ------------------------------------------------------------------

describe("PlanEditContainer + builder (N34, N31)", () => {
  const open = () => {
    mockParams = { id: "p1" };
    render(<PlanEditContainer />);
    return probe.builder!;
  };

  it("goes back for a coach plan or an unknown id, waits while loading", () => {
    mockParams = { id: "c1" };
    render(<PlanEditContainer />);
    expect(probe.builder).toBeNull();
    expect(mockBack).toHaveBeenCalledTimes(1);

    mockPlansLoading = true;
    mockParams = { id: "nope" };
    render(<PlanEditContainer />);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("stays open when the plan's create syncs while it's being edited (Inspector Brad #554)", () => {
    mockCache = { ...mockCache, mine: [{ ...myPlan(), id: "local-x" }] };
    mockParams = { id: "local-x" };
    const r = render(<PlanEditContainer />);
    expect(probe.builder).not.toBeNull();
    // A drain swaps the id and records where it went.
    mockCache = {
      ...mockCache,
      mine: [myPlan()],
      aliases: { "local-x": "p1" },
    };
    probe.builder = null;
    r.rerender(<PlanEditContainer />);
    expect(probe.builder).not.toBeNull();
  });

  it("opens my plan in edit mode and saves changes", async () => {
    const b = open();
    expect(b.mode).toBe("edit");
    expect(b.ctaLabel).toBe("Save changes");
    expect(b.canSave).toBe(true);
    expect(b.meals[0]).toMatchObject({
      name: "Breakfast",
      kcalText: "198 kcal",
    });
    expect(b.meals[1].kcalText).toBe("");
    expect(b.summary.comparison.state).toBe("to_plan");
    await act(async () => probe.builder!.onSave());
    expect(mockSavePlan).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p1" }),
    );
    expect(mockBack).toHaveBeenCalled();
  });

  it("Back drops the edit", () => {
    open();
    act(() => probe.builder!.onBack());
    expect(mockBack).toHaveBeenCalled();
    expect(usePlanDraft.getState().draft).toBeNull();
  });

  it("changes an item's amount, moves it, and removes it (N31)", () => {
    open();
    act(() => probe.builder!.onItem("pm-b", "it-1"));
    let a = probe.amount!;
    expect(a).toMatchObject({
      visible: true,
      mode: "edit",
      name: "Protein bar",
      servingSize: "1 bar",
      amount: "1",
      mealName: "Breakfast",
      kcal: 198,
    });
    expect(a.chips.find((c) => c.selected)?.label).toBe("1");
    act(() => a.onAmount("abc"));
    expect(probe.amount!.canSave).toBe(false);
    act(() => probe.amount!.onChip(1.5));
    expect(probe.amount!.kcal).toBeCloseTo(297);
    act(() => probe.amount!.onMeal("pm-l"));
    expect(probe.amount!.mealName).toBe("Lunch");
    act(() => probe.amount!.onSave());
    expect(draft().meals[0].items).toHaveLength(0);
    expect(draft().meals[1].items[0].servings).toBe(1.5);
    expect(probe.amount!.visible).toBe(false);

    act(() => probe.builder!.onItem("pm-l", "it-1"));
    a = probe.amount!;
    act(() => a.onRemove());
    expect(draft().totals.kcal).toBe(0);
    act(() => probe.builder!.onItem("pm-l", "missing"));
    expect(probe.amount!.visible).toBe(false);
    act(() => probe.amount!.onClose());
  });

  it("adds to a meal on its own page and copies a past day into a meal", () => {
    open();
    act(() => probe.builder!.onAddToMeal("pm-l"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/fuel/plan-add?meal=pm-l");

    act(() => probe.builder!.onFromPastDay("pm-l"));
    expect(probe.calendar!.visible).toBe(true);
    act(() => probe.calendar!.onSelectDate(YESTERDAY));
    expect(probe.builder!.notice).toBe(NOT_ON_PHONE);

    days.set(YESTERDAY, fuelDay(YESTERDAY, [entry("e1", {})]));
    act(() => probe.builder!.onFromPastDay("pm-l"));
    act(() => probe.calendar!.onSelectDate(YESTERDAY));
    expect(probe.builder!.notice).toBe("Nothing was logged in Lunch that day.");

    days.set(
      YESTERDAY,
      fuelDay(YESTERDAY, [
        entry("e2", {
          mealSlot: "lunch",
          userMealId: "um-l",
          recipeId: "r1",
          customName: null,
        }),
      ]),
    );
    act(() => probe.builder!.onFromPastDay("pm-l"));
    act(() => probe.calendar!.onSelectDate(YESTERDAY));
    expect(probe.builder!.notice).toBeNull();
    expect(draft().meals[1].items[0]).toMatchObject({
      kind: "recipe",
      name: RECIPE.name,
    });
    act(() => probe.calendar!.onClose());
  });

  it("N28b in the builder: untick, rename, add and reorder meals", () => {
    open();
    act(() => probe.builder!.onAddMeal());
    let s = probe.mealsSheet!;
    expect(s.visible).toBe(true);
    expect(s.meals.map((m) => [m.name, m.ticked])).toEqual([
      ["Breakfast", true],
      ["Lunch", true],
      ["Snacks", false],
    ]);
    act(() => s.onToggle("um-s"));
    expect(draft().meals.map((m) => m.name)).toEqual([
      "Breakfast",
      "Lunch",
      "Snacks",
    ]);
    act(() => probe.mealsSheet!.onToggle("um-l"));
    expect(draft().meals.map((m) => m.name)).toEqual(["Breakfast", "Snacks"]);

    act(() => probe.mealsSheet!.onRename("um-b", "Brekkie"));
    expect(mockSaveMeals).toHaveBeenCalled();
    expect(draft().meals[0].name).toBe("Brekkie");

    act(() => probe.mealsSheet!.onAdd("Supper"));
    expect(draft().meals.map((m) => m.name)).toContain("Supper");

    act(() => probe.mealsSheet!.onReorder(["um-s", "um-b", "um-l"]));
    expect(mockSaveMeals).toHaveBeenCalledTimes(3);
    s = probe.mealsSheet!;
    act(() => s.onClose());
    expect(probe.mealsSheet!.visible).toBe(false);
  });

  it("⋯ options: rename, target, meals, duplicate and delete", async () => {
    open();
    act(() => probe.builder!.onOptions());
    const o = probe.options!;
    expect(o).toMatchObject({
      view: "menu",
      planName: "Training day",
      targetValue: "2,371",
      mealsText: "Breakfast, Lunch",
    });
    act(() => o.onStartRename());
    expect(probe.options!.view).toBe("rename");
    act(() => probe.options!.onRename("Easy day"));
    expect(draft().name).toBe("Easy day");
    expect(probe.options!.view).toBeNull();

    act(() => probe.builder!.onOptions());
    act(() => probe.options!.onTarget());
    expect(mockPush).toHaveBeenCalledWith("/(app)/fuel/targets");

    act(() => probe.builder!.onOptions());
    act(() => probe.options!.onMeals());
    expect(probe.mealsSheet!.visible).toBe(true);

    act(() => probe.builder!.onOptions());
    await act(async () => probe.options!.onDuplicate());
    expect(mockDuplicate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p1", name: "Training day" }),
    );
    expect(mockReplace).toHaveBeenCalledWith(
      "/(app)/fuel/plan-edit?id=local-copy",
    );

    act(() => probe.builder!.onOptions());
    act(() => probe.options!.onAskDelete());
    expect(probe.options!.view).toBe("delete");
    await act(async () => probe.options!.onDelete());
    expect(mockRemove).toHaveBeenCalledWith("p1");
    expect(mockBack).toHaveBeenCalled();
  });

  it("shows — without a target", () => {
    mockTarget = null;
    open();
    expect(probe.builder!.subtitle).toBe("Mine");
    expect(probe.options!.targetValue).toBe("—");
  });
});

// -- Add to a meal (plan mode) ----------------------------------------------------------

describe("PlanAddFoodContainer (N30)", () => {
  const start = (meal = "pm-b") => {
    usePlanDraft.getState().start("edit", myPlan());
    mockParams = { meal };
  };

  it("goes back when there is no draft", () => {
    render(<PlanAddFoodContainer />);
    expect(mockBack).toHaveBeenCalled();
    expect(probe.add).toBeNull();
  });

  it("lists History from cached days, adds ticked rows into the meal", () => {
    days.set(
      YESTERDAY,
      fuelDay(YESTERDAY, [
        entry("e1", { foodId: "f1", kcal: 198 }),
        entry("e2", { mealId: "m1", kcal: 520, customName: null }),
        entry("e3", { recipeId: "r1", kcal: 612, customName: null }),
        entry("e4", { foodId: "gone", kcal: 50, servings: 2 }),
        entry("e5", { kcal: 80, customName: "Apple" }),
      ]),
    );
    start("pm-l");
    render(<PlanAddFoodContainer />);
    const p = probe.add!;
    expect(p.mealName).toBe("Lunch");
    expect(p.planName).toBe("Training day");
    expect(p.sectionTitle).toBe("History");
    expect(p.rows.map((r) => r.sub)).toEqual(
      expect.arrayContaining([
        "1 bar · 198 kcal",
        "My meal · 520 kcal",
        "Recipe · 612 kcal",
        "2 servings · 50 kcal",
        "80 kcal",
      ]),
    );
    expect(p.ctaLabel).toBe("Tap + to add, or tap a food for its amount");
    expect(p.canAdd).toBe(false);
    act(() => p.onToggle("e:e1"));
    act(() => probe.add!.onToggle("e:e2"));
    act(() => probe.add!.onToggle("e:e2"));
    act(() => probe.add!.onToggle("e:e5"));
    expect(probe.add!.ctaLabel).toBe("Add 2 items to Lunch");
    act(() => probe.add!.onAdd());
    expect(draft().meals[1].items.map((i) => i.name)).toEqual([
      "Protein bar",
      "Apple",
    ]);
    expect(mockBack).toHaveBeenCalled();
  });

  it("tabs show My Meals, My Foods and Recipes; search shows results", () => {
    days.set(YESTERDAY, fuelDay(YESTERDAY, [entry("e1", { foodId: "f1" })]));
    start();
    const view = render(<PlanAddFoodContainer />);
    act(() => probe.add!.onTab("meals"));
    expect(probe.add!.rows).toEqual([
      {
        key: "m:m1",
        name: MEAL.name,
        sub: "My meal · 520 kcal",
        picked: false,
      },
    ]);
    act(() => probe.add!.onTab("foods"));
    expect(probe.add!.rows.map((r) => r.key)).toEqual(["f:f1"]);
    act(() => probe.add!.onTab("recipes"));
    expect(probe.add!.rows[0].sub).toBe("Recipe · 612 kcal");

    act(() => probe.add!.onQuery("ba"));
    expect(probe.add!.sectionTitle).toBe("Results");
    expect(probe.add!.emptyText).toBe(
      "No foods found. Search needs a connection.",
    );
    mockSearch = { results: [], isSearching: true };
    view.rerender(<PlanAddFoodContainer />);
    expect(probe.add!.emptyText).toBe("Searching…");
    mockSearch = { results: [{ ...FOOD, id: "f9" }], isSearching: false };
    view.rerender(<PlanAddFoodContainer />);
    expect(probe.add!.rows[0]).toMatchObject({
      key: "f:f9",
      name: "Protein bar",
    });
    act(() => probe.add!.onToggle("f:f9"));
    act(() => probe.add!.onAdd());
    expect(draft().meals[0].items[1].foodId).toBe("f9");
  });

  it("a food ticked from search stays picked after the search clears", () => {
    // Inspector Brad, #554.
    days.set(
      YESTERDAY,
      fuelDay(YESTERDAY, [entry("e5", { kcal: 80, customName: "Apple" })]),
    );
    start("pm-l");
    const view = render(<PlanAddFoodContainer />);
    act(() => probe.add!.onQuery("ban"));
    mockSearch = {
      results: [{ ...FOOD, id: "f9", name: "Banana" }],
      isSearching: false,
    };
    view.rerender(<PlanAddFoodContainer />);
    act(() => probe.add!.onToggle("f:f9"));
    act(() => probe.add!.onQuery(""));
    mockSearch = { results: [], isSearching: false };
    view.rerender(<PlanAddFoodContainer />);
    act(() => probe.add!.onToggle("e:e5"));
    expect(probe.add!.ctaLabel).toBe("Add 2 items to Lunch");
    act(() => probe.add!.onAdd());
    expect(draft().meals[1].items.map((i) => i.name)).toEqual([
      "Banana",
      "Apple",
    ]);
  });

  it("empty tabs say so", () => {
    start();
    render(<PlanAddFoodContainer />);
    expect(probe.add!.rows).toEqual([]);
    expect(probe.add!.emptyText).toBe("Nothing logged on earlier days yet.");
    act(() => probe.add!.onAdd());
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("tapping a row opens N31 to add at an amount, into another meal", () => {
    start();
    render(<PlanAddFoodContainer />);
    act(() => probe.add!.onTab("recipes"));
    act(() => probe.add!.onRow("r:r1"));
    const a = probe.amount!;
    expect(a).toMatchObject({
      visible: true,
      mode: "add",
      mealName: "Breakfast",
      servingSize: "1 portion",
      kcal: 612,
    });
    act(() => a.onAmount("2"));
    act(() => probe.amount!.onMeal("pm-l"));
    act(() => probe.amount!.onSave());
    expect(draft().meals[1].items[0]).toMatchObject({
      kind: "recipe",
      servings: 2,
      kcal: 1224,
    });
    expect(mockBack).toHaveBeenCalled();
  });

  it("Quick log adds a one-off item, never logs", () => {
    start();
    render(<PlanAddFoodContainer />);
    act(() => probe.add!.onQuickLog());
    expect(probe.quick!.visible).toBe(true);
    expect(probe.quick!.canAdd).toBe(false);
    act(() => probe.quick!.onChange("kcal", "450"));
    act(() => probe.quick!.onChange("protein", "40"));
    act(() => probe.quick!.onChange("carbs", "100"));
    expect(probe.quick!.kcalLabel).toBe("450");
    expect(probe.quick!.warning).toBe(
      "Your macros add up to 560 kcal. We'll add the 450 you typed.",
    );
    act(() => probe.quick!.onAdd());
    expect(draft().meals[0].items[1]).toMatchObject({
      kind: "custom",
      name: "Quick log",
      kcal: 450,
    });
  });

  it("switches meal from the title", () => {
    start();
    render(<PlanAddFoodContainer />);
    act(() => probe.add!.onOpenMealPicker());
    expect(probe.add!.mealPickerVisible).toBe(true);
    act(() => probe.add!.onSelectMeal("pm-l"));
    expect(probe.add!.mealName).toBe("Lunch");
    expect(probe.add!.mealPickerVisible).toBe(false);
  });
});

describe("full plan meals (Inspector Brad, #554)", () => {
  // Lunch holding `n` items; the server takes 50 a meal.
  const withLunch = (n: number): NutritionPlan => {
    const p = myPlan();
    p.meals[1].items = Array.from({ length: n }, (_, i) =>
      planItemFromFood(`l${i}`, FOOD, 1),
    );
    return p;
  };

  it("the Add page says how much room is left and adds nothing over it", () => {
    days.set(
      YESTERDAY,
      fuelDay(YESTERDAY, [
        entry("e1", { foodId: "f1", kcal: 198 }),
        entry("e5", { kcal: 80, customName: "Apple" }),
      ]),
    );
    usePlanDraft
      .getState()
      .start("edit", withLunch(PLAN_ITEMS_PER_MEAL_MAX - 1));
    mockParams = { meal: "pm-l" };
    render(<PlanAddFoodContainer />);
    act(() => probe.add!.onToggle("e:e1"));
    expect(probe.add!.canAdd).toBe(true);
    act(() => probe.add!.onToggle("e:e5"));
    expect(probe.add!.ctaLabel).toBe("Lunch has room for 1 more item.");
    expect(probe.add!.canAdd).toBe(false);
    act(() => probe.add!.onAdd());
    expect(draft().meals[1].items).toHaveLength(PLAN_ITEMS_PER_MEAL_MAX - 1);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("a full meal can't take an amount-sheet add or a quick log", () => {
    usePlanDraft.getState().start("edit", withLunch(PLAN_ITEMS_PER_MEAL_MAX));
    mockParams = { meal: "pm-l" };
    render(<PlanAddFoodContainer />);
    expect(probe.add!.ctaLabel).toBe("Lunch is full. Pick another meal.");
    act(() => probe.add!.onTab("recipes"));
    act(() => probe.add!.onRow("r:r1"));
    expect(probe.amount!.canSave).toBe(false);
    act(() => probe.amount!.onSave());
    act(() => probe.amount!.onMeal("pm-b"));
    expect(probe.amount!.canSave).toBe(true);
    act(() => probe.amount!.onClose());

    act(() => probe.add!.onQuickLog());
    act(() => probe.quick!.onChange("kcal", "450"));
    expect(probe.quick!.warning).toBe("Lunch is full. Pick another meal.");
    expect(probe.quick!.canAdd).toBe(false);
    act(() => probe.quick!.onAdd());
    expect(draft().meals[1].items).toHaveLength(PLAN_ITEMS_PER_MEAL_MAX);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("the builder won't move into, or copy a day into, a full meal", () => {
    mockCache = { ...mockCache, mine: [withLunch(PLAN_ITEMS_PER_MEAL_MAX)] };
    mockParams = { id: "p1" };
    render(<PlanEditContainer />);
    act(() => probe.builder!.onItem("pm-b", "it-1"));
    act(() => probe.amount!.onMeal("pm-l"));
    expect(probe.amount!.canSave).toBe(false);
    act(() => probe.amount!.onSave());
    expect(draft().meals[0].items).toHaveLength(1);
    act(() => probe.amount!.onClose());

    days.set(
      YESTERDAY,
      fuelDay(YESTERDAY, [
        entry("e2", {
          mealSlot: "lunch",
          userMealId: "um-l",
          recipeId: "r1",
          customName: null,
        }),
      ]),
    );
    act(() => probe.builder!.onFromPastDay("pm-l"));
    act(() => probe.calendar!.onSelectDate(YESTERDAY));
    expect(probe.builder!.notice).toBe("Lunch is full. Pick another meal.");
    expect(draft().meals[1].items).toHaveLength(PLAN_ITEMS_PER_MEAL_MAX);
  });
});

describe("small paths", () => {
  it("closes sheets and pickers on the Add page", () => {
    usePlanDraft.getState().start("edit", myPlan());
    mockParams = { meal: "pm-b" };
    render(<PlanAddFoodContainer />);
    expect(probe.add!.rows).toEqual([]);
    act(() => probe.add!.onOpenMealPicker());
    act(() => probe.add!.onCloseMealPicker());
    expect(probe.add!.mealPickerVisible).toBe(false);
    act(() => probe.add!.onTab("meals"));
    act(() => probe.add!.onRow("m:m1"));
    act(() => probe.amount!.onChip(0.5));
    expect(probe.amount!.amount).toBe("0.5");
    expect(probe.amount!.chips.find((c) => c.selected)?.label).toBe("½");
    act(() => probe.amount!.onRemove());
    expect(probe.amount!.visible).toBe(false);
    act(() => probe.add!.onRow("m:m1"));
    act(() => probe.amount!.onClose());
    act(() => probe.add!.onRow("nope"));
    expect(probe.amount!.visible).toBe(false);
    act(() => probe.add!.onQuickLog());
    act(() => probe.quick!.onAdd());
    act(() => probe.quick!.onClose());
    expect(probe.quick!.visible).toBe(false);
    act(() => probe.add!.onBack());
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("falls back to the first meal for an unknown ?meal", () => {
    usePlanDraft.getState().start("edit", myPlan());
    mockParams = { meal: "zzz" };
    render(<PlanAddFoodContainer />);
    expect(probe.add!.mealName).toBe("Breakfast");
  });

  it("N28b guards: unknown rows, a blank rename and a blank meal do nothing", () => {
    render(<NewPlanContainer />);
    act(() => probe.newPlan!.onEditMeals());
    act(() => probe.mealsSheet!.onToggle("zzz"));
    act(() => probe.mealsSheet!.onRename("zzz", "X"));
    act(() => probe.mealsSheet!.onAdd("   "));
    expect(mockSaveMeals).not.toHaveBeenCalled();
    act(() => probe.mealsSheet!.onRename("um-b", "Brekkie"));
    act(() => probe.mealsSheet!.onReorder(["um-l", "um-b", "um-s"]));
    act(() => probe.mealsSheet!.onAdd("Supper"));
    expect(mockSaveMeals).toHaveBeenCalledTimes(3);
    act(() => probe.mealsSheet!.onClose());
    expect(probe.mealsSheet!.visible).toBe(false);
  });

  it("closes the builder's options", () => {
    mockParams = { id: "p1" };
    render(<PlanEditContainer />);
    act(() => probe.builder!.onOptions());
    act(() => probe.options!.onClose());
    expect(probe.options!.view).toBeNull();
  });
});
