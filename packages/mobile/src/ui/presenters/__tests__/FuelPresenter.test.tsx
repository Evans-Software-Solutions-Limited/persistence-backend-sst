import { fireEvent } from "@testing-library/react-native";
import { localDayISO, previousDayISO } from "@/shared/utils";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { FuelPresenter, type FuelPresenterProps } from "../FuelPresenter";
import type { MealSlotVM } from "../MealLogPresenter";
import type { WeekDayVM } from "../fuel/FuelLogHeaderPresenter";

const slots: MealSlotVM[] = [
  { key: "m1", slot: "breakfast", label: "Breakfast", kcal: 0, rows: [] },
  { key: "m2", slot: "lunch", label: "Lunch", kcal: 0, rows: [] },
  { key: "m3", slot: "snack", label: "Snack", kcal: 0, rows: [] },
  { key: "m4", slot: "dinner", label: "Dinner", kcal: 0, rows: [] },
];

const todayIso = localDayISO();
const yesterdayIso = previousDayISO(todayIso);

const week: WeekDayVM[] = [
  {
    iso: yesterdayIso,
    dayName: "Thu",
    dayNum: "22",
    state: "over",
    selected: false,
  },
  {
    iso: todayIso,
    dayName: "Fri",
    dayNum: "23",
    state: "today",
    selected: true,
  },
  {
    iso: "2999-01-01",
    dayName: "Sat",
    dayNum: "24",
    state: "future",
    selected: false,
  },
];

function render(over: Partial<FuelPresenterProps> = {}) {
  const props: FuelPresenterProps = {
    dateLabel: "Fri 23 Oct",
    selectedDate: todayIso,
    hasData: true,
    isLoading: false,
    isRefreshing: false,
    error: null,
    onRefresh: jest.fn(),
    section: "log",
    onSection: jest.fn(),
    week,
    onSelectDay: jest.fn(),
    calendarOpen: false,
    onOpenCalendar: jest.fn(),
    onCloseCalendar: jest.fn(),
    onSelectDate: jest.fn(),
    consumedKcal: 1840,
    targetKcal: 2100,
    consumedProteinG: 142,
    consumedCarbsG: 210,
    consumedFatG: 58,
    macros: [
      { label: "Protein", eatenG: 142, targetG: 170, color: "#34D399" },
      { label: "Carbs", eatenG: 210, targetG: 240, color: "#22D3EE" },
      { label: "Fat", eatenG: 58, targetG: 70, color: "#FB923C" },
    ],
    noTarget: false,
    quickActions: {
      aiLocked: false,
      snapOffline: false,
      suggestLocked: true,
      onScan: jest.fn(),
      onSnap: jest.fn(),
      onSearch: jest.fn(),
      onQuickLog: jest.fn(),
      onSuggest: jest.fn(),
    },
    mealprintPlanProgress: null,
    onEditPlan: jest.fn(),
    onClearPlan: jest.fn(),
    slots,
    onAddToMeal: jest.fn(),
    onMealOptions: jest.fn(),
    onEditMeals: jest.fn(),
    waterCups: 6,
    waterGoal: 8,
    onOpenTargets: jest.fn(),
    onSetWater: jest.fn(),
    onPressRow: jest.fn(),
    ...over,
  };
  return { ...renderWithTheme(<FuelPresenter {...props} />), props };
}

