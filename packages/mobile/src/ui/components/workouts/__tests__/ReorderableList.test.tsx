import { Text, View } from "react-native";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import {
  mockRowHeight,
  reorderableTestApi,
} from "../../../../../__tests__/reorderable-test-api";
import { ReorderableList } from "../ReorderableList";

/**
 * What can honestly be tested here, and what cannot.
 *
 * `react-native-reanimated-dnd` is mocked (it reaches
 * `react-native-worklets`' native module at import time), so the gesture, the
 * row geometry and the auto-scroll are all invisible from jest. Those are the
 * device gate: `specs/milestones/REORDER-REBUILD/SMOKE_TEST.md`.
 *
 * What IS provable here is the composition this component owns: which rows
 * exist, that each gets its own drag target outside its body, that the hold
 * collapses the rows and a drop expands them again, and that a drop maps to
 * the right id, index and committed order — including that a pan which never
 * activated commits nothing.
 */

type Row = { id: string; label: string };

const ROWS: Row[] = [
  { id: "a", label: "A" },
  { id: "b", label: "B" },
  { id: "c", label: "C" },
];

function renderList(
  overrides: Partial<React.ComponentProps<typeof ReorderableList<Row>>> = {},
) {
  const onReorder = jest.fn();
  const result = renderWithTheme(
    <ReorderableList<Row>
      testID="list"
      data={ROWS}
      estimatedItemHeight={120}
      compactItemHeight={72}
      onReorder={onReorder}
      renderItem={(row, { isCompact }) => (
        <View testID={isCompact ? `compact-${row.id}` : `full-${row.id}`}>
          <Text>{row.label}</Text>
        </View>
      )}
      {...overrides}
    />,
  );
  return { onReorder, ...result };
}

