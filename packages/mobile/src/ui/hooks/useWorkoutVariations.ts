import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkoutVariationSummary } from "@/domain/models/loadout";
import type { LoadoutApiError } from "@/domain/ports/api.port";
import { useLoadoutFlow } from "@/state/loadout-flow";
import { useAdapters } from "./useAdapters";

/**
 * useWorkoutVariations — the parent workout's "Saved setups" list
 * (`GET /workouts/:id/variations`, AC-5.2).
 *
 * Re-reads whenever `useLoadoutFlow`'s `rev` counter bumps. That counter is the
 * only coupling between the flow and this list: the flow is a root-mounted
 * overlay and the list lives on the workout-detail screen underneath it, so
 * there is no parent-child relationship to pass a callback down. `rev` survives
 * `reset()` for exactly this reason — clearing it on close would drop the one
 * notification the list is waiting for, and the user would return to the detail
 * screen with their new variation missing until a manual navigation.
 *
 * Online-direct, no cache (the whole Loadout surface is — see `ApiPort`).
 * A failed read leaves the section absent rather than showing an error: a
 * workout with no variations and a workout whose variation list failed to load
 * look the same to a user who has never used Loadout, and an error banner on a
 * feature they have not adopted is noise.
 */

export type WorkoutVariationsState = {
  readonly variations: readonly WorkoutVariationSummary[];
  readonly isLoading: boolean;
  readonly error: LoadoutApiError | null;
  readonly refresh: () => Promise<void>;
};

/** Optimistic ids have no server row yet, so there is nothing to list. */
function isFetchable(workoutId: string | null): workoutId is string {
  return workoutId !== null && !workoutId.startsWith("local-");
}

export function useWorkoutVariations(
  workoutId: string | null,
): WorkoutVariationsState {
  const { api } = useAdapters();
  const rev = useLoadoutFlow((state) => state.rev);

  const [variations, setVariations] = useState<
    readonly WorkoutVariationSummary[]
  >([]);
  const [error, setError] = useState<LoadoutApiError | null>(null);
  const [hasResolved, setHasResolved] = useState(false);

  // The identity a settled response belongs to. Without this, navigating from
  // workout A to workout B while A's request is in flight paints A's variations
  // under B's name — and they are all named after their parent, so it reads as
  // real data rather than as a glitch.
  const latestKeyRef = useRef<string | null>(null);
  const fetchable = isFetchable(workoutId);
  const key = fetchable ? `${workoutId}::${rev}` : null;

  useEffect(() => {
    latestKeyRef.current = key;
  }, [key]);

  const refresh = useCallback(async () => {
    if (!isFetchable(workoutId)) return;
    const requestKey = `${workoutId}::${rev}`;
    const result = await api.getWorkoutVariations(workoutId);
    if (latestKeyRef.current !== requestKey) return;
    if (!result.ok) {
      setError(result.error);
      setHasResolved(true);
      return;
    }
    setVariations(result.value);
    setError(null);
    setHasResolved(true);
  }, [api, workoutId, rev]);

  // Re-fires on a workout change AND on a `rev` bump (a save just landed).
  useEffect(() => {
    if (key === null) return;
    void refresh();
  }, [key, refresh]);

  return {
    variations,
    isLoading: key !== null && !hasResolved,
    error,
    refresh,
  };
}
