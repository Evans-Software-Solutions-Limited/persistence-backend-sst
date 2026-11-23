import { fireEvent, within } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  MealLogPresenter,
  type MealLogProps,
  type MealSlotVM,
} from "../MealLogPresenter";

const slots: MealSlotVM[] = [
  {
    key: "m-breakfast",
    slot: "breakfast",
    label: "Breakfast",
    kcal: 480,
    macroLine: "62g C · 10g F · 27g P",
    rows: [
      {
        id: "e1",
        name: "Oatmeal w/ berries",
        sub: "1 serving",
        kcal: 320,
        proteinG: 12,
        carbsG: 54,
        fatG: 6,
      },
      {
        id: "e2",
        name: "Greek yogurt",
        sub: "1 serving",
        kcal: 160,
        proteinG: 15,
        carbsG: 8,
        fatG: 4,
      },
    ],
  },
  { key: "m-lunch", slot: "lunch", label: "Lunch", kcal: 0, rows: [] },
  { key: "m-snack", slot: "snack", label: "Snack", kcal: 0, rows: [] },
  { key: "m-dinner", slot: "dinner", label: "Dinner", kcal: 0, rows: [] },
];

function render(over: Partial<MealLogProps> = {}) {
  const props: MealLogProps = {
    slots,
    onAddToMeal: jest.fn(),
    onPressRow: jest.fn(),
    ...over,
  };
  return { ...renderWithTheme(<MealLogPresenter {...props} />), props };
}

