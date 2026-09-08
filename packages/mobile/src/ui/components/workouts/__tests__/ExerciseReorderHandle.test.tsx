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

  it("wraps the grip in the drag handle when one is supplied", () => {
    // The gesture is the library's now, not a Pressable's `onLongPress`. All
    // this component does is let itself be wrapped, so the drag lives on the
    // grip and nowhere else.
    const DragHandle = jest.fn(({ children }: { children: ReactNode }) => (
      <View testID="drag-handle">{children}</View>
    ));
    const { getByTestId } = renderWithTheme(
      <ExerciseReorderHandle
        label="Bench"
        position={1}
        total={3}
        onMove={jest.fn()}
        DragHandle={DragHandle}
      />,
    );

    expect(getByTestId("drag-handle")).toBeTruthy();
    // The grip is INSIDE the handle, or holding it would not drag.
    expect(
      getByTestId("drag-handle").findByProps({ testID: "reorder-1" }),
    ).toBeTruthy();
  });

  it("stays accessibility-only where no drag handle is given", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <ExerciseReorderHandle
        label="Bench"
        position={1}
        total={3}
        onMove={jest.fn()}
      />,
    );

    expect(queryByTestId("drag-handle")).toBeNull();
    expect(getByTestId("reorder-1").props.accessibilityHint).toBe(
      "Use Move up and Move down actions",
    );
  });

  it("advertises the hold gesture in its hint only when draggable", () => {
    const { getByTestId } = renderWithTheme(
      <ExerciseReorderHandle
        label="Bench"
        position={1}
        total={3}
        onMove={jest.fn()}
        DragHandle={({ children }: { children: ReactNode }) => <>{children}</>}
      />,
    );

    expect(getByTestId("reorder-1").props.accessibilityHint).toBe(
      "Hold and drag to move, or use Move up and Move down actions",
    );
  });
});
