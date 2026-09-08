import type { ReactNode } from "react";
import { fireEvent } from "@testing-library/react-native";
import { Text, View } from "react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { ReorderableList } from "../ReorderableList";

const ROW_HEIGHT = 88;

type Row = { id: string; label: string };

function renderList(rows: Row[], onReorder = jest.fn()) {
  return {
    onReorder,
    ...renderWithTheme(
      <ReorderableList
        testID="list"
        data={rows}
        itemHeight={ROW_HEIGHT}
        onReorder={onReorder}
        renderItem={(row: Row, { Handle }) => (
          <View>
            <Handle>
              <View testID={`grip-${row.id}`} />
            </Handle>
            <Text>{row.label}</Text>
          </View>
        )}
      />,
    ),
  };
}

const ROWS: Row[] = [
  { id: "a", label: "A" },
  { id: "b", label: "B" },
  { id: "c", label: "C" },
];

/**
 * The library is mocked (it reaches react-native-worklets' native module at
 * import), so gestures are device-verified via SMOKE_TEST.md. What IS
 * assertable here is the geometry we hand it — which is where every reorder
 * bug on this branch actually lived.
 */
describe("ReorderableList geometry", () => {
  it("clamps containerHeight to the content on a list that cannot scroll", () => {
    // The library computes `maxScroll = count * itemHeight - containerHeight`
    // with no floor, so a real viewport height on a short list yields a
    // NEGATIVE scroll target: the list gets pushed off its own top and the
    // dragged row yanked back up, committing nothing.
    const { getByTestId } = renderList(ROWS);

    expect(getByTestId("sortable-item-a").props.containerHeight).toBe(
      ROWS.length * ROW_HEIGHT,
    );
  });

  it("never hands the library a zero container height", () => {
    // 0 is not `undefined`, so it does NOT fall back to the library's own 500
    // default — it makes the scroll-down edge test unconditionally true and
    // every drag commits at the last index.
    const { getByTestId } = renderList(ROWS);

    fireEvent(getByTestId("list"), "layout", {
      nativeEvent: { layout: { height: 0, width: 400, x: 0, y: 0 } },
    });

    expect(
      getByTestId("sortable-item-a").props.containerHeight,
    ).toBeGreaterThan(0);
  });

  it("takes a later viewport measurement, so a keyboard-shrunk first one cannot stick", () => {
    // Both entry points mount this list while the keyboard may still be up, so
    // the first layout can be hundreds of points short — and that shortfall
    // lands straight in the auto-scroll edge.
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `r${i}`,
      label: `R${i}`,
    }));
    const { getByTestId } = renderList(many);

    fireEvent(getByTestId("list"), "layout", {
      nativeEvent: { layout: { height: 400, width: 400, x: 0, y: 0 } },
    });
    expect(getByTestId("sortable-item-r0").props.containerHeight).toBe(400);

    fireEvent(getByTestId("list"), "layout", {
      nativeEvent: { layout: { height: 780, width: 400, x: 0, y: 0 } },
    });
    expect(getByTestId("sortable-item-r0").props.containerHeight).toBe(780);
  });

  it("commits the moved id and its new index, and reports every drag end", () => {
    const onReorder = jest.fn();
    const onDragEnd = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ReorderableList
        testID="list"
        data={ROWS}
        itemHeight={ROW_HEIGHT}
        onReorder={onReorder}
        onDragEnd={onDragEnd}
        renderItem={(row: Row, { Handle }) => (
          <Handle>
            <View testID={`grip-${row.id}`} />
          </Handle>
        )}
      />,
    );

    fireEvent(getByTestId("sortable-item-a"), "drop", "a", 2, {
      a: 2,
      b: 0,
      c: 1,
    });

    expect(onReorder).toHaveBeenCalledWith("a", 2, ["b", "c", "a"]);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it("still reports the drag end when the row is dropped where it started", () => {
    // A caller that collapsed into this list leaves that mode here, so a
    // lift-in-place has to be reported or the user is stranded.
    const onReorder = jest.fn();
    const onDragEnd = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ReorderableList
        testID="list"
        data={ROWS}
        itemHeight={ROW_HEIGHT}
        onReorder={onReorder}
        onDragEnd={onDragEnd}
        renderItem={(row: Row, { Handle }) => (
          <Handle>
            <View testID={`grip-${row.id}`} />
          </Handle>
        )}
      />,
    );

    fireEvent(getByTestId("sortable-item-a"), "drop", "a", 0, {
      a: 0,
      b: 1,
      c: 2,
    });

    expect(onReorder).not.toHaveBeenCalled();
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it("wraps each row's grip in the library's handle, never the whole row", () => {
    const { getAllByTestId } = renderList(ROWS);

    // Registering a handle is what disables the whole-item pan.
    expect(getAllByTestId("sortable-handle")).toHaveLength(ROWS.length);
  });
});