describe("MealLogPresenter", () => {
  it("renders one section per meal, keyed by meal", () => {
    const { getByTestId } = render();
    expect(getByTestId("fuel-meal-m-breakfast")).toBeTruthy();
    expect(getByTestId("fuel-meal-m-lunch")).toBeTruthy();
    expect(getByTestId("fuel-meal-m-snack")).toBeTruthy();
    expect(getByTestId("fuel-meal-m-dinner")).toBeTruthy();
  });

  it("shows the per-meal calorie and macro summary only when something is logged (PER-132)", () => {
    const { getByTestId, queryByTestId } = render();
    expect(getByTestId("fuel-meal-kcal-m-breakfast").props.children).toEqual([
      "480",
      " kcal",
    ]);
    expect(getByTestId("fuel-meal-macros-m-breakfast").props.children).toBe(
      "62g C · 10g F · 27g P",
    );
    expect(queryByTestId("fuel-meal-kcal-m-lunch")).toBeNull();
    expect(queryByTestId("fuel-meal-macros-m-lunch")).toBeNull();
  });

  it("opens a meal's options and Your meals when those are wired", () => {
    const onMealOptions = jest.fn();
    const onEditMeals = jest.fn();
    const { getByTestId } = render({ onMealOptions, onEditMeals });
    fireEvent.press(getByTestId("fuel-meal-more-m-lunch"));
    expect(onMealOptions).toHaveBeenCalledWith("m-lunch");
    fireEvent.press(getByTestId("fuel-edit-meals"));
    expect(onEditMeals).toHaveBeenCalled();
  });

  it("hides the options button and the edit chip when not wired", () => {
    const { queryByTestId } = render();
    expect(queryByTestId("fuel-meal-more-m-lunch")).toBeNull();
    expect(queryByTestId("fuel-edit-meals")).toBeNull();
  });

  it("renders entry rows with their resolved names", () => {
    const { getByText } = render();
    expect(getByText("Oatmeal w/ berries")).toBeTruthy();
    expect(getByText("Greek yogurt")).toBeTruthy();
  });

  it("shows an empty state for slots with no entries", () => {
    const { getAllByText } = render();
    expect(getAllByText("Nothing logged yet").length).toBe(3);
  });

  it("fires onAddToMeal with the meal key", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("fuel-meal-add-m-lunch"));
    expect(props.onAddToMeal).toHaveBeenCalledWith("m-lunch");
  });

  it("fires onPressRow with the entry id + slot", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("fuel-entry-e1"));
    expect(props.onPressRow).toHaveBeenCalledWith("e1", "breakfast");
  });

  it("renders read-only rows when no onPressRow is supplied", () => {
    const { getByText } = render({ onPressRow: undefined });
    expect(getByText("Oatmeal w/ berries")).toBeTruthy();
  });

  it("shows a P/C/F macro line under each entry", () => {
    const { getByTestId } = render();
    expect(getByTestId("fuel-entry-macros-e1").props.children).toBe(
      "P 12g · C 54g · F 6g",
    );
  });

  it("fires onDeleteEntry with the entry id + slot when the swipe Delete is tapped", () => {
    const onDeleteEntry = jest.fn();
    const { getByTestId } = render({ onDeleteEntry });
    // The mocked Swipeable renders the right-action eagerly, so the Delete
    // panel is present without driving a gesture.
    fireEvent.press(getByTestId("fuel-entry-delete-e1"));
    expect(onDeleteEntry).toHaveBeenCalledWith("e1", "breakfast");
  });

  it("renders no swipe Delete affordance when onDeleteEntry is absent", () => {
    const { queryByTestId } = render({ onDeleteEntry: undefined });
    expect(queryByTestId("fuel-entry-delete-e1")).toBeNull();
  });

  // ─── spec-26 Phase 2 — ghost rows (AC 5.1/5.2) ────────────────────────────

  describe("ghost rows", () => {
    const ghostSlots: MealSlotVM[] = [
      {
        key: "m-breakfast",
        slot: "breakfast",
        label: "Breakfast",
        kcal: 0,
        rows: [],
      },
      { key: "m-lunch", slot: "lunch", label: "Lunch", kcal: 0, rows: [] },
      { key: "m-snack", slot: "snack", label: "Snack", kcal: 0, rows: [] },
      {
        key: "m-dinner",
        slot: "dinner",
        label: "Dinner",
        kcal: 0,
        rows: [],
        ghostRows: [
          {
            planId: "plan-1",
            planMealId: "meal-1",
            label: "Chicken & rice bowl",
            kcal: 640,
          },
        ],
      },
    ];

    it("renders a ghost row for a planned-but-unlogged meal, distinct from a real row", () => {
      const { getByTestId, getByText } = render({
        slots: ghostSlots,
        onLogGhost: jest.fn(),
      });
      expect(getByTestId("fuel-ghost-meal-1")).toBeTruthy();
      expect(getByText(/Chicken & rice bowl · 640 kcal/)).toBeTruthy();
      expect(getByText("PLANNED")).toBeTruthy();
    });

    it("shows 'Nothing logged yet' only for the three EMPTY slots, not dinner (which has a ghost row)", () => {
      // ⚠ Load-bearing on the exact count: `ghostSlots` has three genuinely
      // empty slots (breakfast/lunch/snack) and one (dinner) with a ghost row
      // but no logged rows. If the ghost-row branch failed to suppress the
      // empty-state fallback, dinner would ALSO render "Nothing logged yet",
      // making this 4 instead of 3.
      const { getAllByText, getByTestId } = render({
        slots: ghostSlots,
        onLogGhost: jest.fn(),
      });
      expect(getAllByText("Nothing logged yet")).toHaveLength(3);
      expect(
        within(getByTestId("fuel-meal-m-dinner")).queryByText(
          "Nothing logged yet",
        ),
      ).toBeNull();
    });

    it("'Log it' fires onLogGhost with (planId, planMealId, slot)", () => {
      const onLogGhost = jest.fn();
      const { getByTestId } = render({ slots: ghostSlots, onLogGhost });
      fireEvent.press(getByTestId("fuel-ghost-log-meal-1"));
      expect(onLogGhost).toHaveBeenCalledWith("plan-1", "meal-1", "dinner");
    });

    it("renders the ghost row read-only (no Log it button) when onLogGhost is omitted", () => {
      const { getByTestId, queryByTestId } = render({ slots: ghostSlots });
      expect(getByTestId("fuel-ghost-meal-1")).toBeTruthy();
      expect(queryByTestId("fuel-ghost-log-meal-1")).toBeNull();
    });
  });
});
