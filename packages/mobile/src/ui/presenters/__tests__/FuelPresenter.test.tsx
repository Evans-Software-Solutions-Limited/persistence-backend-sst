import { fireEvent } from "@testing-library/react-native";
import { localDayISO, previousDayISO } from "@/shared/utils";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { FuelPresenter, type FuelPresenterProps } from "../FuelPresenter";
import type { MealSlotVM } from "../MealLogPresenter";

const slots: MealSlotVM[] = [
  { slot: "breakfast", label: "Breakfast", kcal: 0, rows: [] },
  { slot: "lunch", label: "Lunch", kcal: 0, rows: [] },
  { slot: "snack", label: "Snack", kcal: 0, rows: [] },
  { slot: "dinner", label: "Dinner", kcal: 0, rows: [] },
];

const todayIso = localDayISO();
const yesterdayIso = previousDayISO(todayIso);

function render(over: Partial<FuelPresenterProps> = {}) {
  const props: FuelPresenterProps = {
    dateLabel: "MONDAY · MAR 25",
    selectedDate: todayIso,
    canGoNext: false,
    hasData: true,
    isLoading: false,
    isRefreshing: false,
    error: null,
    onRefresh: jest.fn(),
    onPrevDay: jest.fn(),
    onNextDay: jest.fn(),
    calendarOpen: false,
    onCloseCalendar: jest.fn(),
    onSelectDate: jest.fn(),
    remainingKcal: 260,
    consumedKcal: 1840,
    targetKcal: 2100,
    ringPct: 0.88,
    macros: [
      {
        label: "Protein",
        value: 142,
        target: 170,
        color: "#22D3EE",
        pct: 0.83,
      },
      { label: "Carbs", value: 210, target: 240, color: "#F5C518", pct: 0.87 },
      { label: "Fat", value: 58, target: 70, color: "#FB923C", pct: 0.82 },
    ],
    celebrate: false,
    noTarget: false,
    aiLocked: true,
    slots,
    waterCups: 6,
    waterGoal: 8,
    onOpenTargets: jest.fn(),
    onOpenCalendar: jest.fn(),
    onScan: jest.fn(),
    onSnap: jest.fn(),
    onSearch: jest.fn(),
    onRecipes: jest.fn(),
    onAddToSlot: jest.fn(),
    onSetWater: jest.fn(),
    onPressRow: jest.fn(),
    onLog: jest.fn(),
    ...over,
  };
  return { ...renderWithTheme(<FuelPresenter {...props} />), props };
}

describe("FuelPresenter", () => {
  it("renders the hero, quick-add row, meal log, and water tracker when data is present", () => {
    const { getByTestId } = render();
    expect(getByTestId("fuel-macro-hero")).toBeTruthy();
    expect(getByTestId("fuel-quick-add")).toBeTruthy();
    expect(getByTestId("fuel-meal-log")).toBeTruthy();
    expect(getByTestId("fuel-water")).toBeTruthy();
  });

  it("shows a blocking loader when loading with no cache", () => {
    const { getByTestId, queryByTestId } = render({
      isLoading: true,
      hasData: false,
    });
    expect(getByTestId("fuel-screen")).toBeTruthy();
    expect(queryByTestId("fuel-macro-hero")).toBeNull();
  });

  it("shows an error state when the fetch fails with no cache", () => {
    const { getByText, props } = render({
      isLoading: false,
      hasData: false,
      error: { code: "network", message: "down" } as never,
    });
    const retry = getByText("Retry");
    expect(retry).toBeTruthy();
    fireEvent.press(retry);
    expect(props.onRefresh).toHaveBeenCalled();
  });

  it("opens targets + calendar from the header", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("fuel-open-targets"));
    fireEvent.press(getByTestId("fuel-open-calendar"));
    expect(props.onOpenTargets).toHaveBeenCalledTimes(1);
    expect(props.onOpenCalendar).toHaveBeenCalledTimes(1);
  });

  it("shows the day label in the day-nav row", () => {
    const { getByText } = render({ dateLabel: "TUESDAY · JUL 21" });
    expect(getByText("TUESDAY · JUL 21")).toBeTruthy();
  });

  describe("day navigation (BRIEF-7 QA-19)", () => {
    it("steps back a day via the previous chevron", () => {
      const { getByTestId, props } = render();
      fireEvent.press(getByTestId("fuel-prev-day"));
      expect(props.onPrevDay).toHaveBeenCalledTimes(1);
    });

    it("steps forward a day via the next chevron when not viewing today", () => {
      const { getByTestId, props } = render({ canGoNext: true });
      fireEvent.press(getByTestId("fuel-next-day"));
      expect(props.onNextDay).toHaveBeenCalledTimes(1);
    });

    it("disables the next-day chevron when viewing today", () => {
      const { getByTestId, props } = render({ canGoNext: false });
      fireEvent.press(getByTestId("fuel-next-day"));
      expect(props.onNextDay).not.toHaveBeenCalled();
      expect(
        getByTestId("fuel-next-day").props.accessibilityState.disabled,
      ).toBe(true);
    });
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
      const { getByTestId } = render({
        selectedDate: todayIso,
        calendarOpen: true,
      });
      const before = getByTestId("fuel-calendar-modal-month-label").props
        .children;
      fireEvent.press(getByTestId("fuel-calendar-modal-prev-month"));
      const after = getByTestId("fuel-calendar-modal-month-label").props
        .children;
      expect(after).not.toBe(before);
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
});
