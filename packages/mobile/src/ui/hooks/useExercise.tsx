import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Exercise } from "@/domain/models/exercise";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";
import { useExerciseLibrary } from "./useExerciseLibrary";

/**
 * Single-exercise hook backing the detail screen + the editor's initial load.
 * Cache-first: synchronous read from the shared `cached_exercises` store, with
 * a one-shot background fetch against `GET /exercises/:id` when the row isn't
 * cached yet (e.g. a deep link to an id the library refresh hasn't pulled).
 * Mirrors `useWorkout` — same in-flight dedupe + stale-closure guard keyed on
 * the exercise id, same auto-refresh arming on identity change.
 *
 * Exercises are a shared library (system rows + every user's customs), so the
 * cache isn't user-scoped and the read key is just `id`. Ownership is derived
 * downstream from `exercise.createdBy`.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-007 (AC 7.1, 7.2)
 *       design.md § <ExerciseDetailPresenter>
 */

export type ExerciseDetailState = {
  exercise: Exercise | null;
  isLoading: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
};

const EMPTY: ExerciseDetailState = {
  exercise: null,
  isLoading: false,
  error: null,
  refresh: async () => {},
};

export function useExercise(id: string | null): ExerciseDetailState {
  const { api, storage } = useAdapters();

  const [cacheVersion, setCacheVersion] = useState(0);

  // Subscribe to the shared "local exercise library changed" signal. The
  // editor (a sibling route stacked on top of this screen) writes an edit
  // straight into the same `cached_exercises` store and bumps `revision` —
  // but this hook's own `cacheVersion` only moves on its own `refresh()`, so
  // without watching `revision` the still-mounted detail screen behind the
  // editor keeps rendering the pre-edit row until a full remount. Folding
  // `revision` into the read makes the saved edit show the moment the editor
  // pops back. (STORY-008 — edit reflects without navigate-out-and-in.)
  const libraryRevision = useExerciseLibrary((s) => s.revision);

  // DELIBERATELY NOT subscribed to the `cached_exercises` change bus, unlike
  // every list-shaped reader of the same store (the three pickers and
  // ExerciseListContainer). A list re-reads and finds the row under its new
  // key; this read is keyed by a single id, so when that key DISAPPEARS it has
  // nowhere to go.
  //
  // That is a live scenario, not a hypothetical: the sync drain rekeys a
  // `local-*` row to its server id via DELETE + INSERT
  // (`swapLocalExerciseId`, sync.command.ts). Wiring the bus in here was tried
  // and reverted — it turned "stale but readable" into a blanked screen plus a
  // 404, because `initial` recomputes to null, the effect below clobbers the
  // loaded row, and `hasInitial` flipping false re-arms the one-shot fetch
  // against the dead id. On the editor it also drops in-progress form input.
  //
  // The user-facing path this was meant to fix is closed at the LIST instead:
  // ExerciseListContainer now takes the bus, so it renders the server id and a
  // fresh navigation can no longer land on a dead one. NOT closed: a detail
  // screen already open when the drain fires keeps the stale id in its route
  // param, so its Edit/Delete still address a dead id and 404 (pre-existing;
  // ExerciseDetailContainer.onEdit pushes `exerciseId` straight through).
  // Closing that needs the drain to publish the old→new mapping, or the route
  // to swap its param — still not a bus subscription. See the id-swap
  // regression test below.
  const initial = useMemo(() => {
    void cacheVersion;
    void libraryRevision;
    if (!id) return null;
    return storage.getCachedExercise(id);
  }, [storage, id, cacheVersion, libraryRevision]);

  const [exercise, setExercise] = useState<Exercise | null>(initial);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    setExercise(initial);
  }, [initial]);

  // Mirror the live id to a ref so an async fetch can detect an id swap
  // mid-flight and skip the writes that would pollute state.
  const latestIdRef = useRef<string | null>(id);
  useEffect(() => {
    latestIdRef.current = id;
  }, [id]);

  const inFlightRef = useRef<{ id: string; promise: Promise<void> } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    if (!id) return;
    if (inFlightRef.current && inFlightRef.current.id === id) {
      return inFlightRef.current.promise;
    }
    setIsLoading(true);
    setError(null);
    const work = (async () => {
      try {
        const result = await api.getExercise(id);
        if (latestIdRef.current !== id) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        storage.cacheExercises([result.value]);
        setExercise(result.value);
        setCacheVersion((v) => v + 1);
      } finally {
        setIsLoading(false);
        if (inFlightRef.current?.id === id) {
          inFlightRef.current = null;
        }
      }
    })();
    inFlightRef.current = { id, promise: work };
    return work;
  }, [api, storage, id]);

  // One-shot auto-fetch per id when the row isn't cached. A cached row renders
  // immediately and skips the network — the library refresh keeps it fresh.
  const autoFetchedForIdRef = useRef<string | null>(null);
  const hasInitial = initial !== null;
  useEffect(() => {
    if (!id) {
      autoFetchedForIdRef.current = null;
      return;
    }
    if (autoFetchedForIdRef.current === id) return;
    if (hasInitial) return;
    autoFetchedForIdRef.current = id;
    void refresh();
  }, [id, hasInitial, refresh]);

  if (!id) return EMPTY;

  return { exercise, isLoading, error, refresh };
}
