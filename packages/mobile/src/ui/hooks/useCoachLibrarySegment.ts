import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

/**
 * useCoachLibrarySegment — Coach Library hub segment slice (Programmes |
 * Workouts | Exercises).
 *
 * Spec: specs/24-coach-authoring/design.md § B.1
 *       specs/24-coach-authoring/requirements.md STORY-001 (AC 1.5)
 *
 * Modelled directly on `useTrainSegment` (the athlete Train hub's segment
 * slice) — a Zustand store (not a plain hook) so `reset()` can be called
 * imperatively from `useAuth.signOut()`, with the same hydration-race guard:
 * a cold-launch `setSegment` call must win over a late-resolving disk read.
 * No `pendingSegment` / `pendingCreate` — this slice has no deep-link
 * redirect target in this feature slice.
 */

export type CoachLibrarySegment = "Programmes" | "Workouts" | "Exercises";

export interface CoachLibrarySegmentState {
  segment: CoachLibrarySegment;
  hydrated: boolean;
  setSegment: (next: CoachLibrarySegment) => void;
  /**
   * Return the slice to its signed-out default and clear the persisted key.
   * Called from `useAuth.signOut()` so the segment can't bleed into the next
   * account on this device (the KEY is device-global, not user-scoped).
   * Mirrors `useTrainSegment.reset`.
   */
  reset: () => void;
}

const KEY = "persistence.coach.library.segment";

function isCoachLibrarySegment(
  value: string | null,
): value is CoachLibrarySegment {
  return (
    value === "Programmes" || value === "Workouts" || value === "Exercises"
  );
}

export const useCoachLibrarySegment = create<CoachLibrarySegmentState>(
  (set) => ({
    // The Programs tab LEADS with Programmes (its historical purpose), so a
    // fresh install lands there; a returning coach keeps their last-persisted
    // segment.
    segment: "Programmes",
    hydrated: false,
    setSegment: (next) => {
      // Flip `hydrated: true` here so a late-resolving module-load hydration
      // can't clobber this write — mirrors useTrainSegment's guard.
      set({ segment: next, hydrated: true });
      AsyncStorage.setItem(KEY, next).catch(() => undefined);
    },
    reset: () => {
      set({ segment: "Programmes", hydrated: true });
      AsyncStorage.removeItem(KEY).catch(() => undefined);
    },
  }),
);

// Hydrate the persisted segment value on first import — but only if no
// setter has already written (see the `hydrated` guard above).
void AsyncStorage.getItem(KEY)
  .then((v) => {
    if (useCoachLibrarySegment.getState().hydrated) return; // setSegment already won the race
    if (isCoachLibrarySegment(v)) {
      useCoachLibrarySegment.setState({ segment: v, hydrated: true });
    } else {
      useCoachLibrarySegment.setState({ hydrated: true });
    }
  })
  .catch(() => useCoachLibrarySegment.setState({ hydrated: true }));
