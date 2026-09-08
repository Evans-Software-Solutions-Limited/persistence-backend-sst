import type { ReactNode } from "react";
import { View } from "react-native";
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

  it("draws the grip and owns its accessibility, but never the gesture", () => {
    // The drag belongs to `ReorderableList`, which puts an invisible Gesture
    // Handler target over the row's corner on top of this grip. A target in
    // here would unmount when the row collapses to a compact one mid-gesture
    // and take the drag with it — and a Pressable would never drag at all,
    // since RN's press responder claims the touch before the pan activates.
    const { getByTestId } = renderWithTheme(
      <ExerciseReorderHandle
        label="Bench"
        position={1}
        total={3}
        onMove={jest.fn()}
        draggable
      />,
    );

    const grip = getByTestId("reorder-1");
    expect(grip.props.accessibilityRole).toBe("adjustable");
    expect(grip.props.accessibilityLabel).toBe(
      "Reorder Bench, position 1 of 3",
    );
    expect(grip.props.onStartShouldSetResponder).toBeUndefined();
  });

  it("advertises the hold gesture in its hint only when draggable", () => {
    const { getByTestId, rerender } = renderWithTheme(
      <ExerciseReorderHandle
        label="Bench"
        position={1}
        total={3}
        onMove={jest.fn()}
        draggable
      />,
    );

    expect(getByTestId("reorder-1").props.accessibilityHint).toBe(
      "Hold and drag to move, or use Move up and Move down actions",
    );

    // The coach surfaces reorder with buttons, so their grip is accessibility
    // only and must not promise a drag.
    rerender(
      <ExerciseReorderHandle
        label="Bench"
        position={1}
        total={3}
        onMove={jest.fn()}
      />,
    );

    expect(getByTestId("reorder-1").props.accessibilityHint).toBe(
      "Use Move up and Move down actions",
    );
  });
});
