import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  SaveMealPresenter,
  type SaveMealPresenterProps,
  type SaveMealRowVM,
} from "../SaveMealPresenter";

const rows: SaveMealRowVM[] = [
  {
    entryId: "e1",
    label: "Today · Breakfast — Oatmeal · 480 kcal",
    selected: false,
  },
  {
    entryId: "e2",
    label: "Yesterday · Dinner — Salmon · 540 kcal",
    selected: true,
  },
];

function render(over: Partial<SaveMealPresenterProps> = {}) {
  const props: SaveMealPresenterProps = {
    name: "",
    onNameChange: jest.fn(),
    rows,
    onToggleRow: jest.fn(),
    canSave: false,
    isSaving: false,
    onSave: jest.fn(),
    onBack: jest.fn(),
    ...over,
  };
  return { ...renderWithTheme(<SaveMealPresenter {...props} />), props };
}

describe("SaveMealPresenter", () => {
  it("renders the header, name field, and logged-item rows", () => {
    const { getByTestId, getByText } = render();
    expect(getByTestId("save-meal-header")).toBeTruthy();
    expect(getByTestId("save-meal-name-input")).toBeTruthy();
    expect(getByText("Today · Breakfast — Oatmeal · 480 kcal")).toBeTruthy();
    expect(getByText("Yesterday · Dinner — Salmon · 540 kcal")).toBeTruthy();
  });

  it("typing a name calls onNameChange", () => {
    const { getByTestId, props } = render();
    fireEvent.changeText(getByTestId("save-meal-name-input"), "My meal");
    expect(props.onNameChange).toHaveBeenCalledWith("My meal");
  });

  it("tapping a row calls onToggleRow with its entry id", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("save-meal-row-e1"));
    expect(props.onToggleRow).toHaveBeenCalledWith("e1");
  });

  it("reflects the selected state via accessibilityState", () => {
    const { getByTestId } = render();
    expect(
      getByTestId("save-meal-row-e1").props.accessibilityState.checked,
    ).toBe(false);
    expect(
      getByTestId("save-meal-row-e2").props.accessibilityState.checked,
    ).toBe(true);
  });

  it("Save is disabled until canSave, and fires onSave when enabled", () => {
    const { getByTestId, rerender, props } = render({ canSave: false });
    fireEvent.press(getByTestId("save-meal-save"));
    expect(props.onSave).not.toHaveBeenCalled();

    rerender(<SaveMealPresenter {...props} canSave rows={rows} />);
    fireEvent.press(getByTestId("save-meal-save"));
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it("Back fires onBack", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("save-meal-back"));
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when there is nothing logged to build from", () => {
    const { getByTestId } = render({ rows: [] });
    expect(getByTestId("save-meal-empty")).toBeTruthy();
  });

  it("disables row presses while saving", () => {
    const { getByTestId, props } = render({ isSaving: true });
    fireEvent.press(getByTestId("save-meal-row-e1"));
    expect(props.onToggleRow).not.toHaveBeenCalled();
  });
});
