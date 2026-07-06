import { create } from "zustand";

/**
 * useAssignWorkoutSheet — ad-hoc single-workout assignment sheet
 * (19-programs STORY-006 / T-19.3.5). A coach assigns ONE workout to a client
 * outside any programme (a `workout_assignments` row with no programme
 * linkage). Opened from Client Detail with the client fixed; the coach picks a
 * workout + an optional due date. Root-mounted (feedback_sheets_mount_at_root).
 */

export interface AssignWorkoutSheetState {
  open: boolean;
  clientId: string | null;
  onAssigned: (() => void) | null;
  openSheet: (clientId: string, onAssigned?: () => void) => void;
  closeSheet: () => void;
}

export const useAssignWorkoutSheet = create<AssignWorkoutSheetState>((set) => ({
  open: false,
  clientId: null,
  onAssigned: null,
  openSheet: (clientId, onAssigned) =>
    set({ open: true, clientId, onAssigned: onAssigned ?? null }),
  closeSheet: () => set({ open: false, clientId: null, onAssigned: null }),
}));
