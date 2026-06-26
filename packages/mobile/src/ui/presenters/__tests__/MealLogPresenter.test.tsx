import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  MealLogPresenter,
  type MealLogProps,
  type MealSlotVM,
} from "../MealLogPresenter";

const slots: MealSlotVM[] = [
  {
    slot: "breakfast",
    label: "Breakfast",
    kcal: 480,
    rows: [
      { id: "e1", name: "Oatmeal w/ berries", sub: "1 serving", kcal: 320 },
      { id: "e2", name: "Greek yogurt", sub: "1 serving", kcal: 160 },
    ],
  },
  { slot: "lunch", label: "Lunch", kcal: 0, rows: [] },
  { slot: "snack", label: "Snack", kcal: 0, rows: [] },
  { slot: "dinner", label: "Dinner", kcal: 0, rows: [] },
];

function render(over: Partial<MealLogProps> = {}) {
  const props: MealLogProps = {
    slots,
    onAddToSlot: jest.fn(),
    onPressRow: jest.fn(),
    ...over,
  };
  return { ...renderWithTheme(<MealLogPresenter {...props} />), props };
}

describe("MealLogPresenter", () => {
  it("renders all four meal sections", () => {
    const { getByTestId } = render();
    expect(getByTestId("fuel-slot-breakfast")).toBeTruthy();
    expect(getByTestId("fuel-slot-lunch")).toBeTruthy();
    expect(getByTestId("fuel-slot-snack")).toBeTruthy();
    expect(getByTestId("fuel-slot-dinner")).toBeTruthy();
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

  it("fires onAddToSlot with the slot", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("fuel-slot-add-lunch"));
    expect(props.onAddToSlot).toHaveBeenCalledWith("lunch");
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
});
