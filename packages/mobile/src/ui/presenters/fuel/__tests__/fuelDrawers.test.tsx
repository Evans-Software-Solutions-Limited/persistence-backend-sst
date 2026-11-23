import { act, fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { reorderableTestApi } from "../../../../../__tests__/reorderable-test-api";
import {
  YourMealsSheetPresenter,
  type YourMealsSheetProps,
} from "../YourMealsSheetPresenter";
import { MealOptionsSheetPresenter } from "../MealOptionsSheetPresenter";
import { SuggestLockedSheetPresenter } from "../SuggestLockedSheetPresenter";
import {
  QuickLogSheetPresenter,
  type QuickLogSheetProps,
} from "../QuickLogSheetPresenter";
import { ringSegments, MACRO_HEX } from "../FuelLogSummaryPresenter";

describe("YourMealsSheetPresenter (N1b)", () => {
  const meals = [
    { id: "a", name: "Breakfast", sub: "Default" },
    { id: "b", name: "Pre-workout", sub: "Added by you" },
    { id: "c", name: "Lunch", sub: "Default" },
  ];
  const render = (over: Partial<YourMealsSheetProps> = {}) => {
    const props: YourMealsSheetProps = {
      visible: true,
      onClose: jest.fn(),
      meals,
      editable: true,
      full: false,
      onRename: jest.fn(),
      onReorder: jest.fn(),
      onAdd: jest.fn(),
      ...over,
    };
    return {
      ...renderWithTheme(<YourMealsSheetPresenter {...props} />),
      props,
    };
  };

  it("lists meals with Default / Added by you and no stale plan subtitle", () => {
    const { getByText, queryByText } = render();
    expect(getByText("Breakfast")).toBeTruthy();
    expect(getByText("Pre-workout")).toBeTruthy();
    expect(getByText("Added by you")).toBeTruthy();
    expect(queryByText(/Days on a plan/)).toBeNull();
  });

  it("renames a meal inline", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("your-meal-rename-b"));
    const input = getByTestId("your-meal-rename-input-b");
    fireEvent.changeText(input, "Pre-gym");
    fireEvent(input, "submitEditing");
    expect(props.onRename).toHaveBeenCalledWith("b", "Pre-gym");
  });

  it("does nothing when a rename is unchanged or blank", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("your-meal-rename-b"));
    fireEvent(getByTestId("your-meal-rename-input-b"), "submitEditing");
    fireEvent.press(getByTestId("your-meal-rename-c"));
    const input = getByTestId("your-meal-rename-input-c");
    fireEvent.changeText(input, "  ");
    fireEvent(input, "blur");
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it("adds a meal", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("your-meals-sheet-add"));
    const input = getByTestId("your-meals-sheet-new-name");
    fireEvent.changeText(input, "Supper");
    fireEvent(input, "submitEditing");
    expect(props.onAdd).toHaveBeenCalledWith("Supper");
  });

  it("reorders by drag and by Move up / Move down", () => {
    const { getByTestId, props } = render();
    act(() => {
      reorderableTestApi.dragStart("a");
      reorderableTestApi.drop("a", 2, { a: 2, b: 0, c: 1 });
    });
    expect(props.onReorder).toHaveBeenCalledWith(["b", "c", "a"]);
    fireEvent(getByTestId("reorder-2"), "accessibilityAction", {
      nativeEvent: { actionName: "decrement" },
    });
    expect(props.onReorder).toHaveBeenLastCalledWith(["b", "a", "c"]);
  });

  it("is read-only with a note until the list has been fetched", () => {
    const { getByTestId, queryByTestId, props } = render({ editable: false });
    expect(getByTestId("your-meals-sheet-offline")).toBeTruthy();
    expect(queryByTestId("your-meal-rename-a")).toBeNull();
    act(() => {
      reorderableTestApi.dragStart("a");
      reorderableTestApi.drop("a", 2, { a: 2, b: 0, c: 1 });
    });
    expect(props.onReorder).not.toHaveBeenCalled();
    fireEvent.press(getByTestId("your-meals-sheet-done"));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("closes the inline editors when hidden", () => {
    const { getByTestId, queryByTestId, rerender, props } = render();
    fireEvent.press(getByTestId("your-meals-sheet-add"));
    rerender(<YourMealsSheetPresenter {...props} visible={false} />);
    rerender(<YourMealsSheetPresenter {...props} visible />);
    expect(queryByTestId("your-meals-sheet-new-name")).toBeNull();
  });
});

