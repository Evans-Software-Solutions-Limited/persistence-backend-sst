import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { FuelPresenter, type FuelPresenterProps } from "../FuelPresenter";
import type { MealSlotVM } from "../MealLogPresenter";

const slots: MealSlotVM[] = [
  { slot: "breakfast", label: "Breakfast", kcal: 0, rows: [] },
  { slot: "lunch", label: "Lunch", kcal: 0, rows: [] },
  { slot: "snack", label: "Snack", kcal: 0, rows: [] },
  { slot: "dinner", label: "Dinner", kcal: 0, rows: [] },
];

function render(over: Partial<FuelPresenterProps> = {}) {
  const props: FuelPresenterProps = {
    dateLabel: "MONDAY · MAR 25",
    hasData: true,
    isLoading: false,
    isRefreshing: false,
    error: null,
    onRefresh: jest.fn(),
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
});
