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
  /** True when the drawer was closed specifically to navigate to a sub-page.
   *  On back-navigation to the tabs, the drawer re-opens automatically. */
  returnToDrawer: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  /** Close the drawer for a sub-page push — sets returnToDrawer so the
   *  drawer re-opens when the user navigates back. */
  closeForNavigation: () => void;
  clearReturn: () => void;
}

export const useDrawer = create<DrawerState>((set) => ({
  open: false,
  returnToDrawer: false,
  openDrawer: () => set({ open: true }),
  closeDrawer: () => set({ open: false, returnToDrawer: false }),
  closeForNavigation: () => set({ open: false, returnToDrawer: true }),
  clearReturn: () => set({ returnToDrawer: false }),
}));
