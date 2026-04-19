import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { ExerciseFiltersPresenter } from "../ExerciseFiltersPresenter";

jest.setTimeout(15_000);

function makeProps(
  overrides: Partial<Parameters<typeof ExerciseFiltersPresenter>[0]> = {},
): Parameters<typeof ExerciseFiltersPresenter>[0] {
  return {
    difficulties: [],
    equipment: [],
    muscleGroups: [],
    matchCount: 0,
    onToggleDifficulty: jest.fn(),
    onToggleEquipment: jest.fn(),
    onToggleMuscleGroup: jest.fn(),
    onClear: jest.fn(),
    onApply: jest.fn(),
    onClose: jest.fn(),
    ...overrides,
  };
}

describe("ExerciseFiltersPresenter", () => {
  it("renders a chip for every difficulty and every equipment type", () => {
    const { getByTestId } = renderWithTheme(
      <ExerciseFiltersPresenter {...makeProps()} />,
    );
    expect(getByTestId("filters-difficulty-beginner")).toBeTruthy();
    expect(getByTestId("filters-difficulty-expert")).toBeTruthy();
    expect(getByTestId("filters-equipment-barbell")).toBeTruthy();
    expect(getByTestId("filters-equipment-other")).toBeTruthy();
  });

  it("renders the muscle group picker", () => {
    const { getByTestId } = renderWithTheme(
      <ExerciseFiltersPresenter {...makeProps()} />,
    );
    expect(getByTestId("filters-muscle-picker")).toBeTruthy();
  });

  it("reflects selected difficulties/equipment/muscles via accessibilityState", () => {
    const { getByTestId } = renderWithTheme(
      <ExerciseFiltersPresenter
        {...makeProps({
          difficulties: ["beginner"],
          equipment: ["barbell"],
          muscleGroups: ["chest"],
        })}
      />,
    );
    expect(
      getByTestId("filters-difficulty-beginner").props.accessibilityState
        ?.selected,
    ).toBe(true);
    expect(
      getByTestId("filters-equipment-barbell").props.accessibilityState
        ?.selected,
    ).toBe(true);
    expect(
      getByTestId("muscle-group-chest").props.accessibilityState?.selected,
    ).toBe(true);
  });

  it("fires the toggle callbacks on chip press", () => {
    const onToggleDifficulty = jest.fn();
    const onToggleEquipment = jest.fn();
    const onToggleMuscleGroup = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseFiltersPresenter
        {...makeProps({
          onToggleDifficulty,
          onToggleEquipment,
          onToggleMuscleGroup,
        })}
      />,
    );
    fireEvent.press(getByTestId("filters-difficulty-beginner"));
    expect(onToggleDifficulty).toHaveBeenCalledWith("beginner");
    fireEvent.press(getByTestId("filters-equipment-dumbbell"));
    expect(onToggleEquipment).toHaveBeenCalledWith("dumbbell");
    fireEvent.press(getByTestId("muscle-group-biceps"));
    expect(onToggleMuscleGroup).toHaveBeenCalledWith("biceps");
  });

  it("fires onClose / onClear / onApply on their respective affordances", () => {
    const onClose = jest.fn();
    const onClear = jest.fn();
    const onApply = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseFiltersPresenter
        {...makeProps({ onClose, onClear, onApply })}
      />,
    );
    fireEvent.press(getByTestId("filters-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.press(getByTestId("filters-clear"));
    expect(onClear).toHaveBeenCalledTimes(1);
    fireEvent.press(getByTestId("filters-apply-button"));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("header Clear and footer Clear both fire onClear", () => {
    const onClear = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseFiltersPresenter {...makeProps({ onClear })} />,
    );
    fireEvent.press(getByTestId("filters-clear"));
    fireEvent.press(getByTestId("filters-clear-button"));
    expect(onClear).toHaveBeenCalledTimes(2);
  });

  it("renders the apply-button label with the live match count (singular)", () => {
    const { getByText } = renderWithTheme(
      <ExerciseFiltersPresenter {...makeProps({ matchCount: 1 })} />,
    );
    expect(getByText("Show 1 exercise")).toBeTruthy();
  });

  it("renders the apply-button label with the live match count (plural)", () => {
    const { getByText } = renderWithTheme(
      <ExerciseFiltersPresenter {...makeProps({ matchCount: 12 })} />,
    );
    expect(getByText("Show 12 exercises")).toBeTruthy();
  });

  it("renders 'Show 0 exercises' when nothing matches", () => {
    const { getByText } = renderWithTheme(
      <ExerciseFiltersPresenter {...makeProps({ matchCount: 0 })} />,
    );
    expect(getByText("Show 0 exercises")).toBeTruthy();
  });
});
