import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { MuscleGroupPicker } from "../MuscleGroupPicker";

describe("MuscleGroupPicker", () => {
  it("renders a chip for every muscle group", () => {
    const { getByTestId } = renderWithTheme(
      <MuscleGroupPicker selected={[]} onToggle={jest.fn()} />,
    );
    expect(getByTestId("muscle-group-chest")).toBeTruthy();
    expect(getByTestId("muscle-group-core")).toBeTruthy();
    expect(getByTestId("muscle-group-adductors")).toBeTruthy();
  });

  it("marks selected chips with accessibilityState.selected = true", () => {
    const { getByTestId } = renderWithTheme(
      <MuscleGroupPicker
        selected={["chest", "triceps"]}
        onToggle={jest.fn()}
      />,
    );
    expect(
      getByTestId("muscle-group-chest").props.accessibilityState?.selected,
    ).toBe(true);
    expect(
      getByTestId("muscle-group-triceps").props.accessibilityState?.selected,
    ).toBe(true);
    expect(
      getByTestId("muscle-group-quadriceps").props.accessibilityState?.selected,
    ).toBe(false);
  });

  it("calls onToggle with the muscle group on press", () => {
    const onToggle = jest.fn();
    const { getByTestId } = renderWithTheme(
      <MuscleGroupPicker selected={[]} onToggle={onToggle} />,
    );
    fireEvent.press(getByTestId("muscle-group-chest"));
    expect(onToggle).toHaveBeenCalledWith("chest");
    fireEvent.press(getByTestId("muscle-group-hamstrings"));
    expect(onToggle).toHaveBeenCalledWith("hamstrings");
  });
});
