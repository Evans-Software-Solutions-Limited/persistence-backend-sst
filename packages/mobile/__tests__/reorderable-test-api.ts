/**
 * Test seam for `ReorderableList`.
 *
 * `react-native-reanimated-dnd` is mocked wholesale (it reaches
 * `react-native-worklets`' native module at import time), and the drag lives
 * in a HOOK — `useSortable` — so its callbacks cannot be fired through a
 * rendered view. The mock in `__tests__/setup.ts` registers each row's
 * callbacks here, and a test drives a drag through this API:
 *
 *   reorderableTestApi.dragStart("row-1");
 *   reorderableTestApi.drop("row-1", 2, { "row-1": 2, "row-2": 0, "row-3": 1 });
 *
 * What this can prove: which rows are draggable, that a drop commits the right
 * id and index, that a pan which never activated commits nothing, and that the
 * rows collapse for the drag. What it cannot prove is the gesture, the
 * geometry or the auto-scroll — `specs/milestones/REORDER-REBUILD/SMOKE_TEST.md`
 * is the gate for those.
 */
import { act } from "@testing-library/react-native";

export type MockSortableRow = {
  onCollapse?: () => void;
  onCollapseEnd?: () => void;
  onDragStart?: () => void;
  onDrop?: (
    id: string,
    position: number,
    positions?: Record<string, number>,
  ) => void;
};

export const mockSortableRows = new Map<string, MockSortableRow>();

export const reorderableTestApi = {
  /**
   * The collapse long-press, which fires BEFORE the drag activates and swaps
   * the rows for compact ones. Firing this then `dragStart` is the real
   * sequence.
   */
  collapse(id: string) {
    // Each of these lands in React state, so it has to be flushed like any
    // other event a test fires.
    act(() => {
      mockSortableRows.get(id)?.onCollapse?.();
    });
  },
  /** The collapse press ending — puts the rows back if no drag happened. */
  collapseEnd(id: string) {
    // Each of these lands in React state, so it has to be flushed like any
    // other event a test fires.
    act(() => {
      mockSortableRows.get(id)?.onCollapseEnd?.();
    });
  },
  /** Activate the pan, as Gesture Handler does after its long press. */
  dragStart(id: string) {
    // Each of these lands in React state, so it has to be flushed like any
    // other event a test fires.
    act(() => {
      mockSortableRows.get(id)?.onDragStart?.();
    });
  },
  /** Finalize the pan. Omit `positions` to leave the order alone. */
  drop(id: string, position: number, positions?: Record<string, number>) {
    act(() => {
      mockSortableRows.get(id)?.onDrop?.(id, position, positions);
    });
  },
  /** Ids currently registered as draggable rows. */
  rows() {
    return [...mockSortableRows.keys()];
  },
};
