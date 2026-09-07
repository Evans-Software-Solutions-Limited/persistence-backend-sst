import { COMPACT_REORDER_ROW_HEIGHT } from "@/ui/components/workouts/CompactReorderRow";
import {
  ACTIVE_SESSION_REORDER_GAP,
  WORKOUT_EDITOR_REORDER_GAP,
  compactReorderItemLayout,
  editorCompactReorderItemLayout,
  makeCompactReorderItemLayout,
} from "../compactReorderLayout";

const COMPACT_REORDER_GAP = ACTIVE_SESSION_REORDER_GAP;
const COMPACT_REORDER_PITCH =
  COMPACT_REORDER_ROW_HEIGHT + ACTIVE_SESSION_REORDER_GAP;

/**
 * The geometry that let ~60 lines of scroll compensation be deleted.
 *
 * The bug: reorder mode collapsed variable-height cards to fixed rows DURING a
 * drag, so the library was animating from measurements it had already taken of
 * the taller cards. The correction summed how much height each cell above the
 * dragged one would lose, read from a map filled in by `onLayout` — and a cell
 * that had never been laid out contributed nothing, so it under-shot, worse the
 * further down the list you grabbed. Uniform rows of a known height need no
 * measuring at all.
 */
describe("compactReorderItemLayout", () => {
  it("reports the fixed row height for every index", () => {
    for (const index of [0, 1, 7, 42]) {
      expect(compactReorderItemLayout(null, index).length).toBe(
        COMPACT_REORDER_ROW_HEIGHT,
      );
    }
  });

  it("advances by the row height PLUS the gap between rows", () => {
    // The content container has a `gap`, so consecutive rows sit one gap
    // further apart than their heights imply. Using the height as the pitch
    // would drift by a gap per row — the same accumulating, index-dependent
    // error as the bug this replaces, just smaller.
    expect(COMPACT_REORDER_PITCH).toBe(
      COMPACT_REORDER_ROW_HEIGHT + COMPACT_REORDER_GAP,
    );
    expect(compactReorderItemLayout(null, 0).offset).toBe(0);
    expect(compactReorderItemLayout(null, 1).offset).toBe(
      COMPACT_REORDER_PITCH,
    );
    expect(compactReorderItemLayout(null, 5).offset).toBe(
      COMPACT_REORDER_PITCH * 5,
    );
  });

  it("leaves exactly one gap between one row's end and the next row's start", () => {
    const first = compactReorderItemLayout(null, 3);
    const second = compactReorderItemLayout(null, 4);
    expect(second.offset - (first.offset + first.length)).toBe(
      COMPACT_REORDER_GAP,
    );
  });

  it("measures from the first row, not from the top of the content", () => {
    // FlatList accounts for the list header itself; adding it here would
    // double-count it.
    expect(compactReorderItemLayout(null, 0).offset).toBe(0);
  });

  it("echoes the index back, as FlatList requires", () => {
    expect(compactReorderItemLayout(null, 9).index).toBe(9);
  });

  it("uses each surface's own spacing, which is not the same", () => {
    // The active session separates rows with a 16pt container `gap`; the
    // workout editor with a 10pt separator. Sharing one constant would drift
    // by 6pt per row on whichever list it was wrong for — the same
    // accumulating, index-dependent error as the bug being fixed.
    expect(WORKOUT_EDITOR_REORDER_GAP).not.toBe(ACTIVE_SESSION_REORDER_GAP);
    expect(compactReorderItemLayout(null, 4).offset).toBe(
      (COMPACT_REORDER_ROW_HEIGHT + ACTIVE_SESSION_REORDER_GAP) * 4,
    );
    expect(editorCompactReorderItemLayout(null, 4).offset).toBe(
      (COMPACT_REORDER_ROW_HEIGHT + WORKOUT_EDITOR_REORDER_GAP) * 4,
    );
  });

  it("keeps the row height fixed whatever the gap", () => {
    // Only the pitch varies by surface; the row itself is one known height.
    for (const gap of [0, 10, 16, 40]) {
      expect(makeCompactReorderItemLayout(gap)(null, 3).length).toBe(
        COMPACT_REORDER_ROW_HEIGHT,
      );
    }
  });

  it("does not depend on the data it is handed", () => {
    // The point: geometry that cannot be wrong because a cell was never laid
    // out, or was laid out at its pre-collapse height.
    expect(compactReorderItemLayout([{}, {}, {}], 6)).toEqual(
      compactReorderItemLayout(null, 6),
    );
  });
});
