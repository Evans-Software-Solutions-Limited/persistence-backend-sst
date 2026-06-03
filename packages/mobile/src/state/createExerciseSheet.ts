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
  /**
   * Reset to closed. Called from `useAuth.signOut` alongside the other
   * `*.reset()` slices. This is a device-global zustand singleton (no user
   * scoping), so without a sign-out reset, user A's open sheet would survive
   * into user B's session on the same device: the `(app)` layout remounts on
   * sign-in and `CreateExerciseSheetContainer` would read `open=true` and pop
   * the sheet unprompted. Mirrors `useTrainSegment.reset()`. Cold launches
   * already start closed — this guards the warm sign-in path.
   */
  reset: () => void;
}

export const useCreateExerciseSheet = create<CreateExerciseSheetState>(
  (set) => ({
    open: false,
    openSheet: () => set({ open: true }),
    closeSheet: () => set({ open: false }),
    reset: () => set({ open: false }),
  }),
);
