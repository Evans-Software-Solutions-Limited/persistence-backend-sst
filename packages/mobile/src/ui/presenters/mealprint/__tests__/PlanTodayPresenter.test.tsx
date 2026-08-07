import { fireEvent, within } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import type { MealPlan } from "@/domain/models/mealprint";
import { PlanTodayPresenter, type PlanTodayProps } from "../PlanTodayPresenter";

function plan(over: Partial<MealPlan> = {}): MealPlan {
  return {
    id: "plan-1",
    userId: "user-1",
    status: "active",
    planDate: "2026-08-05",
    groupId: null,
    mealsPerDay: 2,
    effortLevel: "balanced",
    targetKcal: 2000,
    targetProteinG: 150,
    targetCarbsG: 200,
    targetFatG: 60,
    source: "ai",
    createdByUserId: null,
    createdAt: null,
    acceptedAt: null,
    meals: [
      {
        id: "meal-1",
        sortOrder: 0,
        label: "Greek yoghurt bowl",
        logSlot: "breakfast",
        recipeId: null,
        mealId: null,
        items: null,
        kcal: 400,
        proteinG: 30,
        carbsG: 40,
        fatG: 10,
        aiReason: null,
        state: "logged",
        loggedEntryId: "entry-1",
      },
      {
        id: "meal-2",
        sortOrder: 1,
        label: "Chicken & rice bowl",
        logSlot: "dinner",
        recipeId: null,
        mealId: null,
        items: null,
        kcal: 600,
        proteinG: 45,
        carbsG: 60,
        fatG: 15,
        aiReason: null,
        state: "planned",
        loggedEntryId: null,
      },
    ],
    ...over,
  };
}

function props(over: Partial<PlanTodayProps> = {}): PlanTodayProps {
  return {
    loading: false,
    plan: plan(),
    loggedTotals: { kcal: 400, proteinG: 30, carbsG: 40, fatG: 10 },
    loggedCount: 1,
    totalCount: 2,
    onBack: jest.fn(),
    onLogMeal: jest.fn(),
    loggingMealId: null,
    onSwapMeal: jest.fn(),
    swappingMealId: null,
    actionFailure: null,
    onDeletePlan: jest.fn(),
    deleting: false,
    onOpenShoppingList: jest.fn(),
    ...over,
  };
}

describe("PlanTodayPresenter", () => {
  it("shows a loading state before any plan is known", () => {
    const { getByText, queryByTestId } = renderWithTheme(
      <PlanTodayPresenter {...props({ loading: true, plan: null })} />,
    );
    expect(getByText(/Loading your plan/i)).toBeTruthy();
    expect(queryByTestId("plan-today-adherence")).toBeNull();
  });

  it("shows the empty state when there's no plan for today", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <PlanTodayPresenter {...props({ loading: false, plan: null })} />,
    );
    expect(getByTestId("plan-today-empty")).toBeTruthy();
    expect(queryByTestId("plan-today-delete")).toBeNull();
  });

  it("renders the adherence card with logged/total and the day total vs target", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <PlanTodayPresenter {...props()} />,
    );
    expect(getByTestId("plan-today-adherence")).toBeTruthy();
    expect(getByText(/1\/2 meals/)).toBeTruthy();
    expect(
      within(getByTestId("plan-today-adherence")).getByText(/400/),
    ).toBeTruthy();
  });

  it("renders each meal, LOGGED pill for the logged one, Log/Swap for the unlogged one", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <PlanTodayPresenter {...props()} />,
    );
    expect(getByTestId("plan-today-meal-meal-1")).toBeTruthy();
    expect(getByTestId("plan-today-meal-meal-2")).toBeTruthy();
    expect(getByText("LOGGED")).toBeTruthy();
    expect(getByTestId("plan-today-log-meal-2")).toBeTruthy();
    expect(getByTestId("plan-today-swap-meal-2")).toBeTruthy();
  });

  it("does not render Log/Swap actions for an already-logged meal", () => {
    const { queryByTestId } = renderWithTheme(
      <PlanTodayPresenter {...props()} />,
    );
    expect(queryByTestId("plan-today-log-meal-1")).toBeNull();
    expect(queryByTestId("plan-today-swap-meal-1")).toBeNull();
  });

  it("fires onLogMeal / onSwapMeal with the full PlanMeal", () => {
    const onLogMeal = jest.fn();
    const onSwapMeal = jest.fn();
    const { getByTestId } = renderWithTheme(
      <PlanTodayPresenter {...props({ onLogMeal, onSwapMeal })} />,
    );
    fireEvent.press(getByTestId("plan-today-log-meal-2"));
    expect(onLogMeal).toHaveBeenCalledWith(
      expect.objectContaining({ id: "meal-2" }),
    );
    fireEvent.press(getByTestId("plan-today-swap-meal-2"));
    expect(onSwapMeal).toHaveBeenCalledWith(
      expect.objectContaining({ id: "meal-2" }),
    );
  });

  it("disables the Log button while THAT meal is mid-log", () => {
    const { getByTestId } = renderWithTheme(
      <PlanTodayPresenter {...props({ loggingMealId: "meal-2" })} />,
    );
    expect(
      getByTestId("plan-today-log-meal-2").props.accessibilityState?.disabled,
    ).toBe(true);
  });

  it("fires onBack and onDeletePlan from the header", () => {
    const onBack = jest.fn();
    const onDeletePlan = jest.fn();
    const { getByTestId } = renderWithTheme(
      <PlanTodayPresenter {...props({ onBack, onDeletePlan })} />,
    );
    fireEvent.press(getByTestId("plan-today-back"));
    expect(onBack).toHaveBeenCalled();
    fireEvent.press(getByTestId("plan-today-delete"));
    expect(onDeletePlan).toHaveBeenCalled();
  });

  it("disables delete while deleting", () => {
    const { getByTestId } = renderWithTheme(
      <PlanTodayPresenter {...props({ deleting: true })} />,
    );
    expect(
      getByTestId("plan-today-delete").props.accessibilityState?.disabled,
    ).toBe(true);
  });

  it("shows the basket icon and fires onOpenShoppingList when there's a plan", () => {
    const onOpenShoppingList = jest.fn();
    const { getByTestId } = renderWithTheme(
      <PlanTodayPresenter {...props({ onOpenShoppingList })} />,
    );
    fireEvent.press(getByTestId("plan-today-shopping"));
    expect(onOpenShoppingList).toHaveBeenCalled();
  });

  it("does not render the basket icon when there is no plan", () => {
    const { queryByTestId } = renderWithTheme(
      <PlanTodayPresenter {...props({ loading: false, plan: null })} />,
    );
    expect(queryByTestId("plan-today-shopping")).toBeNull();
  });

  it("renders the action-failure banner with its message when set", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <PlanTodayPresenter
        {...props({
          actionFailure:
            "You've used all of today's swaps — they reset tomorrow.",
        })}
      />,
    );
    expect(getByTestId("plan-today-action-error")).toBeTruthy();
    expect(
      getByText("You've used all of today's swaps — they reset tomorrow."),
    ).toBeTruthy();
  });

  it("renders no action-failure banner when actionFailure is null", () => {
    const { queryByTestId } = renderWithTheme(
      <PlanTodayPresenter {...props({ actionFailure: null })} />,
    );
    expect(queryByTestId("plan-today-action-error")).toBeNull();
  });
});
