import { create } from "zustand";

/**
 * useCoachNoteSheet — the coach add/edit-a-client-note sheet (M8 Coach Phase 12).
 * Opened from Client Detail's Notes card: the "+" opens create mode; tapping a
 * note opens edit mode (with a Delete affordance). The client is fixed.
 *
 *  - create mode (`editNote === null`): `POST /trainers/me/clients/:id/notes`.
 *  - edit mode (`editNote` set): `PUT …/notes/:noteId`, or `DELETE …/:noteId`.
 *
 * Notes are PRIVATE to the coach (no client notification). Root-mounted
 * (feedback_sheets_mount_at_root).
 */
export type CoachNoteEditTarget = {
  noteId: string;
  content: string;
};

export interface CoachNoteSheetState {
  open: boolean;
  clientId: string | null;
  /** Non-null in edit mode (drives PUT/DELETE); null in create mode (POST). */
  editNote: CoachNoteEditTarget | null;
  onSaved: (() => void) | null;
  openForCreate: (clientId: string, onSaved?: () => void) => void;
  openForEdit: (
    clientId: string,
    editNote: CoachNoteEditTarget,
    onSaved?: () => void,
  ) => void;
  closeSheet: () => void;
}

export const useCoachNoteSheet = create<CoachNoteSheetState>((set) => ({
  open: false,
  clientId: null,
  editNote: null,
  onSaved: null,
  openForCreate: (clientId, onSaved) =>
    set({ open: true, clientId, editNote: null, onSaved: onSaved ?? null }),
  openForEdit: (clientId, editNote, onSaved) =>
    set({ open: true, clientId, editNote, onSaved: onSaved ?? null }),
  closeSheet: () =>
    set({ open: false, clientId: null, editNote: null, onSaved: null }),
}));
