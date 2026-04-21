import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getReferenceListQuery,
  refreshReferenceList,
} from "@/application/queries/reference-lists.query";
import type {
  ReferenceEntry,
  ReferenceListKind,
} from "@/domain/models/reference-list";
import { useAdapters } from "./useAdapters";

/**
 * React hook that exposes the reference-list cache (muscle groups /
 * equipment / categories) to UI containers.
 *
 * - Reads synchronously from StoragePort on mount → `isStale` drives a
 *   background refresh via ApiPort.
 * - Refreshes fire exactly once per app session per kind when stale
 *   (or once total when the cache is empty). Subsequent `refresh()`
 *   calls are caller-driven (e.g. pull-to-refresh).
 * - Failure leaves the cached entries intact; `error` surfaces so the
 *   UI can show a non-blocking indicator. The filter modal still
 *   renders whatever was in the cache before the failed attempt.
 *
 * Spec: specs/03-exercise-library/design.md § Reference-List Cache +
 *       § UI Hooks · requirements.md AC 7.10, AC 7.14
 */

export type ReferenceListsState = {
  muscleGroups: ReferenceEntry[];
  equipment: ReferenceEntry[];
  categories: ReferenceEntry[];
  /** True while any kind is refreshing (initial or manual). */
  isLoading: boolean;
  /** True if any cached list is empty or past the 24h staleness window. */
  isStale: boolean;
  /** Last error from a refresh attempt; cleared when the next refresh succeeds. */
  error: string | null;
  /** Manually refresh all three lists. Resolves when done. */
  refresh: () => Promise<void>;
};

const ALL_KINDS: readonly ReferenceListKind[] = [
  "muscle_groups",
  "equipment",
  "categories",
] as const;

export function useReferenceLists(): ReferenceListsState {
  const { api, storage } = useAdapters();

  const initial = useMemo(() => {
    const readKind = (kind: ReferenceListKind) =>
      getReferenceListQuery(storage, kind);
    return {
      muscle_groups: readKind("muscle_groups"),
      equipment: readKind("equipment"),
      categories: readKind("categories"),
    };
  }, [storage]);

  const [muscleGroups, setMuscleGroups] = useState<ReferenceEntry[]>(
    initial.muscle_groups.entries,
  );
  const [equipment, setEquipment] = useState<ReferenceEntry[]>(
    initial.equipment.entries,
  );
  const [categories, setCategories] = useState<ReferenceEntry[]>(
    initial.categories.entries,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Tracked as state rather than derived from the mount-time `initial`
   * snapshot — otherwise a successful refresh() couldn't flip the flag
   * back off (storage reference never changes, so useMemo never re-runs).
   *
   * Seeded from the initial cache read. Cleared to `false` only after a
   * refresh completes with every kind succeeding. A partial-failure
   * refresh leaves the flag true so the UI / caller can retry.
   */
  const [isStale, setIsStale] = useState(
    initial.muscle_groups.isStale ||
      initial.equipment.isStale ||
      initial.categories.isStale,
  );

  /**
   * Guard against double-fires of the auto-refresh effect. Using a ref
   * rather than state because React 18 strict-mode / hot-reload can
   * cause the effect to run twice in the same tick, and we only want
   * one burst of network calls per mount.
   */
  const hasAutoRefreshedRef = useRef(false);

  const setterFor = useCallback((kind: ReferenceListKind) => {
    switch (kind) {
      case "muscle_groups":
        return setMuscleGroups;
      case "equipment":
        return setEquipment;
      case "categories":
        return setCategories;
    }
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    let firstError: string | null = null;
    for (const kind of ALL_KINDS) {
      const result = await refreshReferenceList(api, storage, kind);
      if (result.ok) {
        setterFor(kind)(result.value);
      } else if (firstError === null) {
        firstError = result.error.message;
      }
    }
    setError(firstError);
    setIsLoading(false);
    // Clear the stale flag only when every kind succeeded. A partial
    // failure keeps the cache visible but leaves isStale=true so the
    // next auto-refresh trigger fires again.
    if (firstError === null) {
      setIsStale(false);
    }
  }, [api, storage, setterFor]);

  // Auto-refresh on mount when any list is empty or stale. Fires once
  // per component mount; callers who need manual control use refresh().
  useEffect(() => {
    if (hasAutoRefreshedRef.current) return;
    const anyStale =
      initial.muscle_groups.isStale ||
      initial.equipment.isStale ||
      initial.categories.isStale;
    if (!anyStale) return;

    hasAutoRefreshedRef.current = true;
    void refresh();
  }, [initial, refresh]);

  return {
    muscleGroups,
    equipment,
    categories,
    isLoading,
    isStale,
    error,
    refresh,
  };
}
