import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import {
  COMPACT_REORDER_ROW_HEIGHT,
  CompactReorderRow,
} from "../CompactReorderRow";

describe("CompactReorderRow", () => {
  it("is a FIXED height, which is what makes the drag work at all", () => {
    // The height is published to the sortable the moment the rows collapse,
    // with no layout round-trip, which is what lets the collapse land before
    // the drag activates. A row whose height had to be measured could not do
    // that.
    const { getByTestId } = renderWithTheme(
      <CompactReorderRow
        exerciseNames={["Bench Press"]}
        position={1}
        total={3}
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

  it("keeps the accessible move actions on its grip", () => {
    const onMove = jest.fn();
    const { getByTestId } = renderWithTheme(
      <CompactReorderRow
        exerciseNames={["Bench Press"]}
        position={2}
        total={3}
        onMove={onMove}
      />,
    );

    fireEvent(getByTestId("reorder-2"), "accessibilityAction", {
      nativeEvent: { actionName: "decrement" },
    });
    expect(onMove).toHaveBeenCalledWith(-1);
  });
});
