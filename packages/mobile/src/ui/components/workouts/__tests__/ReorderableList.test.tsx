import { Text, View } from "react-native";
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
 * row geometry and the auto-scroll are invisible from jest. Those are the
 * device gate: `specs/milestones/REORDER-REBUILD/SMOKE_TEST.md`.
 *
 * What IS provable here is what this component owns: one row per item, the
 * drag attached to the handle the row passes back, every row laid out at the
 * one fixed height, and a drop mapped to the right id, index and order —
 * including that a pan which never activated commits nothing.
 */

type Row = { id: string; label: string };

const ROWS: Row[] = [
  { id: "a", label: "A" },
  { id: "b", label: "B" },
  { id: "c", label: "C" },
];

function renderList(data: Row[] = ROWS) {
  const onReorder = jest.fn();
  const result = renderWithTheme(
    <ReorderableList<Row>
      testID="list"
      data={data}
      rowHeight={84}
      onReorder={onReorder}
      renderRow={(row, { index, wrapHandle }) => (
        <View testID={`row-${row.id}`}>
          {wrapHandle(<Text testID={`grip-${row.id}`}>⠿</Text>)}
          <Text>{`${index + 1}. ${row.label}`}</Text>
        </View>
      )}
    />,
  );
  return { onReorder, ...result };
}

describe("ReorderableList", () => {
  it("renders one row per item, each with the drag on the handle it passed back", () => {
    const { getByTestId, getByText } = renderList();

    ROWS.forEach((row, index) => {
      expect(getByTestId(`sortable-item-${row.id}`)).toBeTruthy();
      // The drag target wraps the row's own grip, nothing else in the row.
      const handle = getByTestId(`sortable-handle-${row.id}`);
      expect(handle.findByProps({ testID: `grip-${row.id}` })).toBeTruthy();
      expect(getByText(`${index + 1}. ${row.label}`)).toBeTruthy();
    });
  });

  it("lays every row out at the one fixed height", () => {
    // No measuring: the library is told the height up front, which is what
    // keeps a drag anchored to where the rows really are.
    renderList();

    expect(mockRowHeight("a", 0)).toBe(84);
    expect(mockRowHeight("c", 2)).toBe(84);
  });

  it("commits the moved id, its new index and the whole order", () => {
    const { onReorder } = renderList();

    reorderableTestApi.dragStart("a");
    reorderableTestApi.drop("a", 2, { a: 2, b: 0, c: 1 });

    expect(onReorder).toHaveBeenCalledWith("a", 2, ["b", "c", "a"]);
  });

  it("commits nothing when a row is dropped where it started", () => {
    const { onReorder } = renderList();

    reorderableTestApi.dragStart("b");
    reorderableTestApi.drop("b", 1, { a: 0, b: 1, c: 2 });

    expect(onReorder).not.toHaveBeenCalled();
  });

  it("commits nothing for a pan that never activated", () => {
    // Gesture Handler finalizes FAILED and CANCELLED pans too, and the
    // library forwards those as drops: a tap on the handle, or a scroll
    // swipe that started there.
    const { onReorder } = renderList();

    reorderableTestApi.drop("a", 2, { a: 2, b: 0, c: 1 });

    expect(onReorder).not.toHaveBeenCalled();
  });

  it("commits each drag once, so a second drag needs its own start", () => {
    const { onReorder } = renderList();

    reorderableTestApi.dragStart("a");
    reorderableTestApi.drop("a", 2, { a: 2, b: 0, c: 1 });
    reorderableTestApi.drop("a", 1, { a: 1, b: 0, c: 2 });

    expect(onReorder).toHaveBeenCalledTimes(1);
  });

  it("re-renders rows in a new order passed from outside a drag", () => {
    // A VoiceOver Move up / Move down changes the order without a drag; the
    // rows must follow it.
    const { getByText, rerender } = renderList();
    rerender(
      <ReorderableList<Row>
        testID="list"
        data={[ROWS[1]!, ROWS[0]!, ROWS[2]!]}
        rowHeight={84}
        onReorder={jest.fn()}
        renderRow={(row, { index, wrapHandle }) => (
          <View testID={`row-${row.id}`}>
            {wrapHandle(<Text>⠿</Text>)}
            <Text>{`${index + 1}. ${row.label}`}</Text>
          </View>
        )}
      />,
    );

    expect(getByText("1. B")).toBeTruthy();
    expect(getByText("2. A")).toBeTruthy();
  });
});
