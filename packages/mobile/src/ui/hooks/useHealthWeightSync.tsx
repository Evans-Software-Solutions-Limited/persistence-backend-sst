import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/** Sync-metadata key for the coach-logged-weight → HealthKit cursor. */
export const HEALTH_WEIGHT_SYNC_KEY = "healthkit_weight_sync";

/** How many recent measurements to scan per sync pass. */
const SCAN_LIMIT = 50;

/**
 * Writes coach-logged weights into the client's HealthKit on app open
 * (10-trainer-features, weight-sync flow):
 *
 *   coach logs a client's weight  →  the row lands with `loggedByUserId` set
 *   →  the client opens the app    →  this hook writes it to HealthKit.
 *
 * Only measurements logged by SOMEONE ELSE (`loggedByUserId` ≠ the signed-in
 * user) that are newer than the local cursor are written, so self-logged
 * weigh-ins (already in HealthKit) and previously-synced rows aren't
 * duplicated. The cursor advances to the newest SUCCESSFULLY-written row, so a
 * failed write is retried on the next pass rather than skipped.
 *
 * Runs on mount and on app-foreground transitions. No-op when health writes
 * aren't available / permitted.
 */
export function useHealthWeightSync(): void {
  const { api, storage, health } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const runningRef = useRef(false);

  const sync = useCallback(async () => {
    if (userId === null || runningRef.current) return;
    runningRef.current = true;
    try {
      if (!(await health.isAvailable())) return;
      const perms = await health.getPermissionStatus();
      if (perms.bodyWeight !== "granted") return;

      const result = await api.getMeasurements({ limit: SCAN_LIMIT });
      if (!result.ok) return;

      const cursor = storage.getLastSyncedAt(HEALTH_WEIGHT_SYNC_KEY);
      const cursorMs = cursor ? new Date(cursor).getTime() : 0;

      // Coach-logged, weight-bearing rows newer than the cursor, oldest first.
      const pending = result.value
        .filter(
          (m) =>
            m.loggedByUserId != null &&
            m.loggedByUserId !== userId &&
            m.weightKg != null &&
            m.measuredAt != null &&
            new Date(m.measuredAt).getTime() > cursorMs,
        )
        .sort(
          (a, b) =>
            new Date(a.measuredAt as string).getTime() -
            new Date(b.measuredAt as string).getTime(),
        );

      let newestWritten: string | null = null;
      for (const m of pending) {
        const kg = Number(m.weightKg);
        const measuredAt = m.measuredAt as string;
        if (Number.isNaN(kg)) {
          // Unparseable weight — skip it but don't let it block the cursor
          // forever; treat as processed.
          newestWritten = measuredAt;
          continue;
        }
        const write = await health.writeBodyWeight(kg, new Date(measuredAt));
        if (!write.ok) break; // stop; retry from here next pass
        newestWritten = measuredAt;
      }

      if (newestWritten) {
        storage.setLastSyncedAt(HEALTH_WEIGHT_SYNC_KEY, newestWritten);
      }
    } finally {
      runningRef.current = false;
    }
  }, [api, storage, health, userId]);

  useEffect(() => {
    void sync();
  }, [sync]);

  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      if (status === "active") void sync();
    };
    const subscription = AppState.addEventListener("change", onChange);
    return () => subscription.remove();
  }, [sync]);
}
