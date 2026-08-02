import { useCallback, useEffect, useRef, useState } from "react";
import type { SavedGym, SavedGymInput } from "@/domain/models/loadout";
import type { LoadoutApiError } from "@/domain/ports/api.port";
import type { Result } from "@/shared/errors";
import { useAdapters } from "./useAdapters";

/**
 * useSavedGyms — the reusable equipment configurations (`GET /saved-gyms`,
 * spec-21 § 2.1, AC-2.1 / AC-7.2).
 *
 * **Online-direct with no cache, deliberately.** Every other list surface in this
 * app is cache-first, and this one is not, for the reason the `ApiPort` docstring
 * gives: a saved gym is an input the user is actively reviewing. A stale list
 * shown in the collect step would let them adapt a workout against kit they have
 * since removed, and the preview would then be built from the SERVER's current
 * row anyway (the request sends only `savedGymId`) — so the screen would be
 * describing a different gym from the one the adaptation used. The list is small
 * and the flow is explicitly a network flow.
 *
 * Mutations re-read rather than splicing the local array: the server owns
 * `updatedAt` and the duplicate-name comparison (`lower(btrim(name))`), so a
 * locally-patched row would drift from what the next open shows.
 */

export type SavedGymsState = {
  readonly gyms: readonly SavedGym[];
  /** True only before the first response — a refresh keeps the list on screen. */
  readonly isLoading: boolean;
  readonly error: LoadoutApiError | null;
  readonly refresh: () => Promise<void>;
  /**
   * Returns the error so a caller can branch on `loadoutCode`:
   * `SAVED_GYM_NAME_TAKEN` (409) is a rename prompt, not a failure toast.
   */
  readonly create: (input: SavedGymInput) => Promise<LoadoutApiError | null>;
  readonly update: (
    id: string,
    input: Partial<SavedGymInput>,
  ) => Promise<LoadoutApiError | null>;
  readonly remove: (id: string) => Promise<LoadoutApiError | null>;
};

export function useSavedGyms(enabled = true): SavedGymsState {
  const { api } = useAdapters();
  const [gyms, setGyms] = useState<readonly SavedGym[]>([]);
  const [error, setError] = useState<LoadoutApiError | null>(null);
  const [hasResolved, setHasResolved] = useState(false);

  // Guards a resolved response from writing state after unmount — the flow's
  // collect step unmounts as soon as the user picks a gym, and the list request
  // can still be in flight.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const result = await api.getSavedGyms();
    if (!mountedRef.current) return;
    if (!result.ok) {
      setError(result.error);
      setHasResolved(true);
      return;
    }
    setGyms(result.value);
    setError(null);
    setHasResolved(true);
  }, [api]);

  // ⚠ One fetch per ENABLE, not per mount — and the difference is the whole
  // point of the hook being uncached.
  //
  // A per-mount latch would fetch once and never again for as long as the
  // consumer stays mounted. That was acute when `LoadoutFlowContainer` was
  // mounted at the authenticated layout root for the whole session; it is now a
  // `fullScreenModal` route that unmounts on close, so a mount latch would
  // mostly work — which is exactly what makes it the wrong thing to rely on. The
  // enable latch is what actually states the requirement, and it still binds for
  // `SavedGymsContainer`, which since 2026-08-02 is the Train hub's `Gyms`
  // segment body rather than a pushed screen — so for THAT consumer the enable
  // latch now coincides with a mount latch, because the segment unmounts on every
  // switch. Coinciding is not the same as being the same rule.
  //
  // A gym created or edited in Train → Gyms must appear in the collect
  // step, and — the damaging half — `contextEquipmentIds` feeds that snapshot to
  // the swap sheet as its containment context. Rank `best`/`others` against a stale kit
  // and a now-incompatible exercise lands in `best`, gets picked with
  // `isUserOverride: false`, and the save 400s `EQUIPMENT_NOT_AVAILABLE` against
  // the gym's CURRENT server-side rows — an error whose remedy ("confirm you
  // want it anyway") the sheet will not offer, because it does not think that
  // row is incompatible.
  const wasEnabledRef = useRef(false);
  useEffect(() => {
    if (!enabled) {
      wasEnabledRef.current = false;
      return;
    }
    if (wasEnabledRef.current) return;
    wasEnabledRef.current = true;
    void refresh();
  }, [enabled, refresh]);

  const mutate = useCallback(
    async (
      run: () => Promise<Result<unknown, LoadoutApiError>>,
    ): Promise<LoadoutApiError | null> => {
      const result = await run();
      if (!result.ok) {
        // NOT written to `error`. A 409 duplicate name is a field-level prompt in
        // the caller's form; surfacing it as the list's error banner would blank
        // a perfectly good list over a recoverable typo.
        return result.error;
      }
      await refresh();
      return null;
    },
    [refresh],
  );

  const create = useCallback(
    (input: SavedGymInput) => mutate(() => api.createSavedGym(input)),
    [api, mutate],
  );

  const update = useCallback(
    (id: string, input: Partial<SavedGymInput>) =>
      mutate(() => api.updateSavedGym(id, input)),
    [api, mutate],
  );

  const remove = useCallback(
    (id: string) => mutate(() => api.deleteSavedGym(id)),
    [api, mutate],
  );

  return {
    gyms,
    isLoading: enabled && !hasResolved,
    error,
    refresh,
    create,
    update,
    remove,
  };
}
