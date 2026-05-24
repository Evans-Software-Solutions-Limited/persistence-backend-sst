import { useCallback, useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import type { EntitlementFeature } from "@/domain/models/entitlement";
import type { SyncQueueEntry } from "@/domain/ports/storage.port";
import { useAdapters } from "@/ui/hooks/useAdapters";

/**
 * Polling interval for blocked-entry reads. 30s matches the brief —
 * blocked entries don't move often (they need either an explicit user
 * action or a tier upgrade) so an aggressive poll wastes battery for
 * no UX win. Foreground transitions also trigger an immediate refresh
 * so a user returning to the app sees a fresh count without waiting.
 *
 * Exported so tests can assert the cadence without re-deriving it.
 */
export const BLOCKED_SYNC_POLL_INTERVAL_MS = 30_000;

export interface BlockedEntriesSummary {
  /** Total count of blocked entries across all features. */
  total: number;
  /**
   * Per-feature breakdown. Keys are only present when there's at least
   * one blocked entry for that feature — absent keys imply zero, not
   * "unknown".
   */
  byFeature: Partial<Record<EntitlementFeature, number>>;
  /**
   * The earliest `blockedAt` timestamp across all blocked entries, or
   * null when there are none. Drives the banner's "X minutes ago"
   * affordance and tie-breaker sort order on the review screen.
   */
  earliestBlockedAt: string | null;
  /**
   * The raw blocked entries. Returned alongside the summary so the
   * review screen doesn't need a second poll — single source of truth.
   * Empty array when total === 0.
   */
  entries: SyncQueueEntry[];
  /** Force-refresh — used after the review screen's discard / retry. */
  refresh: () => void;
}

const EMPTY_SUMMARY: BlockedEntriesSummary = {
  total: 0,
  byFeature: {},
  earliestBlockedAt: null,
  entries: [],
  // refresh is overridden in the hook body — this is a stable empty
  // shape that callers can compare against without `null` checks.
  refresh: () => {
    /* noop */
  },
};

/**
 * Subscribe to the storage layer's blocked-entry list.
 *
 * Spec: specs/11-payments-subscriptions/design.md
 *       § Sync-queue entitlement handling (M10.6) > UI
 * Satisfies: requirements.md AC 12.4
 *
 * Behaviour:
 *   - Reads `storage.getBlockedEntries()` on mount, every 30s while
 *     foregrounded, and on every foreground transition.
 *   - Returns total + per-feature counts + earliest blockedAt + the
 *     raw entry list. Empty-state shape is stable across renders.
 *   - `refresh()` lets containers force a re-read after a discard /
 *     unblock without waiting for the next poll tick.
 *
 * Why polling and not a storage-level event emitter: the SQLite
 * adapter doesn't broadcast change events today, and adding one
 * for this single consumer is over-engineered. 30s is acceptable
 * for a passive banner — the in-app paths that mutate the blocked
 * pool all live inside React and can call `refresh()` directly.
 */
export function useBlockedSyncEntries(): BlockedEntriesSummary {
  const { storage } = useAdapters();
  const [summary, setSummary] = useState<BlockedEntriesSummary>(EMPTY_SUMMARY);

  const read = useCallback(() => {
    const entries = storage.getBlockedEntries();
    const byFeature: Partial<Record<EntitlementFeature, number>> = {};
    let earliest: string | null = null;
    for (const entry of entries) {
      const verdict = entry.entitlementVerdict;
      if (!verdict) continue;
      const feature = verdict.feature;
      byFeature[feature] = (byFeature[feature] ?? 0) + 1;
      if (earliest === null || verdict.blockedAt < earliest) {
        earliest = verdict.blockedAt;
      }
    }
    return {
      total: entries.length,
      byFeature,
      earliestBlockedAt: earliest,
      entries,
    };
  }, [storage]);

  const refresh = useCallback(() => {
    const next = read();
    setSummary({ ...next, refresh });
  }, [read]);

  useEffect(() => {
    refresh();
    const intervalHandle = setInterval(refresh, BLOCKED_SYNC_POLL_INTERVAL_MS);
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
