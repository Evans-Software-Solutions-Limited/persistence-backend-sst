import { fireEvent } from "@testing-library/react-native";
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
});
