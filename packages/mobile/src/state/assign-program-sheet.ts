import { create } from "zustand";

/**
 * useAssignProgramSheet — AssignProgram bottom-sheet open-state slice
 * (19-programs, Phase 9 mobile — coach F1).
 *
 * The Programs editor's "Assign to client" CTA calls
 * `openSheet(programId, onAssigned)`; the sheet's Cancel / backdrop /
 * successful-assign call `closeSheet()`. Root-mounted (per
 * feedback_sheets_mount_at_root) so the sheet overlays the tab bar; the
 * container reads `open` + `programId` to drive the <BottomSheet> slide
 * animation and know which programme to assign. No AsyncStorage — a cold
 * launch always starts closed. Mirrors `useAddClientSheet`.
 */

export interface AssignProgramSheetState {
  open: boolean;
  /** The programme being assigned; null when the sheet is closed. */
  programId: string | null;
  /**
   * Optional callback the opener (ProgramEditorContainer) registers so the
   * sheet can refresh the assignments list after a successful assign — the
   * sheet is root-mounted and doesn't share the container's hook instances.
   * Cleared on close so a stale closure can't fire later.
   */
  onAssigned: (() => void) | null;
  openSheet: (programId: string, onAssigned?: () => void) => void;
  closeSheet: () => void;
}

export const useAssignProgramSheet = create<AssignProgramSheetState>((set) => ({
  open: false,
  programId: null,
  onAssigned: null,
  openSheet: (programId, onAssigned) =>
    set({ open: true, programId, onAssigned: onAssigned ?? null }),
  closeSheet: () => set({ open: false, programId: null, onAssigned: null }),
}));
