import { useCallback, useEffect, useState } from "react";
import type { SyncStats } from "@/domain/ports/storage.port";
import type { SyncStatus } from "@/domain/ports/sync.types";
import { useAdapters } from "./useAdapters";

export type SyncState = SyncStats & {
  isClean: boolean;
  refresh: () => void;
};

/**
 * Hook to observe sync queue status for UI indicators.
 *
 * Returns counts of pending/failed/in-flight mutations so the UI
 * can show sync status badges, offline banners, etc.
 */
export function useSync(pollIntervalMs = 5000): SyncState {
  const { storage } = useAdapters();
  const [state, setState] = useState<SyncStats & { isClean: boolean }>({
    pending: 0,
    failed: 0,
    inFlight: 0,
    isClean: true,
  });

  const refresh = useCallback(() => {
    const stats = storage.getSyncStats();
    setState({
      ...stats,
      isClean:
        stats.pending === 0 && stats.failed === 0 && stats.inFlight === 0,
    });
  }, [storage]);

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