describe("MealOptionsSheetPresenter", () => {
  it("offers the four options and cancel", () => {
    const h = {
      onClose: jest.fn(),
      onCopy: jest.fn(),
      onSaveAsMeal: jest.fn(),
      onEditMeals: jest.fn(),
      onClear: jest.fn(),
    };
    const { getByTestId, getByText } = renderWithTheme(
      <MealOptionsSheetPresenter
        visible
        mealName="Lunch"
        hasEntries
        canSaveAsMeal
        {...h}
      />,
    );
    expect(getByText("Clear Lunch")).toBeTruthy();
    fireEvent.press(getByTestId("meal-options-sheet-copy"));
    fireEvent.press(getByTestId("meal-options-sheet-save"));
    fireEvent.press(getByTestId("meal-options-sheet-edit"));
    fireEvent.press(getByTestId("meal-options-sheet-clear"));
    fireEvent.press(getByTestId("meal-options-sheet-cancel"));
    for (const fn of Object.values(h)) expect(fn).toHaveBeenCalledTimes(1);
  });

  it("hides Save and Clear for an empty meal", () => {
    const { queryByTestId } = renderWithTheme(
      <MealOptionsSheetPresenter
        visible
        mealName="Lunch"
        hasEntries={false}
        canSaveAsMeal={false}
        onClose={jest.fn()}
        onCopy={jest.fn()}
        onSaveAsMeal={jest.fn()}
        onEditMeals={jest.fn()}
        onClear={jest.fn()}
      />,
    );
    expect(queryByTestId("meal-options-sheet-save")).toBeNull();
    expect(queryByTestId("meal-options-sheet-clear")).toBeNull();
  });
});

describe("SuggestLockedSheetPresenter (N26, Free and Premium)", () => {
  it("shows the Premium+ pitch with no taster, no price and no 'Core'", () => {
    const onUpgrade = jest.fn();
    const onClose = jest.fn();
    const { getByText, queryByText, getByTestId } = renderWithTheme(
      <SuggestLockedSheetPresenter
        visible
        onClose={onClose}
        onUpgrade={onUpgrade}
      />,
    );
    expect(getByText("Meals that fit what's left.")).toBeTruthy();
    expect(getByText("Premium+")).toBeTruthy();
    expect(getByText("One meal, right now")).toBeTruthy();
    expect(queryByText(/Core/)).toBeNull();
    expect(queryByText(/£|\$/)).toBeNull();
    fireEvent.press(getByTestId("suggest-locked-sheet-upgrade"));
    fireEvent.press(getByTestId("suggest-locked-sheet-not-now"));
    expect(onUpgrade).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("QuickLogSheetPresenter (N2e)", () => {
  const base: QuickLogSheetProps = {
    visible: true,
    onClose: jest.fn(),
    values: { name: "", kcal: "", protein: "", carbs: "", fat: "" },
    onChange: jest.fn(),
    meals: [
      { key: "a", label: "Breakfast" },
      { key: "b", label: "Lunch" },
    ],
    selectedMealKey: "b",
    onSelectMeal: jest.fn(),
    warning: null,
    kcalLabel: "",
    mealLabel: "Lunch",
    canLog: false,
    onLog: jest.fn(),
  };

  it("types into each field and picks a meal", () => {
    const { getByTestId } = renderWithTheme(
      <QuickLogSheetPresenter {...base} />,
    );
    fireEvent.changeText(getByTestId("quick-log-sheet-kcal"), "450");
    fireEvent.changeText(getByTestId("quick-log-sheet-name"), "Burrito");
    expect(base.onChange).toHaveBeenCalledWith("kcal", "450");
    expect(base.onChange).toHaveBeenCalledWith("name", "Burrito");
    fireEvent.press(getByTestId("quick-log-sheet-meal-a"));
    expect(base.onSelectMeal).toHaveBeenCalledWith("a");
    expect(
      getByTestId("quick-log-sheet-log").props.accessibilityState.disabled,
    ).toBe(true);
  });

  it("names the calories and meal on the button and shows the warning", () => {
    const onLog = jest.fn();
    const { getByText, getByTestId } = renderWithTheme(
      <QuickLogSheetPresenter
        {...base}
        canLog
        onLog={onLog}
        kcalLabel="450"
        warning="Your macros add up to 515 kcal. We'll log the 450 you typed."
      />,
    );
    expect(getByText("Log 450 kcal to Lunch")).toBeTruthy();
    expect(getByTestId("quick-log-sheet-warning")).toBeTruthy();
    fireEvent.press(getByTestId("quick-log-sheet-log"));
    expect(onLog).toHaveBeenCalled();
  });
});

describe("ringSegments", () => {
  it("splits the filled arc by each macro's calories, in canvas order", () => {
    const segs = ringSegments(50, 10, 25, 0.5);
    expect(segs.map((s) => s.color)).toEqual([
      MACRO_HEX.carbs,
      MACRO_HEX.fat,
      MACRO_HEX.protein,
    ]);
    expect(segs[0]!.offset).toBeCloseTo(0);
    expect(segs[1]!.offset).toBeLessThan(0);
    expect(ringSegments(0, 0, 0, 0)).toEqual([]);
  });
});
