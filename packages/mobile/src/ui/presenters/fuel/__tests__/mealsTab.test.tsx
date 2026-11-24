/**
 * PER-133 N11–N14 presenters: the Meals tab, the Log sheet and the Add to
 * plan sheet.
 */
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import {
  MealsTabPresenter,
  type MealsTabPresenterProps,
  type MealsTabRowVM,
} from "../MealsTabPresenter";
import {
  LogMealSheetPresenter,
  type LogMealSheetProps,
} from "../LogMealSheetPresenter";
import {
  AddToPlanSheetPresenter,
  type AddToPlanSheetProps,
} from "../AddToPlanSheetPresenter";
import { MACRO_HEX } from "../FuelLogSummaryPresenter";

/** The photo tile is aria-hidden, as on the canvas. */
const HIDDEN = { includeHiddenElements: true };

const bagel: MealsTabRowVM = {
  key: "m:1",
  name: "Bagel breakfast",
  sub: "4 foods",
  photoUrl: null,
  kcal: 526,
  carbsG: 48,
  fatG: 21,
  proteinG: 34,
  canOpen: true,
};

describe("MealsTabPresenter (N11 / N12)", () => {
  const render = (over: Partial<MealsTabPresenterProps> = {}) => {
    const props: MealsTabPresenterProps = {
      query: "",
      onQuery: jest.fn(),
      library: "saved",
      onLibrary: jest.fn(),
      rows: [bagel],
      onOpen: jest.fn(),
      onLog: jest.fn(),
      loggingKey: null,
      ...over,
    };
    return { ...renderWithTheme(<MealsTabPresenter {...props} />), props };
  };

  it("shows the search box, the three chips and the saved meals eyebrow", () => {
    const { getByTestId, getByText, getByPlaceholderText } = render();
    expect(
      getByPlaceholderText("Search meals, recipes and foods"),
    ).toBeTruthy();
    expect(getByText("Saved meals")).toBeTruthy();
    expect(getByText("Recipes")).toBeTruthy();
    expect(getByText("Foods")).toBeTruthy();
    expect(
      getByTestId("meals-tab-chip-saved").props.accessibilityState,
    ).toEqual({ selected: true });
    expect(getByTestId("meals-tab-eyebrow").props.children).toBe(
      "Saved meals · used most",
    );
  });

  it.each([
    ["recipes", "Recipes"],
    ["foods", "Foods · recent"],
  ] as const)("the %s chip has its own eyebrow", (library, eyebrow) => {
    const { getByTestId } = render({ library });
    expect(getByTestId("meals-tab-eyebrow").props.children).toBe(eyebrow);
  });

  it("a row shows its name, sub line, C · F · P chips in macro colours and kcal", () => {
    const { getByText } = render({
      rows: [{ ...bagel, kcal: 1234.4 }],
    });
    expect(getByText("Bagel breakfast")).toBeTruthy();
    expect(getByText("4 foods")).toBeTruthy();
    expect(getByText("48g C").props.style).toEqual(
      expect.objectContaining({ color: MACRO_HEX.carbs }),
    );
    expect(getByText("21g F").props.style).toEqual(
      expect.objectContaining({ color: MACRO_HEX.fat }),
    );
    expect(getByText("34g P").props.style).toEqual(
      expect.objectContaining({ color: MACRO_HEX.protein }),
    );
    expect(getByText("1,234")).toBeTruthy();
  });

  it("the tile shows the photo when there is one, else the knife-and-fork icon", () => {
    const { getByTestId, queryByTestId, rerender, props } = render();
    expect(getByTestId("meals-photo-m:1-icon", HIDDEN)).toBeTruthy();
    expect(queryByTestId("meals-photo-m:1-image", HIDDEN)).toBeNull();
    rerender(
      <MealsTabPresenter
        {...props}
        rows={[{ ...bagel, photoUrl: "https://x.test/p.jpg" }]}
      />,
    );
    expect(getByTestId("meals-photo-m:1-image", HIDDEN)).toBeTruthy();
    expect(queryByTestId("meals-photo-m:1-icon", HIDDEN)).toBeNull();
  });

  it("hides the sub line and macro chips when there is nothing to show", () => {
    const { queryByText, getByText } = render({
      rows: [
        {
          ...bagel,
          sub: "",
          kcal: null,
          carbsG: null,
          fatG: null,
          proteinG: null,
        },
      ],
    });
    expect(queryByText("4 foods")).toBeNull();
    expect(queryByText("48g C")).toBeNull();
    expect(getByText("—")).toBeTruthy();
  });

  it("typing searches, chips switch, a row opens and + logs it", () => {
    const { getByTestId, getByLabelText, props } = render();
    fireEvent.changeText(getByTestId("meals-tab-search"), "bag");
    expect(props.onQuery).toHaveBeenCalledWith("bag");
    fireEvent.press(getByTestId("meals-tab-chip-recipes"));
    expect(props.onLibrary).toHaveBeenCalledWith("recipes");
    fireEvent.press(getByTestId("meals-open-m:1"));
    expect(props.onOpen).toHaveBeenCalledWith("m:1");
    fireEvent.press(getByLabelText("Log Bagel breakfast"));
    expect(props.onLog).toHaveBeenCalledWith("m:1");
  });

  it("a food row has no detail page and a row being logged has its + disabled", () => {
    const { getByTestId, props } = render({
      rows: [{ ...bagel, key: "f:1", canOpen: false }],
      loggingKey: "f:1",
    });
    fireEvent.press(getByTestId("meals-open-f:1"));
    expect(props.onOpen).not.toHaveBeenCalled();
    fireEvent.press(getByTestId("meals-log-f:1"));
    expect(props.onLog).not.toHaveBeenCalled();
  });

  it("says when the list is empty, and when the search matches nothing", () => {
    const { getByTestId, rerender, props } = render({
      rows: [],
      library: "recipes",
    });
    expect(getByTestId("meals-tab-empty").props.children).toBe(
      "No recipes yet.",
    );
    rerender(<MealsTabPresenter {...props} query=" katsu " />);
    expect(getByTestId("meals-tab-empty").props.children).toBe(
      "Nothing matches “katsu”.",
    );
  });
});

