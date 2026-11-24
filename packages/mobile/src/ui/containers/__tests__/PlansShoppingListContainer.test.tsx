import { act, render } from "@testing-library/react-native";
import type { ReactElement } from "react";
import type {
  NutritionPlan,
  NutritionPlansCache,
  PlanFromCoach,
  PlansShoppingList,
} from "@/domain/models/nutritionPlans";
import type { PlansShoppingState } from "@/ui/hooks/useNutritionPlans";
import type { PlansShoppingAddSheetProps } from "@/ui/presenters/fuel/PlansShoppingAddSheetPresenter";
import type { PlansShoppingListProps } from "@/ui/presenters/fuel/PlansShoppingListPresenter";
import {
  PlansShoppingListContainer,
  orderAisles,
  shoppingChips,
  shoppingPlanRows,
} from "../PlansShoppingListContainer";

const mockProbe: { last: PlansShoppingListProps | null } = { last: null };
jest.mock("@/ui/presenters/fuel/PlansShoppingListPresenter", () => ({
  PlansShoppingListPresenter: (props: PlansShoppingListProps) => {
    mockProbe.last = props;
    return null;
  },
}));
jest.mock("@/ui/presenters/fuel/PlansShoppingAddSheetPresenter", () => ({
  PlansShoppingAddSheetPresenter: () => null,
}));

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { back: (...a: unknown[]) => mockBack(...a) },
}));

let mockOnline = true;
jest.mock("@/ui/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => mockOnline,
}));

let mockShopping: PlansShoppingState;
let mockCache: NutritionPlansCache;
jest.mock("@/ui/hooks/useNutritionPlans", () => ({
  usePlansShoppingList: () => mockShopping,
  useNutritionPlans: () => ({ cache: mockCache }),
}));

function plan(id: string, name: string, archived = false): NutritionPlan {
  return {
    id,
    ownerId: "u1",
    name,
    notes: null,
    source: "manual",
    sourcePlanId: null,
    revision: 1,
    archivedAt: archived ? "2026-11-01T00:00:00Z" : null,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    totals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    meals: [],
  };
}

function coach(
  id: string,
  name: string,
  status: PlanFromCoach["status"],
): PlanFromCoach {
  return {
    plan: plan(id, name),
    coach: { id: "coach-1", name: "Sam", avatarUrl: null },
    assignmentId: `a-${id}`,
    note: null,
    status,
    sentAt: "2026-11-01T00:00:00Z",
    addedAt: null,
    updatedSinceSeen: false,
  };
}

function list(over: Partial<PlansShoppingList> = {}): PlansShoppingList {
  return {
    aisles: [
      {
        aisle: "Cupboard",
        items: [{ id: "oats", name: "Porridge oats", quantity: "160 g" }],
      },
      { aisle: "Bakery", items: [] },
      {
        aisle: "Meat & fish",
        items: [
          { id: "chicken", name: "Chicken breast", quantity: "450 g" },
          { id: "turkey", name: "Turkey mince 5%", quantity: "200 g" },
        ],
      },
    ],
    totalItems: 3,
    plans: [
      { nutritionPlanId: "p1", mealPlanId: null, addedAt: "x" },
      { nutritionPlanId: "c1", mealPlanId: null, addedAt: "x" },
      { nutritionPlanId: null, mealPlanId: "m1", addedAt: "x" },
    ],
    asOf: "2026-11-23T00:00:00Z",
    ...over,
  };
}

