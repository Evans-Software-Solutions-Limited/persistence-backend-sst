import { create } from "zustand";

/**
 * useAddClientSheet — AddClient bottom-sheet open-state slice.
 *
 * The Coach You "Invite" affordance calls `openSheet()`; the sheet's Cancel /
 * backdrop / successful-send call `closeSheet()`. Root-mounted (per
 * feedback_sheets_mount_at_root) so the sheet overlays the tab bar; the
 * container reads `open` to drive the <BottomSheet> slide animation. No
 * AsyncStorage — a cold launch always starts closed.
 */

export interface AddClientSheetState {
  open: boolean;
  /**
   * Optional callback the opener (CoachYouContainer) registers so the sheet
   * can refresh the overview after a successful invite — the sheet is
   * root-mounted and doesn't share the container's hook instances. Cleared on
   * close so a stale closure can't fire later.
   */
  onInvited: (() => void) | null;
  openSheet: (onInvited?: () => void) => void;
  closeSheet: () => void;
}

export const useAddClientSheet = create<AddClientSheetState>((set) => ({
  open: false,
  onInvited: null,
  openSheet: (onInvited) => set({ open: true, onInvited: onInvited ?? null }),
  closeSheet: () => set({ open: false, onInvited: null }),
}));
