import type { ReactNode } from "react";
import { fireEvent } from "@testing-library/react-native";
import { View } from "react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import {
  COMPACT_REORDER_ROW_HEIGHT,
  CompactReorderRow,
} from "../CompactReorderRow";

const DragHandle = ({ children }: { children: ReactNode }) => (
  <View testID="drag-handle">{children}</View>
);

describe("CompactReorderRow", () => {
  it("is a FIXED height, which is what makes the drag work at all", () => {
    // Not cosmetic: bisected on device, the sortable drags reliably only when
    // every row is the same height. This row exists so the list can be
    // uniform while reordering.
    const { getByTestId } = renderWithTheme(
      <CompactReorderRow
        exerciseNames={["Bench Press"]}
        position={1}
        total={3}
        DragHandle={DragHandle}
      />,
    );

    expect(getByTestId("compact-reorder-row").props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ height: COMPACT_REORDER_ROW_HEIGHT }),
      ]),
    );
  });

  it("caps a superset at two lines so no row can outgrow the viewport", () => {
    const { getByTestId } = renderWithTheme(
      <CompactReorderRow
        exerciseNames={["Bench Press", "Row", "Pulldown", "Curl"]}
        position={1}
        total={2}
        DragHandle={DragHandle}
      />,
    );

    const names = getByTestId("compact-reorder-row-names");
    expect(names.props.numberOfLines).toBe(2);
    // Every peer is named, but the row's height cannot grow with the count.
    expect(names.props.children).toContain("Bench Press");
    expect(names.props.children).toContain("Curl");
    expect(getByTestId("compact-reorder-row").props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ height: COMPACT_REORDER_ROW_HEIGHT }),
      ]),
    );
  });

  it("puts the drag on the handle, and keeps the accessible move actions", () => {
    const onMove = jest.fn();
    const { getByTestId } = renderWithTheme(
      <CompactReorderRow
        exerciseNames={["Bench Press"]}
        position={2}
        total={3}
        onMove={onMove}
        DragHandle={DragHandle}
      />,
    );

    expect(getByTestId("drag-handle")).toBeTruthy();
    fireEvent(getByTestId("reorder-2"), "accessibilityAction", {
      nativeEvent: { actionName: "decrement" },
    });
    expect(onMove).toHaveBeenCalledWith(-1);
  });
});
