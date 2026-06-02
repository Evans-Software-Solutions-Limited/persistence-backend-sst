import { create } from "zustand";

/**
 * useCreateExerciseSheet — open-state slice for the Create-Exercise sheet.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-006 (AC 6.1)
 *
 * Mirrors `useDrawer` (the ProfileDrawer slice). The sheet's container is
 * mounted once at the root `(app)/_layout.tsx` — a sibling of the Stack, like
 * <ProfileDrawerContainer> — so its <BottomSheet> overlays the bottom tab bar
 * instead of being clipped by it (the sheet used to mount inside the Train hub
 * tab content, which left the navbar drawn on top of the sheet's footer).
 *
 * Triggers that open it: the Train hub `+ Create` action, the Exercises
 * empty-state CTA, and the `/exercises/create` deep-link redirect stub. The
 * backdrop tap + Cancel/Save call `closeSheet()`. No AsyncStorage — a cold
 * launch always starts closed.
 */
export interface CreateExerciseSheetState {
  open: boolean;
  openSheet: () => void;
  closeSheet: () => void;
}

export const useCreateExerciseSheet = create<CreateExerciseSheetState>(
  (set) => ({
    open: false,
    openSheet: () => set({ open: true }),
    closeSheet: () => set({ open: false }),
  }),
);
