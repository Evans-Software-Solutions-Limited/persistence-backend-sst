import { fireEvent } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { ExerciseReorderHandle } from "../ExerciseReorderHandle";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

describe("ExerciseReorderHandle", () => {
  it("exposes block positions and accessible move actions", () => {
    const onMove = jest.fn();
    const { getByLabelText } = renderWithTheme(
      <ExerciseReorderHandle
        label="Superset starting with Bench"
        position={2}
        total={3}
        onMove={onMove}
      />,
    );
    const handle = getByLabelText(
      "Reorder Superset starting with Bench, position 2 of 3",
    );
    expect(handle.props.accessibilityActions).toEqual([
      { name: "decrement", label: "Move up" },
      { name: "increment", label: "Move down" },
    ]);
    fireEvent(handle, "accessibilityAction", {
      nativeEvent: { actionName: "decrement" },
    });
    expect(onMove).toHaveBeenCalledWith(-1);
  });

  it("starts a real drag from a long press and gives start haptics", () => {
    const onDrag = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseReorderHandle
        label="Bench"
        position={1}
        total={3}
        onMove={jest.fn()}
        onDrag={onDrag}
      />,
    );

    fireEvent(getByTestId("reorder-1"), "longPress");

    expect(Haptics.impactAsync).toHaveBeenCalledWith(
      Haptics.ImpactFeedbackStyle.Medium,
    );
    expect(onDrag).toHaveBeenCalledTimes(1);
  });
});
