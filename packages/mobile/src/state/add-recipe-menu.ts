import { create } from "zustand";

/**
 * useAddRecipeMenu — open-state for the root-mounted <AddRecipeMenuContainer>
 * bottom sheet (Recipes AI PR3, recipes.jsx `AddRecipeMenu`). The Recipes
 * library's "+" opens it (replacing PR1's direct push to Save-a-meal); its
 * four rows navigate to Save-a-meal / Create-a-recipe / Snap-a-recipe-photo /
 * Import-from-URL.
 *
 * Mirrors the `ProfileDrawer`/`send-brief-sheet` pattern: ALWAYS mounted as a
 * sibling of the Stack (feedback_sheets_mount_at_root) so its <BottomSheet>
 * slide-out animates on dismiss.
 */
export interface AddRecipeMenuState {
  open: boolean;
  openMenu: () => void;
  closeMenu: () => void;
}

export const useAddRecipeMenu = create<AddRecipeMenuState>((set) => ({
  open: false,
  openMenu: () => set({ open: true }),
  closeMenu: () => set({ open: false }),
}));
