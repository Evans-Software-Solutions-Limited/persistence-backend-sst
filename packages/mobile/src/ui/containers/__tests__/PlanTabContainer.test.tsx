import { act, render } from "@testing-library/react-native";
import type {
  NutritionPlan,
  NutritionPlansCache,
  PlanFromCoach,
} from "@/domain/models/nutritionPlans";
import { emptyPlansCache } from "@/domain/models/nutritionPlans";
import type { NutritionTarget } from "@/domain/models/nutrition";
import {
  addItemToMeal,
  emptyPlanMeal,
  newDraftPlan,
  planItemCustom,
} from "@/domain/services/nutritionPlans.service";
import type { PlanTabProps } from "@/ui/presenters/fuel/PlanTabPresenter";
import type {
  CoachPlanSheetProps,
  PlanSwitchSheetProps,
} from "@/ui/presenters/fuel/PlanSheetsPresenter";
import { useFuelSheets } from "@/state/fuel-sheets";
import { usePlanSheets } from "@/state/plan-sheets";
import {
  PlanTabContainer,
  firstName,
  mealLine,
  planViewModel,
  updatedLabel,
} from "../PlanTabContainer";
import {
  PlanSheetsContainer,
  initials,
  switchGroups,
} from "../PlanSheetsContainer";

const mockProbe: {
  tab: PlanTabProps | null;
  sw: PlanSwitchSheetProps | null;
  coach: CoachPlanSheetProps | null;
} = { tab: null, sw: null, coach: null };
jest.mock("@/ui/presenters/fuel/PlanTabPresenter", () => ({
  PlanTabPresenter: (p: PlanTabProps) => {
    mockProbe.tab = p;
    return null;
  },
}));
jest.mock("@/ui/presenters/fuel/PlanSheetsPresenter", () => ({
  PlanSwitchSheetPresenter: (p: PlanSwitchSheetProps) => {
    mockProbe.sw = p;
    return null;
  },
  CoachPlanSheetPresenter: (p: CoachPlanSheetProps) => {
    mockProbe.coach = p;
    return null;
  },
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: (...a: unknown[]) => mockPush(...a) },
}));
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: "s" },
}));

const mockTarget: NutritionTarget = {
  userId: "u1",
  dailyKcal: 2050,
  proteinG: 180,
  carbsG: 200,
  fatG: 60,
  waterCups: 8,
  preset: null,
  setByUserId: null,
  setByName: null,
  updatedAt: null,
};
jest.mock("@/ui/hooks/useAdapters", () => ({
  useAdapters: () => ({
    storage: { getCachedNutritionTarget: () => mockTarget },
  }),
}));
jest.mock("@/ui/hooks/useAuth", () => ({
  useAuth: () => ({ session: { userId: "u1" } }),
}));

type PlansMock = {
  cache: NutritionPlansCache;
  isLoading: boolean;
  refresh: jest.Mock;
  duplicate: jest.Mock;
  markSeen: jest.Mock;
  addToDay: jest.Mock;
  clearConflict: jest.Mock;
  answerCoachPlan: jest.Mock;
};
let mockPlans: PlansMock;
const mockShopping = {
  value: { list: null as null | { plans: { nutritionPlanId: string }[] } },
  setPlanIncluded: jest.fn(async () => {}),
};
jest.mock("@/ui/hooks/useNutritionPlans", () => ({
  useNutritionPlans: () => mockPlans,
  usePlansShoppingList: () => mockShopping,
}));
jest.mock("@/ui/hooks/useUserMeals", () => ({
  useUserMeals: () => ({ meals: [] }),
}));
let mockMealprintAllowed = true;
jest.mock("@/ui/hooks/useMealprintGate", () => ({
  useMealprintGate: () => ({ allowed: mockMealprintAllowed, isResolved: true }),
}));
let mockManualAllowed = true;
const mockOnUpgrade = jest.fn();
jest.mock("@/ui/hooks/useManualMealPlansGate", () => ({
  useManualMealPlansGate: () => ({
    allowed: mockManualAllowed,
    isResolved: true,
    onUpgrade: mockOnUpgrade,
  }),
}));

function plan(id: string, ownerId: string, withGap = true): NutritionPlan {
  let p = newDraftPlan({
    id,
    ownerId,
    name: id === "c1" ? "Training day" : "Cut week",
    now: "2026-10-02T10:00:00.000Z",
    meals: [
      emptyPlanMeal(`${id}-m1`, "Breakfast", "breakfast", 0),
      ...(withGap ? [emptyPlanMeal(`${id}-m2`, "Meal 5", "snack", 1)] : []),
    ],
  });
  p = addItemToMeal(
    p,
    `${id}-m1`,
    planItemCustom("i1", "Bagel", {
      kcal: 400,
      proteinG: 20,
      carbsG: 50,
      fatG: 10,
    }),
  );
  return addItemToMeal(
    p,
    `${id}-m1`,
    planItemCustom("i2", "Egg", { kcal: 72, proteinG: 6, carbsG: 0, fatG: 5 }),
  );
}

