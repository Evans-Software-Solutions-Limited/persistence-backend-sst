import { fireEvent } from "@testing-library/react-native";

import {
  ExerciseFormFields,
  EMPTY_NEW_EXERCISE,
  type NewExerciseInput,
} from "@/ui/components/exercises/ExerciseFormFields";
import {
  formChipPressStyle,
  levelPressStyle,
} from "@/ui/components/exercises/ExerciseFormFields/ExerciseFormFields";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

function setup(overrides: Partial<NewExerciseInput> = {}) {
  const onChange = jest.fn();
  const value: NewExerciseInput = { ...EMPTY_NEW_EXERCISE, ...overrides };
  const utils = renderWithTheme(
    <ExerciseFormFields value={value} onChange={onChange} />,
  );
  return { onChange, value, ...utils };
}

describe("ExerciseFormFields", () => {
  it("renders the name + instructions inputs and the photo placeholder", () => {
    const { getByTestId } = setup();
    expect(getByTestId("exercise-form-name")).toBeTruthy();
    expect(getByTestId("exercise-form-instructions")).toBeTruthy();
    expect(getByTestId("exercise-form-photo")).toBeTruthy();
  });

  it("hides the photo placeholder when showsPhoto is false", () => {
    const { queryByTestId } = renderWithTheme(
      <ExerciseFormFields
        value={EMPTY_NEW_EXERCISE}
        onChange={jest.fn()}
        showsPhoto={false}
      />,
    );
    expect(queryByTestId("exercise-form-photo")).toBeNull();
  });

  it("edits the name", () => {
    const { onChange, getByTestId } = setup();
    fireEvent.changeText(getByTestId("exercise-form-name"), "Squat");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Squat" }),
    );
  });

  it("edits the instructions", () => {
    const { onChange, getByTestId } = setup();
    fireEvent.changeText(getByTestId("exercise-form-instructions"), "Brace");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ instructions: "Brace" }),
    );
  });

  it("selects a primary muscle and clears it from the secondary set", () => {
    const { onChange, getByTestId } = setup({
      primaryMuscleLabel: "Chest",
      secondaryMuscleLabels: ["Back"],
    });
    fireEvent.press(getByTestId("exercise-form-primary-Back"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryMuscleLabel: "Back",
        secondaryMuscleLabels: [],
      }),
    );
  });

  it("does not render the current primary as a secondary option", () => {
    const { queryByTestId } = setup({ primaryMuscleLabel: "Chest" });
    expect(queryByTestId("exercise-form-secondary-Chest")).toBeNull();
    expect(queryByTestId("exercise-form-secondary-Back")).toBeTruthy();
  });

  it("toggles a secondary muscle on", () => {
    const { onChange, getByTestId } = setup({
      primaryMuscleLabel: "Chest",
      secondaryMuscleLabels: [],
    });
    fireEvent.press(getByTestId("exercise-form-secondary-Back"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ secondaryMuscleLabels: ["Back"] }),
    );
  });

  it("toggles a secondary muscle off", () => {
    const { onChange, getByTestId } = setup({
      primaryMuscleLabel: "Chest",
      secondaryMuscleLabels: ["Back", "Legs"],
    });
    fireEvent.press(getByTestId("exercise-form-secondary-Back"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ secondaryMuscleLabels: ["Legs"] }),
    );
  });

  it("selects equipment", () => {
    const { onChange, getByTestId } = setup();
    fireEvent.press(getByTestId("exercise-form-equipment-Dumbbell"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ equipmentLabel: "Dumbbell" }),
    );
  });

  it("selects a level", () => {
    const { onChange, getByTestId } = setup();
    fireEvent.press(getByTestId("exercise-form-level-Advanced"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ level: "Advanced" }),
    );
  });

  it("reflects active state on the selected primary chip", () => {
    const { getByTestId } = setup({ primaryMuscleLabel: "Legs" });
    expect(
      getByTestId("exercise-form-primary-Legs").props.accessibilityState,
    ).toMatchObject({ selected: true });
    expect(
      getByTestId("exercise-form-primary-Chest").props.accessibilityState,
    ).toMatchObject({ selected: false });
  });

  it("renders a check on an active secondary chip", () => {
    const { getByTestId } = setup({
      primaryMuscleLabel: "Chest",
      secondaryMuscleLabels: ["Back"],
    });
    expect(
      getByTestId("exercise-form-secondary-Back").props.accessibilityState,
    ).toMatchObject({ selected: true });
  });

  it("press-style helpers dim while pressed and restore when released", () => {
    expect(formChipPressStyle({ pressed: true }).opacity).toBe(0.85);
    expect(formChipPressStyle({ pressed: false }).opacity).toBe(1);
    expect(levelPressStyle({ pressed: true }).opacity).toBe(0.85);
    expect(levelPressStyle({ pressed: false }).opacity).toBe(1);
    expect(levelPressStyle({ pressed: false }).flex).toBe(1);
  });
});
