import { useEffect, useRef, useState } from "react";
import { useAdapters } from "./useAdapters";

/**
 * Returns a counter that increments whenever any of `tables` is written locally.
 *
 * This is the bridge between `StoragePort.subscribe` (the change bus, backed by
 * SQLite's update hook) and the read pattern the app already uses everywhere:
 * a synchronous cache read inside a `useMemo` keyed on a `cacheVersion`. Fold
 * the returned value into those deps and the read re-runs on any local write —
 * from any screen, any command, or the sync drain's `swapLocal*Id`
 * reconciliation — with no hand-placed invalidation call.
 *
 *     const revision = useCacheRevision(WORKOUT_TABLES);
 *     const data = useMemo(() => query(storage), [storage, revision]);
 *
 * The existing hand-placed mechanisms (`rereadCache()`, `markChanged()`) are
 * deliberately NOT removed: they still serve a purpose the bus cannot, namely
 * forcing a re-read when nothing was written (a filter change, a retry). The
 * bus removes the requirement that every writer remember to call them.
 *
 * `tables` is read once on mount — pass a module-level constant (the arrays in
 * `adapters/storage/tables.ts`) rather than an inline literal, or the
 * subscription tears down and re-establishes on every render.
 */
export function useCacheRevision(tables: readonly string[]): number {
  const { storage } = useAdapters();
  const [revision, setRevision] = useState(0);

  // Hold the array in a ref so an inline-literal caller doesn't resubscribe
  // every render. The table set for a given surface is fixed at mount; a caller
  // that genuinely needs to change it should remount.
  const tablesRef = useRef(tables);

  useEffect(() => {
    const unsubscribe = storage.subscribe(tablesRef.current, () => {
      setRevision((v) => v + 1);
    });
    return unsubscribe;
  }, [storage]);

  return revision;
}