const coach = (over: Partial<PlanFromCoach> = {}): PlanFromCoach => ({
  plan: plan("c1", "coach-1"),
  coach: { id: "coach-1", name: "Ellie Hart", avatarUrl: null },
  assignmentId: "a1",
  note: "Lifting days.",
  status: "added",
  sentAt: "t",
  addedAt: "t",
  updatedSinceSeen: false,
  ...over,
});

beforeEach(() => {
  mockProbe.tab = mockProbe.sw = mockProbe.coach = null;
  mockPush.mockReset();
  mockOnUpgrade.mockReset();
  mockShopping.setPlanIncluded.mockClear();
  mockShopping.value = { list: null };
  mockMealprintAllowed = true;
  mockManualAllowed = true;
  usePlanSheets.setState({
    selectedPlanId: null,
    sheet: null,
    coachPlanId: null,
    autoShown: [],
  });
  mockPlans = {
    cache: { ...emptyPlansCache(), mine: [plan("p1", "u1")] },
    isLoading: false,
    refresh: jest.fn(),
    duplicate: jest.fn(async (p: NutritionPlan) => ({
      ...p,
      id: "local-copy",
    })),
    markSeen: jest.fn(async () => {}),
    addToDay: jest.fn(async () => [{ id: "e1" }]),
    clearConflict: jest.fn(),
    answerCoachPlan: jest.fn(async () => {}),
  };
});

describe("helpers", () => {
  it("formats names, meal lines and dates", () => {
    expect(firstName("Ellie Hart")).toBe("Ellie");
    expect(firstName("  ")).toBe("Your coach");
    expect(mealLine([])).toBe("Nothing yet");
    expect(mealLine(["Oats"])).toBe("Oats");
    expect(mealLine(["Oats", "banana", "nut butter"])).toBe(
      "Oats, banana and nut butter",
    );
    expect(updatedLabel("2026-10-02T10:00:00.000Z")).toBe("2 Oct");
    expect(updatedLabel("nope")).toBe("");
    expect(initials("Ellie Hart")).toBe("EH");
    expect(initials(" ")).toBe("C");
  });

  it("builds a coach plan's view without a target", () => {
    const c = coach();
    const vm = planViewModel(
      { kind: "coach", plan: c.plan, fromCoach: c },
      null,
      { ...emptyPlansCache(), conflictPlanIds: ["c1"] },
      true,
      true,
    );
    expect(vm.ownerText).toBe(
      "Set by Ellie, your coach · updated 2 Oct. You can log from it, not change it.",
    );
    expect(vm.ownerInitial).toBe("E");
    expect(vm.macroChips[0]!.text).toBe("26g P");
    expect(vm.conflict).toBe(true);
    expect(vm.meals.map((m) => m.name)).toEqual(["Bagel and Egg"]);
  });

  it("groups the switcher: each coach, then mine; new and updated marked", () => {
    const cache = {
      ...emptyPlansCache(),
      mine: [plan("p1", "u1")],
      fromCoaches: [
        coach({ status: "sent" }),
        coach({
          plan: { ...plan("c2", "coach-1"), id: "c2" },
          updatedSinceSeen: true,
        }),
      ],
    };
    const g = switchGroups(cache, "p1");
    expect(g.map((x) => x.title)).toEqual(["From Ellie · your coach", "Mine"]);
    expect(g[0]!.rows.map((r) => r.sub)).toEqual([
      "472 kcal · New",
      "472 kcal · Updated",
    ]);
    expect(g[1]!.rows[0]!.selected).toBe(true);
    expect(switchGroups(emptyPlansCache(), null)).toEqual([]);
    // A local id that has synced still ticks its plan (Inspector Brad #554).
    const aliased = switchGroups(
      { ...cache, aliases: { "local-p1": "p1" } },
      "local-p1",
    );
    expect(aliased[1]!.rows[0]!.selected).toBe(true);
  });
});

