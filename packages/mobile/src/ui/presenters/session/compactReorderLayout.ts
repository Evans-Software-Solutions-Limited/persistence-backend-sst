import { COMPACT_REORDER_ROW_HEIGHT } from "@/ui/components/workouts/CompactReorderRow";

/**
 * The gap between cells in a reorderable list's content container. Unaffected
 * by the switch into compact mode — a gap has no height of its own to lose.
 */
export const COMPACT_REORDER_GAP = 16;

/** Distance from one compact row's top to the next one's. */
export const COMPACT_REORDER_PITCH =
  COMPACT_REORDER_ROW_HEIGHT + COMPACT_REORDER_GAP;

/**
 * `getItemLayout` for a list in compact reorder mode, where every cell is a
 * fixed-height `CompactReorderRow`.
 *
 * Supplying this is what makes the list's geometry exact rather than measured.
 * `react-native-draggable-flatlist` reads a cell's last measured frame when a
 * drag begins, and a virtualised cell that has never been laid out has no
 * frame at all — FlatList's default `initialNumToRender` is 10, so a list of
 * any length has unmeasured cells. Uniform known rows remove the question.
 *
 * Offsets are relative to the FIRST item; FlatList accounts for the list
 * header separately, so the header's height must not be added here.
 */
export function compactReorderItemLayout(
  _data: ArrayLike<unknown> | null | undefined,
  index: number,
): { length: number; offset: number; index: number } {
  return {
    length: COMPACT_REORDER_ROW_HEIGHT,
    // The pitch, not the row height: the gap is dead space between rows, so
    // row `n` starts `n` gaps further down than its heights alone imply.
    offset: COMPACT_REORDER_PITCH * index,
    index,
  };
}
