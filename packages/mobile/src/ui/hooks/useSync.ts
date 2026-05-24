import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
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
 *
 * Polling pauses when the app is backgrounded to save battery.
 */
export function useSync(pollIntervalMs = 5000): SyncState {
  const { storage } = useAdapters();
  const [state, setState] = useState<SyncStats & { isClean: boolean }>({
    pending: 0,
    failed: 0,
    inFlight: 0,
    blocked: 0,
    isClean: true,
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    const stats = storage.getSyncStats();
    setState({
      ...stats,
      // M10.6: `blocked` is intentionally OUT of the cleanliness signal —
      // blocked entries don't represent "still syncing" work; they're
      // waiting on a user decision (upgrade / retry / discard). The
      // syncing-spinner UI shouldn't spin for them.
      isClean:
        stats.pending === 0 && stats.failed === 0 && stats.inFlight === 0,
    });
  }, [storage]);

  const startPolling = useCallback(() => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(refresh, pollIntervalMs);
  }, [pollIntervalMs, refresh]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    refresh();
    startPolling();

    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        refresh();
        startPolling();
      } else {
        stopPolling();
      }
    };

    const subscription = AppState.addEventListener("change", handleAppState);

    return () => {
      stopPolling();
      subscription.remove();
    };
  }, [refresh, startPolling, stopPolling]);

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
    case "blocked_entitlement":
      return "Blocked by your plan";
  }
}