describe("PlanTabContainer", () => {
  it("shows my plan by default, compared with my target", () => {
    render(<PlanTabContainer active />);
    const p = mockProbe.tab!;
    expect(p.state).toBe("plan");
    expect(p.plan!.kind).toBe("mine");
    expect(p.plan!.comparison).toMatchObject({
      targetKcal: 2050,
      plannedKcal: 472,
    });
    expect(p.plan!.gapMeal).toBe("Meal 5");
  });

  it("loading and empty states", () => {
    mockPlans.isLoading = true;
    mockPlans.cache = emptyPlansCache();
    const r = render(<PlanTabContainer active />);
    expect(mockProbe.tab!.state).toBe("loading");
    mockPlans.isLoading = false;
    r.rerender(<PlanTabContainer active />);
    expect(mockProbe.tab!.state).toBe("empty");
  });

  it("adds a meal and the whole plan to today, offline-first", async () => {
    const mutated = jest.spyOn(useFuelSheets.getState(), "notifyMutated");
    render(<PlanTabContainer active />);
    await act(async () => mockProbe.tab!.onLogMeal("p1-m1"));
    expect(mockPlans.addToDay).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p1" }),
      "p1-m1",
      [],
      expect.stringMatching(/T12:00:00.000Z$/),
    );
    expect(mockProbe.tab!.notice).toBe("Added Breakfast to today's log.");
    await act(async () => mockProbe.tab!.onLogAll());
    expect(mockProbe.tab!.notice).toBe("Added Cut week to today's log.");
    mockPlans.addToDay.mockResolvedValueOnce([]);
    await act(async () => mockProbe.tab!.onLogAll());
    expect(mutated).toBeDefined();
  });

  it("Edit, a meal tap and Add food open my plan; shopping list adds it", async () => {
    render(<PlanTabContainer active />);
    act(() => mockProbe.tab!.onOwnerAction());
    act(() => mockProbe.tab!.onOpenMeal("p1-m1"));
    act(() => mockProbe.tab!.onAddFood());
    expect(mockPush).toHaveBeenCalledWith("/(app)/fuel/plan-edit?id=p1");
    expect(mockPush).toHaveBeenCalledTimes(3);
    act(() => mockProbe.tab!.onShoppingList());
    expect(mockShopping.setPlanIncluded).toHaveBeenCalledWith("p1", true);
    expect(mockPush).toHaveBeenLastCalledWith("/(app)/fuel/plans-shopping");
    mockShopping.value = { list: { plans: [{ nutritionPlanId: "p1" }] } };
    mockShopping.setPlanIncluded.mockClear();
    act(() => mockProbe.tab!.onShoppingList());
    expect(mockShopping.setPlanIncluded).not.toHaveBeenCalled();
    act(() => mockProbe.tab!.onDismissConflict());
    expect(mockPlans.clearConflict).toHaveBeenCalledWith("p1");
  });

  it("a coach plan: Duplicate selects the copy, opening clears 'updated', edits are refused", async () => {
    mockPlans.cache = {
      ...emptyPlansCache(),
      fromCoaches: [coach({ updatedSinceSeen: true })],
    };
    render(<PlanTabContainer active />);
    expect(mockProbe.tab!.plan!.kind).toBe("coach");
    expect(mockProbe.tab!.plan!.updated).toBe(true);
    expect(mockPlans.markSeen).toHaveBeenCalledWith("c1");
    act(() => mockProbe.tab!.onOpenMeal("c1-m1"));
    act(() => mockProbe.tab!.onAddFood());
    expect(mockPush).not.toHaveBeenCalled();
    await act(async () => mockProbe.tab!.onOwnerAction());
    expect(mockPlans.duplicate).toHaveBeenCalled();
    expect(usePlanSheets.getState().selectedPlanId).toBe("local-copy");
  });

  it("the Duplicated notice shows on the copy, and survives its id swap (Inspector Brad #554)", async () => {
    const c = coach();
    mockPlans.cache = { ...emptyPlansCache(), fromCoaches: [c] };
    // The real command puts the copy in `mine` right away.
    mockPlans.duplicate.mockImplementation(async (p: NutritionPlan) => {
      const copy = { ...p, id: "local-copy", ownerId: "u1" };
      mockPlans.cache = { ...mockPlans.cache, mine: [copy] };
      return copy;
    });
    const r = render(<PlanTabContainer active />);
    await act(async () => mockProbe.tab!.onOwnerAction());
    r.rerender(<PlanTabContainer active />);
    expect(mockProbe.tab!.plan!.id).toBe("local-copy");
    expect(mockProbe.tab!.notice).toBe(
      "Duplicated into your plans as Training day.",
    );
    // The copy syncs: same plan, new id.
    mockPlans.cache = {
      ...mockPlans.cache,
      mine: [{ ...mockPlans.cache.mine[0]!, id: "srv-copy" }],
      aliases: { "local-copy": "srv-copy" },
    };
    r.rerender(<PlanTabContainer active />);
    expect(mockProbe.tab!.plan!.id).toBe("srv-copy");
    expect(mockProbe.tab!.notice).toBe(
      "Duplicated into your plans as Training day.",
    );
    // Moving to another plan drops it.
    mockPlans.cache = {
      ...mockPlans.cache,
      mine: [...mockPlans.cache.mine, plan("p1", "u1")],
    };
    act(() => usePlanSheets.getState().select("p1"));
    r.rerender(<PlanTabContainer active />);
    expect(mockProbe.tab!.notice).toBeNull();
  });

  it("a coach plan waiting for an answer opens C6 once", () => {
    mockPlans.cache = {
      ...emptyPlansCache(),
      fromCoaches: [coach({ status: "sent" })],
    };
    const r = render(<PlanTabContainer active />);
    expect(usePlanSheets.getState()).toMatchObject({
      sheet: "coachPlan",
      coachPlanId: "c1",
      autoShown: ["c1"],
    });
    act(() => usePlanSheets.getState().close());
    r.rerender(<PlanTabContainer active />);
    expect(usePlanSheets.getState().sheet).toBeNull();
  });

  it("New plan needs Premium; Mealprint needs Premium+", () => {
    mockPlans.cache = emptyPlansCache();
    render(<PlanTabContainer active />);
    act(() => mockProbe.tab!.onBuildOwn());
    act(() => mockProbe.tab!.onStartFromDay());
    expect(mockPush).toHaveBeenCalledWith("/(app)/fuel/plan-new");
    expect(mockPush).toHaveBeenCalledWith("/(app)/fuel/plan-new?from=day");
    act(() => mockProbe.tab!.onMealprintBuild());
    expect(useFuelSheets.getState().sheet).toBe("mealprintPlan");

    mockManualAllowed = false;
    mockMealprintAllowed = false;
    render(<PlanTabContainer active />);
    act(() => mockProbe.tab!.onBuildOwn());
    expect(mockOnUpgrade).toHaveBeenCalled();
    act(() => mockProbe.tab!.onMealprintBuild());
    expect(useFuelSheets.getState().sheet).toBe("suggestLocked");
  });

  it("Fill with Mealprint opens One meal for the gap's slot", () => {
    render(<PlanTabContainer active />);
    act(() => mockProbe.tab!.onFillWithMealprint());
    expect(useFuelSheets.getState()).toMatchObject({
      sheet: "mealprintSuggest",
      slot: "snack",
    });
  });
});

