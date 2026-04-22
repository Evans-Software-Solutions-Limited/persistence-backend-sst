import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import type {
  HealthPermissionStatus,
  HealthWeight,
} from "@/domain/ports/health.port";
import { useAdapters } from "./useAdapters";

/**
 * React hook exposing HealthPort readings to the dashboard tiles.
 *
 * - Rate-limited to one read per 5 minutes via a `useRef` timestamp so
 *   rapid re-mounts (hot reload, strict-mode double-render) don't spam
 *   native HealthKit queries (AC 7.6).
 * - Re-reads on app-foreground transitions via AppState.
 * - `refresh()` bypasses the rate limit.
 * - Listener cleanup on unmount is mandatory; a leaked listener causes
 *   duplicate reads on every AppState change across subsequent mounts.
 *
 * Spec: specs/07-health-integration/design.md § M1 scope: platform
 *       adapter matrix · requirements.md STORY-007 AC 7.5, 7.6
 */

export const HEALTH_READ_RATE_LIMIT_MS = 5 * 60 * 1000;

const DEFAULT_PERMISSIONS: HealthPermissionStatus = {
  steps: "not_determined",
  calories: "not_determined",
  bodyWeight: "not_determined",
  heartRate: "not_determined",
};

export type HealthDataState = {
  stepsToday: number | null;
  activeCaloriesToday: number | null;
  latestBodyWeight: HealthWeight | null;
  permissionStatus: HealthPermissionStatus;
  isAvailable: boolean;
  isReading: boolean;
  /** ISO timestamp of the last completed read, or null. */
  lastReadAt: string | null;
  /** Request permissions and immediately attempt a fresh read. */
  requestPermissions: () => Promise<void>;
  /** Force a read, bypassing the rate limit. */
  refresh: () => Promise<void>;
};

export function useHealthData(): HealthDataState {
  const { health } = useAdapters();

  const [stepsToday, setStepsToday] = useState<number | null>(null);
  const [activeCaloriesToday, setActiveCaloriesToday] = useState<number | null>(
    null,
  );
  const [latestBodyWeight, setLatestBodyWeight] = useState<HealthWeight | null>(
    null,
  );
  const [permissionStatus, setPermissionStatus] =
    useState<HealthPermissionStatus>(DEFAULT_PERMISSIONS);
  const [isAvailable, setIsAvailable] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);

  // Tracks the last read timestamp across re-renders without causing
  // re-renders itself. State lives in `lastReadAt` for the caller; this
  // ref gates the rate limiter.
  const lastReadAtRef = useRef<number>(0);

  const doRead = useCallback(
    async (bypassRateLimit: boolean) => {
      const now = Date.now();
      if (
        !bypassRateLimit &&
        now - lastReadAtRef.current < HEALTH_READ_RATE_LIMIT_MS
      ) {
        return;
      }
      lastReadAtRef.current = now;

      const available = await health.isAvailable();
      setIsAvailable(available);
      const perms = await health.getPermissionStatus();
      setPermissionStatus(perms);

      if (!available) return;

      setIsReading(true);
      try {
        const [stepsResult, caloriesResult, weightResult] = await Promise.all([
          health.getStepsToday(),
          health.getActiveCaloriesToday(),
          health.getLatestBodyWeight(),
        ]);
        if (stepsResult.ok) setStepsToday(stepsResult.value);
        if (caloriesResult.ok) setActiveCaloriesToday(caloriesResult.value);
        if (weightResult.ok) setLatestBodyWeight(weightResult.value);
        setLastReadAt(new Date(now).toISOString());
      } finally {
        setIsReading(false);
      }
    },
    [health],
  );

  const refresh = useCallback(() => doRead(true), [doRead]);

  const requestPermissions = useCallback(async () => {
    const result = await health.requestPermissions();
    if (result.ok) {
      setPermissionStatus(result.value);
    }
    // Immediate read after permission request — bypass rate limit so
    // the dashboard tile populates the moment the user grants access.
    await doRead(true);
  }, [health, doRead]);

  // Initial read on mount (subject to rate limit across hot-reload
  // re-mounts within the same JS context).
  useEffect(() => {
    void doRead(false);
  }, [doRead]);

  // Re-read on app-foreground transitions. The listener cleanup below
  // is load-bearing — without it, each re-mount stacks a new listener
  // and a single foreground triggers N reads.
  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      if (status === "active") {
        void doRead(false);
      }
    };
    const subscription = AppState.addEventListener("change", onChange);
    return () => subscription.remove();
  }, [doRead]);

  return {
    stepsToday,
    activeCaloriesToday,
    latestBodyWeight,
    permissionStatus,
    isAvailable,
    isReading,
    lastReadAt,
    requestPermissions,
    refresh,
  };
}
