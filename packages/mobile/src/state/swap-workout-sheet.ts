import { create } from "zustand";

/**
 * useSwapWorkoutSheet — the coach "swap this workout" picker (M18). Opened from
 * a client's Upcoming-sessions row on Client Detail: the coach picks a
 * replacement workout → `PATCH .../workout-assignments/:id`. The assignment +
 * client are fixed. Root-mounted (feedback_sheets_mount_at_root); online-direct.
 */
export interface SwapWorkoutSheetState {
  open: boolean;
  clientId: string | null;
  assignmentId: string | null;
  /** The current workout's name, for the sheet's "Swapping X" context line. */
  currentName: string | null;
  onSwapped: (() => void) | null;
  openSheet: (
    clientId: string,
    assignmentId: string,
    currentName: string | null,
    onSwapped?: () => void,
  ) => void;
  closeSheet: () => void;
}

export const useSwapWorkoutSheet = create<SwapWorkoutSheetState>((set) => ({
  open: false,
  clientId: null,
  assignmentId: null,
  currentName: null,
  onSwapped: null,
  openSheet: (clientId, assignmentId, currentName, onSwapped) =>
    set({
      open: true,
      clientId,
      assignmentId,
      currentName: currentName ?? null,
      onSwapped: onSwapped ?? null,
    }),
  closeSheet: () =>
    set({
      open: false,
      clientId: null,
      assignmentId: null,
      currentName: null,
      onSwapped: null,
    }),
}));
