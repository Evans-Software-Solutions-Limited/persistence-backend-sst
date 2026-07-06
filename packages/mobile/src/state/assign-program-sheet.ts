import { create } from "zustand";

/**
 * useAssignProgramSheet — AssignProgram bottom-sheet open-state slice
 * (19-programs, Phase 9 mobile — coach F1 + T-19.3.5).
 *
 * Two entry points into ONE root-mounted sheet:
 *  - **program-anchored** (`openSheet(programId, …)`, from the Programs editor):
 *    the programme is fixed; the coach picks which active CLIENT to assign it to.
 *  - **client-anchored** (`openForClient(clientId, …)`, from Client Detail): the
 *    client is fixed; the coach picks which PROGRAMME to assign.
 *
 * Exactly one of `programId` / `clientId` is set while open; the sheet branches
 * on which. Both are cleared on close so a stale id can't leak into the next
 * open. `onAssigned` lets the opener refresh its view after a successful assign
 * (the sheet is root-mounted and doesn't share the opener's hook instances).
 * Root-mounted per feedback_sheets_mount_at_root. Mirrors `useAddClientSheet`.
 */

export interface AssignProgramSheetState {
  open: boolean;
  /** Set in program-anchored mode (pick a client for this programme). */
  programId: string | null;
  /** Set in client-anchored mode (pick a programme for this client). */
  clientId: string | null;
  onAssigned: (() => void) | null;
  /** Program-anchored open (from the Programs editor). */
  openSheet: (programId: string, onAssigned?: () => void) => void;
  /** Client-anchored open (from Client Detail). */
  openForClient: (clientId: string, onAssigned?: () => void) => void;
  closeSheet: () => void;
}

export const useAssignProgramSheet = create<AssignProgramSheetState>((set) => ({
  open: false,
  programId: null,
  clientId: null,
  onAssigned: null,
  openSheet: (programId, onAssigned) =>
    set({
      open: true,
      programId,
      clientId: null,
      onAssigned: onAssigned ?? null,
    }),
  openForClient: (clientId, onAssigned) =>
    set({
      open: true,
      clientId,
      programId: null,
      onAssigned: onAssigned ?? null,
    }),
  closeSheet: () =>
    set({ open: false, programId: null, clientId: null, onAssigned: null }),
}));