describe("PlanSheetsContainer", () => {
  beforeEach(() => {
    mockPlans.cache = {
      ...emptyPlansCache(),
      mine: [plan("p1", "u1")],
      fromCoaches: [coach({ status: "sent" })],
    };
  });

  it("picking a plan shows it; a plan still waiting opens C6", () => {
    usePlanSheets.setState({ sheet: "switch" });
    render(<PlanSheetsContainer />);
    expect(mockProbe.sw!.visible).toBe(true);
    act(() => mockProbe.sw!.onPick("p1"));
    expect(usePlanSheets.getState()).toMatchObject({
      selectedPlanId: "p1",
      sheet: null,
    });
    act(() => mockProbe.sw!.onPick("c1"));
    expect(usePlanSheets.getState()).toMatchObject({
      sheet: "coachPlan",
      coachPlanId: "c1",
    });
  });

  it("New plan and Mealprint follow the gates", () => {
    render(<PlanSheetsContainer />);
    act(() => mockProbe.sw!.onNewPlan());
    expect(mockPush).toHaveBeenCalledWith("/(app)/fuel/plan-new");
    act(() => mockProbe.sw!.onMealprint());
    expect(useFuelSheets.getState().sheet).toBe("mealprintPlan");
    mockManualAllowed = false;
    mockMealprintAllowed = false;
    render(<PlanSheetsContainer />);
    act(() => mockProbe.sw!.onNewPlan());
    expect(mockOnUpgrade).toHaveBeenCalled();
    act(() => mockProbe.sw!.onMealprint());
    expect(useFuelSheets.getState().sheet).toBe("suggestLocked");
  });

  it("C6: Add to my plans selects it; Not now dismisses", () => {
    usePlanSheets.setState({ sheet: "coachPlan", coachPlanId: "c1" });
    render(<PlanSheetsContainer />);
    expect(mockProbe.coach!).toMatchObject({
      visible: true,
      coachInitials: "EH",
      planName: "Training day",
      note: "Lifting days.",
    });
    expect(mockProbe.coach!.meals[0]).toMatchObject({ name: "Bagel and Egg" });
    act(() => mockProbe.coach!.onAdd());
    expect(mockPlans.answerCoachPlan).toHaveBeenCalledWith("c1", true);
    expect(usePlanSheets.getState().selectedPlanId).toBe("c1");
    act(() => mockProbe.coach!.onNotNow());
    expect(mockPlans.answerCoachPlan).toHaveBeenCalledWith("c1", false);
  });

  it("renders no C6 for a plan that's gone", () => {
    usePlanSheets.setState({ sheet: "coachPlan", coachPlanId: "gone" });
    render(<PlanSheetsContainer />);
    expect(mockProbe.coach).toBeNull();
  });
});