describe("LogMealSheetPresenter (N14)", () => {
  const render = (over: Partial<LogMealSheetProps> = {}) => {
    const props: LogMealSheetProps = {
      visible: true,
      onClose: jest.fn(),
      name: "Bagel breakfast",
      day: {
        options: [
          { key: "d0", label: "Today" },
          { key: "d1", label: "Yesterday" },
        ],
        selectedKey: "d0",
      },
      meal: {
        options: [
          { key: "b", label: "Breakfast" },
          { key: "l", label: "Lunch" },
        ],
        selectedKey: "b",
      },
      portion: {
        options: [
          { key: "1", label: "1×" },
          { key: "2", label: "2×" },
        ],
        selectedKey: "1",
      },
      openField: null,
      onToggleField: jest.fn(),
      onPick: jest.fn(),
      note: "526 kcal · leaves 1,975 today.",
      kcalLabel: "526",
      canLog: true,
      logging: false,
      onLog: jest.fn(),
      ...over,
    };
    return { ...renderWithTheme(<LogMealSheetPresenter {...props} />), props };
  };

  it("shows the canvas copy: title, Day / Meal / Portion, the note and the button", () => {
    const { getByText } = render();
    expect(getByText("Log Bagel breakfast")).toBeTruthy();
    expect(getByText("Day")).toBeTruthy();
    expect(getByText("Today")).toBeTruthy();
    expect(getByText("Meal")).toBeTruthy();
    expect(getByText("Breakfast")).toBeTruthy();
    expect(getByText("Portion")).toBeTruthy();
    expect(getByText("1×")).toBeTruthy();
    expect(getByText("526 kcal · leaves 1,975 today.")).toBeTruthy();
    expect(getByText("Log 526 kcal")).toBeTruthy();
  });

  it("a field opens its choices; picking one, logging and closing call back", () => {
    const { getByTestId, queryByTestId, props } = render({
      openField: "meal",
    });
    expect(queryByTestId("log-meal-sheet-day-options")).toBeNull();
    expect(
      getByTestId("log-meal-sheet-meal-b").props.accessibilityState,
    ).toEqual({ checked: true });
    fireEvent.press(getByTestId("log-meal-sheet-meal-l"));
    expect(props.onPick).toHaveBeenCalledWith("meal", "l");
    fireEvent.press(getByTestId("log-meal-sheet-day"));
    expect(props.onToggleField).toHaveBeenCalledWith("day");
    fireEvent.press(getByTestId("log-meal-sheet-log"));
    expect(props.onLog).toHaveBeenCalled();
    fireEvent.press(getByTestId("log-meal-sheet-close"));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("the button is off while logging and the note hides when empty", () => {
    const { getByTestId, queryByTestId, props } = render({
      logging: true,
      note: "",
    });
    fireEvent.press(getByTestId("log-meal-sheet-log"));
    expect(props.onLog).not.toHaveBeenCalled();
    expect(queryByTestId("log-meal-sheet-note")).toBeNull();
  });
});

describe("AddToPlanSheetPresenter (N13 Add to plan)", () => {
  const render = (over: Partial<AddToPlanSheetProps> = {}) => {
    const props: AddToPlanSheetProps = {
      visible: true,
      onClose: jest.fn(),
      itemName: "Bagel breakfast",
      plans: [
        { id: "p1", name: "Training day" },
        { id: "p2", name: "Rest day" },
      ],
      selectedPlanId: "p1",
      onSelectPlan: jest.fn(),
      meals: [
        { id: "pm1", name: "Breakfast" },
        { id: "pm2", name: "Lunch" },
      ],
      selectedMealId: "pm1",
      onSelectMeal: jest.fn(),
      note: "Adding to your Training day plan, not today's log",
      addLabel: "Add to Training day",
      canAdd: true,
      adding: false,
      onAdd: jest.fn(),
      ...over,
    };
    return {
      ...renderWithTheme(<AddToPlanSheetPresenter {...props} />),
      props,
    };
  };

  it("lists my plans and the picked plan's meals, and adds", () => {
    const { getByText, getByTestId, props } = render();
    expect(getByText("Add Bagel breakfast to a plan")).toBeTruthy();
    expect(
      getByText("Adding to your Training day plan, not today's log"),
    ).toBeTruthy();
    expect(
      getByTestId("add-to-plan-sheet-plan-p1").props.accessibilityState,
    ).toEqual({ checked: true });
    fireEvent.press(getByTestId("add-to-plan-sheet-plan-p2"));
    expect(props.onSelectPlan).toHaveBeenCalledWith("p2");
    fireEvent.press(getByTestId("add-to-plan-sheet-meal-pm2"));
    expect(props.onSelectMeal).toHaveBeenCalledWith("pm2");
    fireEvent.press(getByText("Add to Training day"));
    expect(props.onAdd).toHaveBeenCalled();
    fireEvent.press(getByTestId("add-to-plan-sheet-close"));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("says when the picked plan has no meals, and the button is off", () => {
    const { getByTestId, queryByTestId, props } = render({
      meals: [],
      canAdd: false,
      note: "",
    });
    expect(getByTestId("add-to-plan-sheet-no-meals")).toBeTruthy();
    expect(queryByTestId("add-to-plan-sheet-note")).toBeNull();
    fireEvent.press(getByTestId("add-to-plan-sheet-add"));
    expect(props.onAdd).not.toHaveBeenCalled();
  });

  it("with no plans of my own it says so and offers no button", () => {
    const { getByTestId, queryByTestId } = render({ plans: [] });
    expect(getByTestId("add-to-plan-sheet-empty")).toBeTruthy();
    expect(queryByTestId("add-to-plan-sheet-add")).toBeNull();
  });
});
