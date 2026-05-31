import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

/**
 * useTrainSegment — Train hub segment slice (Workouts | Exercises).
 *
 * Spec: specs/14-navigation/design.md § <TrainHubContainer> — Segmented
 *       composition
 *       specs/14-navigation/requirements.md STORY-005 (AC 5.2)
 *
 * A Zustand store (not a plain React hook) so the deep-link redirect map
 * can call `useTrainSegment.getState().setSegment(...)` /
 * `.setPendingCreate(true)` imperatively without subscribing, while React
 * components read via idiomatic selectors. Matches the V2 state-primitive
 * pattern (`useUserMode`, `useDrawer`).
 */

export type TrainSegment = "Workouts" | "Exercises";

export interface TrainSegmentState {
  segment: TrainSegment;
  /** One-shot flag set by the /exercises/create deep-link redirect. */
  pendingCreate: boolean;
  hydrated: boolean;
  setSegment: (next: TrainSegment) => void;
  setPendingCreate: (next: boolean) => void;
  clearPendingCreate: () => void;
}

const KEY = "persistence.train.segment";

function isTrainSegment(value: string | null): value is TrainSegment {
  return value === "Workouts" || value === "Exercises";
}

export const useTrainSegment = create<TrainSegmentState>((set) => ({
  segment: "Workouts",
  pendingCreate: false,
  hydrated: false,
  setSegment: (next) => {
    // Flip `hydrated: true` here so a late-resolving module-load hydration
    // can't clobber this write. Cold-launch deep links can fire setSegment
    // before AsyncStorage.getItem resolves; without this guard the late
    // .then() callback would overwrite the deep-link write with the prior
    // session's value.
    set({ segment: next, hydrated: true });
    AsyncStorage.setItem(KEY, next).catch(() => undefined);
  },
  setPendingCreate: (next) => set({ pendingCreate: next }),
  clearPendingCreate: () => set({ pendingCreate: false }),
}));

// Hydrate the persisted segment value on first import — but only if no
// setter has already written. Cold-launch deep-link redirects can fire
// setSegment before this resolves; without the guard the late disk-read
// would clobber the deep-link's segment write.
void AsyncStorage.getItem(KEY)
  .then((v) => {
    if (useTrainSegment.getState().hydrated) return; // setSegment already won the race
    if (isTrainSegment(v)) {
      useTrainSegment.setState({ segment: v, hydrated: true });
    } else {
      useTrainSegment.setState({ hydrated: true });
    }
  })
  .catch(() => useTrainSegment.setState({ hydrated: true }));
