import { useCallback, useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import type { SyncQueueEntry } from "@/domain/ports/storage.port";
import { useAdapters } from "@/ui/hooks/useAdapters";

/**
 * Polling interval for failed-exhausted-entry reads. Mirrors
 * `BLOCKED_SYNC_POLL_INTERVAL_MS` (`useBlockedSyncEntries.ts`) — these
 * entries also only move via an explicit user action (Retry / Discard) or
 * a reconnect-triggered auto-resurrect, so a 30s cadence is plenty
 * responsive without wasting battery. Foreground transitions also trigger
 * an immediate refresh.
 *
 * Exported so tests can assert the cadence without re-deriving it.
 */
export const FAILED_SYNC_POLL_INTERVAL_MS = 30_000;

export interface FailedEntriesSummary {
  /** Total count of entries that have exhausted their retry budget. */
  total: number;
  /**
   * The raw failed-exhausted entries, FIFO (oldest first) — mirrors
   * `getFailedExhaustedEntries()`'s ordering. Returned alongside the
   * count so the review screen doesn't need a second poll.
   */
  entries: SyncQueueEntry[];
  /** Force-refresh — used after the review screen's Retry / Discard. */
  refresh: () => void;
}

/**
 * Stable empty shape returned by the initial `useState` before the first
 * `refresh()` replaces it. `refresh` here is overridden in the hook body
 * on the very first render pass — this default only exists so callers
 * never see a `null`/`undefined` summary; it's a deliberate no-op.
 * Exported so tests can exercise it directly (its closure otherwise never
 * runs, since it's always superseded before a consumer could call it).
 */
export const EMPTY_SUMMARY: FailedEntriesSummary = {
  total: 0,
  entries: [],
  refresh: () => {
    /* noop */
  },
};

/**
 * Subscribe to the storage layer's failed-exhausted sync-queue entries.
 *
 * Spec: specs/milestones/M13-sync-hardening § Failed-sync review UI
 *
 * Mirrors `useBlockedSyncEntries` (M10.6) — see that hook for the full
 * rationale on polling vs. a storage-level event emitter. These are
 * DISTINCT pools: `blocked_entitlement` entries have a definitive server
 * verdict (retrying without a tier change won't help), while `failed`-
 * exhausted entries burned their retry budget on transient errors — most
 * commonly a stranded offline mutation (the M13 bug this milestone
 * fixes), but possibly a genuine, persistent server rejection too. Either
 * way they're invisible to `getPendingMutations()` forever without an
 * explicit Retry (`resetFailedEntries`) or Discard.
 *
 * Behaviour:
 *   - Reads `storage.getFailedExhaustedEntries()` on mount, every 30s
 *     while foregrounded, and on every foreground transition.
 *   - `refresh()` lets containers force a re-read after a Retry / Discard
 *     without waiting for the next poll tick.
 */
export function useFailedSyncEntries(): FailedEntriesSummary {
  const { storage } = useAdapters();
  const [summary, setSummary] = useState<FailedEntriesSummary>(EMPTY_SUMMARY);

  const read = useCallback(() => {
    const entries = storage.getFailedExhaustedEntries();
    return { total: entries.length, entries };
  }, [storage]);

  const refresh = useCallback(() => {
    const next = read();
    setSummary({ ...next, refresh });
  }, [read]);

  useEffect(() => {
    refresh();
    const intervalHandle = setInterval(refresh, FAILED_SYNC_POLL_INTERVAL_MS);
    const appStateSub = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        if (nextState === "active") refresh();
      },
    );
    return () => {
      clearInterval(intervalHandle);
      appStateSub.remove();
    };
  }, [refresh]);

  return summary;
}
