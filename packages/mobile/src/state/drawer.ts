import { create } from "zustand";

/**
 * useDrawer — ProfileDrawer open-state slice.
 *
 * Spec: specs/14-navigation/design.md § Drawer-state slice
 *       specs/14-navigation/requirements.md STORY-004 (AC 4.1, 4.5)
 *
 * The avatar in every screen header calls `openDrawer()`; the backdrop
 * tap + the drawer's close button call `closeDrawer()`. No AsyncStorage —
 * a cold launch always starts with the drawer closed (AC 4.5).
 */

export interface DrawerState {
  open: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

export const useDrawer = create<DrawerState>((set) => ({
  open: false,
  openDrawer: () => set({ open: true }),
  closeDrawer: () => set({ open: false }),
}));
