import { useCallback, useEffect, useState } from "react";
import { getSyncStats, type SyncStatus } from "./sync-queue";

export type SyncState = {
  pending: number;
  failed: number;
  inFlight: number;
  isClean: boolean;
};

/**
 * Hook to observe sync queue status for UI indicators.
 *
 * Returns counts of pending/failed/in-flight mutations so the UI
 * can show sync status badges, offline banners, etc.
 *
 * Refreshes on an interval and can be manually triggered.
 */
export function useSyncState(
  pollIntervalMs = 5000,
): SyncState & { refresh: () => void } {
  const [state, setState] = useState<SyncState>({
    pending: 0,
    failed: 0,
    inFlight: 0,
    isClean: true,
  });

  const refresh = useCallback(() => {
    const stats = getSyncStats();
    setState({
      ...stats,
      isClean:
        stats.pending === 0 && stats.failed === 0 && stats.inFlight === 0,
    });
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, pollIntervalMs);
    return () => clearInterval(interval);
  }, [pollIntervalMs, refresh]);

  return { ...state, refresh };
}

/**
 * Map a sync status to a user-friendly label.
 */
export function syncStatusLabel(status: SyncStatus): string {
  switch (status) {
    case "pending":
      return "Waiting to sync";
    case "in_flight":
      return "Syncing...";
    case "failed":
      return "Sync failed";
    case "completed":
      return "Synced";
  }
}