describe("FuelPresenter", () => {
  it("renders canvas N1: header, week, compact rings, quick buttons, meals and water", () => {
    const { getByTestId, queryByTestId } = render();
    expect(getByTestId("fuel-log-header")).toBeTruthy();
    expect(getByTestId("fuel-week")).toBeTruthy();
    expect(getByTestId("fuel-log-summary")).toBeTruthy();
    expect(getByTestId("fuel-quick-actions")).toBeTruthy();
    expect(getByTestId("fuel-meal-log")).toBeTruthy();
    expect(getByTestId("fuel-water")).toBeTruthy();
    // The old hero, 4-button row and Mealprint card are gone.
    expect(queryByTestId("fuel-macro-hero")).toBeNull();
    expect(queryByTestId("fuel-quick-add")).toBeNull();
    expect(queryByTestId("mealprint-entry-card")).toBeNull();
  });

  it("shows Left in the ring and Eaten · Target · Left in the strip", () => {
    const { getByTestId, getByText, getAllByText } = render();
    expect(getByTestId("fuel-log-summary-centre").props.children).toBe("260");
    expect(getByText("1,840")).toBeTruthy();
    expect(getByText("2,100")).toBeTruthy();
    // Ring centre label + strip cell.
    expect(getAllByText("Left")).toHaveLength(2);
  });

  it("says Over plainly when over target", () => {
    const { getByTestId, getByText } = render({ consumedKcal: 2300 });
    expect(getByTestId("fuel-log-summary-centre").props.children).toBe("200");
    expect(getByText("+200")).toBeTruthy();
    expect(getByTestId("fuel-log-summary-over")).toBeTruthy();
  });

  it("shows dashes and opens Targets from the strip with no target", () => {
    const { getByTestId, props } = render({ noTarget: true });
    expect(getByTestId("fuel-log-summary-centre").props.children).toBe("—");
    fireEvent.press(getByTestId("fuel-log-summary-target"));
    expect(props.onOpenTargets).toHaveBeenCalled();
  });

  it("wires the five quick buttons and marks Suggest locked", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("fuel-quick-actions-scan"));
    fireEvent.press(getByTestId("fuel-quick-actions-snap"));
    fireEvent.press(getByTestId("fuel-quick-actions-search"));
    fireEvent.press(getByTestId("fuel-quick-actions-quick-log"));
    fireEvent.press(getByTestId("fuel-quick-actions-suggest"));
    expect(props.quickActions.onScan).toHaveBeenCalled();
    expect(props.quickActions.onSnap).toHaveBeenCalled();
    expect(props.quickActions.onSearch).toHaveBeenCalled();
    expect(props.quickActions.onQuickLog).toHaveBeenCalled();
    expect(props.quickActions.onSuggest).toHaveBeenCalled();
    expect(getByTestId("fuel-quick-actions-suggest-lock")).toBeTruthy();
  });

  it("disables Snap offline", () => {
    const onSnap = jest.fn();
    const { getByTestId, props } = render({
      quickActions: {
        ...render().props.quickActions,
        snapOffline: true,
        onSnap,
      },
    });
    fireEvent.press(getByTestId("fuel-quick-actions-snap"));
    expect(onSnap).not.toHaveBeenCalled();
    expect(props.quickActions.snapOffline).toBe(true);
  });

  it("switches sections and picks days from the week strip, never a future day", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("fuel-section-plan"));
    fireEvent.press(getByTestId("fuel-section-meals"));
    expect(props.onSection).toHaveBeenCalledWith("plan");
    expect(props.onSection).toHaveBeenCalledWith("meals");
    fireEvent.press(getByTestId(`fuel-week-${yesterdayIso}`));
    expect(props.onSelectDay).toHaveBeenCalledWith(yesterdayIso);
    fireEvent.press(getByTestId("fuel-week-2999-01-01"));
    expect(props.onSelectDay).toHaveBeenCalledTimes(1);
  });

  it("opens Add to a meal, a meal's options and Your meals", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("fuel-meal-add-m2"));
    fireEvent.press(getByTestId("fuel-meal-more-m2"));
    fireEvent.press(getByTestId("fuel-edit-meals"));
    expect(props.onAddToMeal).toHaveBeenCalledWith("m2");
    expect(props.onMealOptions).toHaveBeenCalledWith("m2");
    expect(props.onEditMeals).toHaveBeenCalled();
  });

  it("shows a blocking loader when loading with no cache", () => {
    const { getByTestId, queryByTestId } = render({
      isLoading: true,
      hasData: false,
    });
    expect(getByTestId("fuel-screen")).toBeTruthy();
    expect(queryByTestId("fuel-log-summary")).toBeNull();
  });

  it("shows an error state when the fetch fails with no cache", () => {
    const { getByText, props } = render({
      isLoading: false,
      hasData: false,
      error: { code: "network", message: "down" } as never,
    });
    fireEvent.press(getByText("Retry"));
    expect(props.onRefresh).toHaveBeenCalled();
  });

  it("opens targets + calendar from the header", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("fuel-open-targets"));
    fireEvent.press(getByTestId("fuel-open-calendar"));
    expect(props.onOpenTargets).toHaveBeenCalledTimes(1);
    expect(props.onOpenCalendar).toHaveBeenCalledTimes(1);
  });

  it("shows the day label beside the section switch", () => {
    const { getByTestId } = render({ dateLabel: "Tue 21 Jul" });
    expect(getByTestId("fuel-day-label").props.children).toBe("Tue 21 Jul");
  });

  describe("calendar modal (BRIEF-7 QA-19)", () => {
    it("renders nothing until calendarOpen is true (RN Modal visible=false)", () => {
      const { queryByTestId } = render({ calendarOpen: false });
      expect(queryByTestId("fuel-calendar-modal")).toBeNull();
    });

    it("renders once calendarOpen is true", () => {
      const { getByTestId } = render({ calendarOpen: true });
      expect(getByTestId("fuel-calendar-modal")).toBeTruthy();
    });

    it("selecting today's cell calls onSelectDate with today's ISO day", () => {
      const { getByTestId, props } = render({
        selectedDate: todayIso,
        calendarOpen: true,
      });
      fireEvent.press(getByTestId(`fuel-calendar-modal-day-${todayIso}`));
      expect(props.onSelectDate).toHaveBeenCalledWith(todayIso);
    });

    it("selecting yesterday's cell calls onSelectDate with yesterday's ISO day", () => {
      const { getByTestId, props } = render({
        selectedDate: yesterdayIso,
        calendarOpen: true,
      });
      fireEvent.press(getByTestId(`fuel-calendar-modal-day-${yesterdayIso}`));
      expect(props.onSelectDate).toHaveBeenCalledWith(yesterdayIso);
    });

    it("disables the next-month chevron while viewing the current month", () => {
      const { getByTestId } = render({
        selectedDate: todayIso,
        calendarOpen: true,
      });
      const nextMonth = getByTestId("fuel-calendar-modal-next-month");
      expect(nextMonth.props.accessibilityState.disabled).toBe(true);
    });

    it("paging to the previous month changes the displayed month label", () => {
      const { getByTestId, getByText, queryByText } = render({
        selectedDate: todayIso,
        calendarOpen: true,
      });
      const selected = new Date(`${todayIso}T00:00:00.000Z`);
      const previousMonth = new Date(
        Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth() - 1, 1),
      ).toLocaleDateString("en", { month: "long", timeZone: "UTC" });
      expect(queryByText(previousMonth)).toBeNull();
      fireEvent.press(getByTestId("fuel-calendar-modal-prev-month"));
      expect(getByText(previousMonth)).toBeTruthy();
    });

    it("closing via the X calls onCloseCalendar", () => {
      const { getByTestId, props } = render({
        selectedDate: todayIso,
        calendarOpen: true,
      });
      fireEvent.press(getByTestId("fuel-calendar-modal-close"));
      expect(props.onCloseCalendar).toHaveBeenCalledTimes(1);
    });

    it("closing via the backdrop calls onCloseCalendar", () => {
      const { getByTestId, props } = render({
        selectedDate: todayIso,
        calendarOpen: true,
      });
      fireEvent.press(getByTestId("fuel-calendar-modal-backdrop"));
      expect(props.onCloseCalendar).toHaveBeenCalledTimes(1);
    });
  });

  // spec-26 amendment 2026-08-fuel-plan-surfacing § B — Edit/Clear for the
  // day's active plan, surfaced on Fuel itself (not just plan-today).
  describe("plan actions (amendment 2026-08-fuel-plan-surfacing § B)", () => {
    const planProgress = {
      loggedCount: 1,
      totalCount: 3,
      nextMealLabel: "Chicken & rice bowl",
      nextMealKcal: 640,
    };

    it("renders nothing when there's no active plan", () => {
      const { queryByTestId } = render({ mealprintPlanProgress: null });
      expect(queryByTestId("fuel-plan-actions")).toBeNull();
    });

    it("renders the plan actions row when there's an active plan", () => {
      const { getByTestId } = render({ mealprintPlanProgress: planProgress });
      expect(getByTestId("fuel-plan-actions")).toBeTruthy();
      expect(getByTestId("fuel-plan-actions-edit")).toBeTruthy();
      expect(getByTestId("fuel-plan-actions-clear")).toBeTruthy();
    });

    it("Edit calls onEditPlan directly (no confirm step)", () => {
      const { getByTestId, props } = render({
        mealprintPlanProgress: planProgress,
      });
      fireEvent.press(getByTestId("fuel-plan-actions-edit"));
      expect(props.onEditPlan).toHaveBeenCalledTimes(1);
      expect(props.onClearPlan).not.toHaveBeenCalled();
    });

    it("Clear opens a confirm dialog rather than calling onClearPlan directly", () => {
      const { getByTestId, queryByTestId, props } = render({
        mealprintPlanProgress: planProgress,
      });
      expect(queryByTestId("clear-plan-confirm")).toBeNull();
      fireEvent.press(getByTestId("fuel-plan-actions-clear"));
      expect(getByTestId("clear-plan-confirm")).toBeTruthy();
      expect(props.onClearPlan).not.toHaveBeenCalled();
    });

    it("confirming the dialog calls onClearPlan", () => {
      const { getByTestId, props } = render({
        mealprintPlanProgress: planProgress,
      });
      fireEvent.press(getByTestId("fuel-plan-actions-clear"));
      fireEvent.press(getByTestId("clear-plan-confirm-confirm"));
      expect(props.onClearPlan).toHaveBeenCalledTimes(1);
    });

    it("cancelling the dialog dismisses it without calling onClearPlan", () => {
      const { getByTestId, queryByTestId, props } = render({
        mealprintPlanProgress: planProgress,
      });
      fireEvent.press(getByTestId("fuel-plan-actions-clear"));
      fireEvent.press(getByTestId("clear-plan-confirm-cancel"));
      expect(queryByTestId("clear-plan-confirm")).toBeNull();
      expect(props.onClearPlan).not.toHaveBeenCalled();
    });

    it("disables the dialog's CTAs while clearingPlan is true", () => {
      const { getByTestId } = render({
        mealprintPlanProgress: planProgress,
        clearingPlan: true,
      });
      fireEvent.press(getByTestId("fuel-plan-actions-clear"));
      expect(
        getByTestId("clear-plan-confirm-confirm").props.accessibilityState
          .disabled,
      ).toBe(true);
      expect(
        getByTestId("clear-plan-confirm-cancel").props.accessibilityState
          .disabled,
      ).toBe(true);
    });

    // ⚠ Revert-verifying: fails if the plan header/ghost rows/clear-confirm
    // wiring is ever made to feed the ring — planned meals are informational
    // only (amendment § A.1) and must never move `consumedKcal`/`ringPct`.
    it("an active plan's presence never changes the ring", () => {
      const withoutPlan = render({ mealprintPlanProgress: null });
      const withPlan = render({ mealprintPlanProgress: planProgress });
      expect(
        withPlan.getByTestId("fuel-log-summary-centre").props.children,
      ).toBe(withoutPlan.getByTestId("fuel-log-summary-centre").props.children);
    });
  });
});
