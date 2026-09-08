import { COMPACT_REORDER_ROW_HEIGHT } from "@/ui/components/workouts/CompactReorderRow";

/**
 * Spacing between cells in each reorderable list. Both are unaffected by the
 * switch into compact mode — neither a container `gap` nor a separator has
 * height of its own to lose — but they DIFFER, and using one surface's value
 * for the other drifts by the difference on every row.
 */
export const ACTIVE_SESSION_REORDER_GAP = 16; // scrollContent `gap`
export const WORKOUT_EDITOR_REORDER_GAP = 10; // ItemSeparatorComponent height

/**
 * `getItemLayout` for a list in compact reorder mode, where every cell is a
 * fixed-height `CompactReorderRow`.
 *
 * Supplying this is what makes the list's geometry exact rather than measured.
 * `react-native-draggable-flatlist` reads a cell's last measured frame when a
 * drag begins, and a virtualised cell that has never been laid out has no
 * frame at all — FlatList's default `initialNumToRender` is 10, so a list of
 * any length has unmeasured cells. Uniform rows of a known height remove the
 * question entirely.
 *
 * Offsets are relative to the FIRST item; FlatList accounts for the list
 * header separately, so a header's height must not be added here.
 */
export function makeCompactReorderItemLayout(gap: number) {
  // The pitch, not the row height: the space between rows is dead, so row `n`
  // starts `n` gaps further down than its heights alone imply.
  const pitch = COMPACT_REORDER_ROW_HEIGHT + gap;
  return (
    _data: ArrayLike<unknown> | null | undefined,
    index: number,
  ): { length: number; offset: number; index: number } => ({
    length: COMPACT_REORDER_ROW_HEIGHT,
    offset: pitch * index,
    index,
  });
}

/** The active session list (16pt container gap). */
export const compactReorderItemLayout = makeCompactReorderItemLayout(
  ACTIVE_SESSION_REORDER_GAP,
);

/** The workout editor list (10pt separator). */
export const editorCompactReorderItemLayout = makeCompactReorderItemLayout(
  WORKOUT_EDITOR_REORDER_GAP,
);