function shopping(over: Partial<PlansShoppingState> = {}): PlansShoppingState {
  return {
    value: { list: list(), ticked: ["chicken"] },
    isLoading: false,
    isRefreshing: false,
    hasError: false,
    refresh: jest.fn().mockResolvedValue(true),
    toggleTick: jest.fn(),
    setPlanIncluded: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

beforeEach(() => {
  mockProbe.last = null;
  mockOnline = true;
  mockBack.mockClear();
  mockShopping = shopping();
  mockCache = {
    mine: [plan("p1", "Training day"), plan("p2", "Rest day")],
    fromCoaches: [coach("c1", "Cut phase", "added")],
    asOf: null,
    conflictPlanIds: [],
  };
});

function props(): PlansShoppingListProps {
  if (!mockProbe.last) throw new Error("presenter not rendered");
  return mockProbe.last;
}

function sheet(): PlansShoppingAddSheetProps {
  return (props().sheet as ReactElement<PlansShoppingAddSheetProps>).props;
}

describe("PlansShoppingListContainer", () => {
  it("passes the cached list in aisle order with ticks and progress", () => {
    render(<PlansShoppingListContainer />);
    const p = props();
    expect(p.view).toBe("list");
    expect(p.aisles.map((a) => a.aisle)).toEqual(["Meat & fish", "Cupboard"]);
    expect(p.aisles[0].items[0]).toEqual({
      id: "chicken",
      name: "Chicken breast",
      quantity: "450 g",
      ticked: true,
    });
    expect(p.aisles[0].items[1].ticked).toBe(false);
    expect(p.done).toBe(1);
    expect(p.total).toBe(3);
    expect(p.chips).toEqual([
      { key: "p1", label: "Training day" },
      { key: "c1", label: "Cut phase" },
      { key: "mealprint-m1", label: "Mealprint plan" },
    ]);
  });

  it("shows the cached list even when the read failed offline", () => {
    mockOnline = false;
    mockShopping = shopping({ hasError: true });
    render(<PlansShoppingListContainer />);
    expect(props().view).toBe("list");
  });

  it("wires tick, refresh, retry and back", () => {
    render(<PlansShoppingListContainer />);
    props().onToggle("oats");
    expect(mockShopping.toggleTick).toHaveBeenCalledWith("oats");
    props().onRefresh();
    props().onRetry();
    expect(mockShopping.refresh).toHaveBeenCalledTimes(2);
    props().onBack();
    expect(mockBack).toHaveBeenCalled();
  });

  it("the + opens the sheet; toggling a plan includes or removes it", () => {
    render(<PlansShoppingListContainer />);
    expect(sheet().visible).toBe(false);
    act(() => props().onAdd());
    expect(sheet().visible).toBe(true);
    expect(sheet().plans.map((r) => [r.id, r.included])).toEqual([
      ["p1", true],
      ["p2", false],
      ["c1", true],
    ]);
    sheet().onToggle("p2", true);
    expect(mockShopping.setPlanIncluded).toHaveBeenCalledWith("p2", true);
    act(() => sheet().onClose());
    expect(sheet().visible).toBe(false);
  });

  it("is empty when no plans are in the list", () => {
    mockShopping = shopping({
      value: {
        list: list({ plans: [], aisles: [], totalItems: 0 }),
        ticked: [],
      },
    });
    render(<PlansShoppingListContainer />);
    expect(props().view).toBe("empty");
  });

  it("is empty when the list was read but nothing is cached", () => {
    mockShopping = shopping({ value: { list: null, ticked: [] } });
    render(<PlansShoppingListContainer />);
    expect(props().view).toBe("empty");
    expect(props().chips).toEqual([]);
    expect(props().aisles).toEqual([]);
    expect(props().total).toBe(0);
  });

  it.each([
    [true, false, true, "loading"],
    [true, false, false, "offline"],
    [false, true, true, "error"],
    [false, true, false, "offline"],
  ] as const)(
    "with nothing cached (loading=%s error=%s online=%s) shows %s",
    (isLoading, hasError, online, view) => {
      mockOnline = online;
      mockShopping = shopping({
        value: { list: null, ticked: [] },
        isLoading,
        hasError,
      });
      render(<PlansShoppingListContainer />);
      expect(props().view).toBe(view);
    },
  );
});

describe("orderAisles", () => {
  it("keeps the N23 order, puts unknown aisles last and hides empty ones", () => {
    const item = { id: "x", name: "x", quantity: "1" };
    const out = orderAisles([
      { aisle: "Frozen", items: [item] },
      { aisle: "Other", items: [item] },
      { aisle: "Fruit & veg", items: [item] },
      { aisle: "Dairy & eggs", items: [] },
      { aisle: "Deli", items: [item] },
      { aisle: "Meat & fish", items: [item] },
    ]);
    expect(out.map((a) => a.aisle)).toEqual([
      "Meat & fish",
      "Fruit & veg",
      "Other",
      "Frozen",
      "Deli",
    ]);
  });
});

describe("shoppingChips", () => {
  it("falls back to 'Plan' for a plan the phone doesn't have", () => {
    const chips = shoppingChips(
      list({
        plans: [{ nutritionPlanId: "gone", mealPlanId: null, addedAt: "x" }],
      }),
      { mine: [], fromCoaches: [], asOf: null, conflictPlanIds: [] },
    );
    expect(chips).toEqual([{ key: "gone", label: "Plan" }]);
  });
});

describe("shoppingPlanRows", () => {
  it("lists mine and added coach plans; a sent coach plan only when it's in", () => {
    const cache: NutritionPlansCache = {
      mine: [plan("p1", "Training day"), plan("old", "Old", true)],
      fromCoaches: [
        coach("c1", "Cut phase", "added"),
        coach("c2", "Bulk", "sent"),
        coach("c3", "Maintain", "sent"),
      ],
      asOf: null,
      conflictPlanIds: [],
    };
    const rows = shoppingPlanRows(
      list({
        plans: [{ nutritionPlanId: "c3", mealPlanId: null, addedAt: "x" }],
      }),
      cache,
    );
    expect(rows).toEqual([
      {
        id: "p1",
        name: "Training day",
        sub: "Yours",
        fromCoach: false,
        included: false,
      },
      {
        id: "c1",
        name: "Cut phase",
        sub: "From Sam",
        fromCoach: true,
        included: false,
      },
      {
        id: "c3",
        name: "Maintain",
        sub: "From Sam",
        fromCoach: true,
        included: true,
      },
    ]);
  });
});