describe("ReorderableList", () => {
  it("gives every row its own drag target, outside the row's body", () => {
    // The target has to sit outside the body: a touch goes to the view the
    // finger landed on, so a target inside would unmount when the body
    // collapses to a compact row and take the gesture with it.
    const { getByTestId } = renderList();

    ROWS.forEach((row) => {
      expect(getByTestId(`sortable-handle-${row.id}`)).toBeTruthy();
      expect(getByTestId(`sortable-item-${row.id}`)).toBeTruthy();
    });
  });

  it("renders full bodies at rest and compact ones for the drag", () => {
    const { getByTestId, queryByTestId } = renderList();

    expect(getByTestId("full-a")).toBeTruthy();
    expect(queryByTestId("compact-a")).toBeNull();

    // The collapse fires from its own long press, BEFORE the drag activates,
    // so the geometry is settled by the time the library measures.
    reorderableTestApi.collapse("a");

    expect(getByTestId("compact-a")).toBeTruthy();
    expect(getByTestId("compact-c")).toBeTruthy();
    expect(queryByTestId("full-a")).toBeNull();
  });

  it("commits the moved id, its new index and the whole order", () => {
    const { onReorder } = renderList();

    reorderableTestApi.collapse("a");
    reorderableTestApi.dragStart("a");
    reorderableTestApi.drop("a", 2, { a: 2, b: 0, c: 1 });

    expect(onReorder).toHaveBeenCalledWith("a", 2, ["b", "c", "a"]);
  });

  it("expands again on the drop, even when nothing moved", () => {
    // A lift and release in the same slot commits nothing, but the rows still
    // have to come back or the list is stuck compact with nothing to tap.
    const { onReorder, getByTestId, queryByTestId } = renderList();

    reorderableTestApi.collapse("a");
    reorderableTestApi.dragStart("a");
    reorderableTestApi.drop("a", 0, { a: 0, b: 1, c: 2 });

    expect(onReorder).not.toHaveBeenCalled();
    expect(getByTestId("full-a")).toBeTruthy();
    expect(queryByTestId("compact-a")).toBeNull();
  });

  it("commits nothing for a pan that never activated", () => {
    // Gesture Handler finalizes FAILED and CANCELLED pans too, and the
    // library forwards those as drops — a tap on the grip, or a scroll swipe
    // that started there.
    const { onReorder } = renderList();

    reorderableTestApi.drop("a", 2, { a: 2, b: 0, c: 1 });

    expect(onReorder).not.toHaveBeenCalled();
  });

  it("puts the rows back when a hold never becomes a drag", () => {
    const { getByTestId, queryByTestId } = renderList();

    reorderableTestApi.collapse("a");
    expect(getByTestId("compact-a")).toBeTruthy();

    reorderableTestApi.collapseEnd("a");

    expect(getByTestId("full-a")).toBeTruthy();
    expect(queryByTestId("compact-a")).toBeNull();
  });

  it("stops the scroller from scrolling while the rows are collapsed", () => {
    // The drag owns the finger then, and the library drives the scrolling
    // itself; leaving the scroller live let a drag fight it.
    const { getByTestId } = renderList();

    expect(getByTestId("list").props.scrollEnabled).toBe(true);
    reorderableTestApi.collapse("a");
    expect(getByTestId("list").props.scrollEnabled).toBe(false);
  });

  it("renders a header and footer inside its own scroller", () => {
    // They must scroll WITH the rows: this is the screen's only scroller, and
    // nesting it inside another one is what broke auto-scroll before.
    const { getByTestId } = renderList({
      header: <View testID="list-header" />,
      footer: <View testID="list-footer" />,
    });

    expect(getByTestId("list-header")).toBeTruthy();
    expect(getByTestId("list-footer")).toBeTruthy();
  });

  it("lays rows out at their MEASURED height, and at the compact height for a drag", () => {
    // This is the whole geometry contract. The library positions every row
    // from the height it is given, and the two bugs this component exists to
    // work around both showed up here: the library's own measurement did not
    // always fire, and a row's resting top is computed once at mount from the
    // estimate. Rows measured at 340 laid out at 120 overlapped in the
    // session; the editor got dead gaps.
    const { getByTestId } = renderList();

    // Before any layout, the estimate is all there is.
    expect(mockRowHeight("a")).toBe(120);

    fireEvent(getByTestId("sortable-item-a"), "layout", {
      nativeEvent: { layout: { height: 340, width: 400, x: 0, y: 0 } },
    });

    expect(mockRowHeight("a")).toBe(340);
    // Not yet measured, so still the estimate — never another row's height.
    expect(mockRowHeight("b")).toBe(120);

    // Collapsed, every row is the uniform compact height, published without
    // waiting for a layout pass: that is what lets the collapse land inside
    // the 110ms before the drag activates.
    reorderableTestApi.collapse("a");
    expect(mockRowHeight("a")).toBe(72);
    expect(mockRowHeight("b")).toBe(72);
  });

  it("stays collapsed when the hold's own gesture ends mid-drag", () => {
    // The collapse long-press and the drag are two gestures on one finger, and
    // the long press finalizes first if it hits its own distance or duration
    // limits. Expanding then would put the full cards back UNDER an active
    // drag — the exact failure both earlier designs died of.
    const { getByTestId, queryByTestId } = renderList();

    reorderableTestApi.collapse("a");
    reorderableTestApi.dragStart("a");
    reorderableTestApi.collapseEnd("a");

    expect(getByTestId("compact-a")).toBeTruthy();
    expect(queryByTestId("full-a")).toBeNull();

    // And the drop still ends it.
    reorderableTestApi.drop("a", 1, { a: 1, b: 0, c: 2 });
    expect(getByTestId("full-a")).toBeTruthy();
  });

  it("gives no drag target to a list with nothing to reorder", () => {
    // The cards draw no grip on a one-row list, and an invisible target with
    // no grip under it swallows touches meant for the card beneath it — RN
    // hit-tests the topmost view and walks up its ancestors, never down.
    const { queryByTestId } = renderList({
      data: [{ id: "only", label: "Only" }],
    });

    expect(queryByTestId("sortable-handle-only")).toBeNull();
    expect(queryByTestId("full-only")).toBeTruthy();
  });
});
