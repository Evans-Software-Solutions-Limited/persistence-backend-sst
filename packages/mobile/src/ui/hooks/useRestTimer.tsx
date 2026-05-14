/**
 * Rest timer hook — drift-tolerant countdown that survives app
 * backgrounding (M3, Story-003).
 *
 * Persists `{ startedAt, totalSeconds }` to SQLite via StoragePort.
 * On mount, reconciles `wall-clock - startedAt` so the timer picks
 * up exactly where it left off after a kill or background. Fires a
 * local notification when the timer reaches zero so the user gets a
 * ding even if the app is backgrounded — permission requested on
 * first start, with an in-app-only fallback if denied.
 *
 * Spec: specs/05-active-session/requirements.md STORY-003
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 5
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LocalNotification,
  NotificationsPort,
} from "@/domain/ports/notifications.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import { useAdapters } from "./useAdapters";

export type RestTimerSnapshot = {
  isActive: boolean;
  remainingSeconds: number;
  totalSeconds: number;
  /** 0..1 elapsed-fraction for the countdown ring. */
  progress: number;
};

export type RestTimerControls = {
  start: (totalSeconds: number, exerciseName?: string) => void;
  extend: (extraSeconds: number) => void;
  skip: () => void;
  dismiss: () => void;
};

const NOTIFICATION_TITLE = "Rest complete";

const computeRemaining = (
  startedAtMs: number,
  totalSeconds: number,
  nowMs: number,
): number => {
  const elapsed = Math.floor((nowMs - startedAtMs) / 1000);
  return Math.max(0, totalSeconds - elapsed);
};

const computeProgress = (
  remainingSeconds: number,
  totalSeconds: number,
): number => {
  if (totalSeconds <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - remainingSeconds / totalSeconds));
};

export type UseRestTimerOptions = {
  /** Override for tests (defaults to `() => Date.now()`). */
  clock?: () => number;
  /**
   * Override the user-id resolution; defaults to looking up via auth
   * adapter at call time. For tests where no auth is mounted, pass
   * a fixed id.
   */
  userId: string;
};

export function useRestTimer(
  options: UseRestTimerOptions,
): RestTimerSnapshot & RestTimerControls {
  const { storage, notifications } = useAdapters();
  return useRestTimerWith({
    storage,
    notifications,
    userId: options.userId,
    clock: options.clock,
  });
}

/**
 * Test seam: pass adapters directly so the hook can be exercised
 * without an AdapterProvider tree.
 */
export type UseRestTimerWithDeps = {
  storage: StoragePort;
  notifications: NotificationsPort;
  userId: string;
  clock?: () => number;
};

export function useRestTimerWith(
  deps: UseRestTimerWithDeps,
): RestTimerSnapshot & RestTimerControls {
  const { storage, notifications, userId } = deps;
  // Stabilise the clock reference so the countdown's useEffect deps
  // don't change every render (deps.clock is allowed to be undefined).
  const providedClock = deps.clock;
  const clock = useMemo(
    () => providedClock ?? (() => Date.now()),
    [providedClock],
  );

  const [totalSeconds, setTotalSeconds] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const notificationIdRef = useRef<string | null>(null);

  const stopInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const cancelNotification = useCallback(() => {
    const id = notificationIdRef.current;
    notificationIdRef.current = null;
    if (id) void notifications.cancelLocalNotification(id);
  }, [notifications]);

  // Bootstrap from persisted state. M2 learning #11: hook stays
  // mounted across the active-session screen so this only runs once
  // per session screen mount; the AppState listener handles wake-up.
  useEffect(() => {
    const persisted = storage.getRestTimerState(userId);
    if (!persisted) return;
    const startedAtMs = Date.parse(persisted.startedAt);
    if (Number.isNaN(startedAtMs)) {
      storage.clearRestTimerState(userId);
      return;
    }
    const remaining = computeRemaining(
      startedAtMs,
      persisted.totalSeconds,
      clock(),
    );
    setTotalSeconds(persisted.totalSeconds);
    setRemainingSeconds(remaining);
    if (remaining === 0) {
      storage.clearRestTimerState(userId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drive the countdown via setInterval. Kept simple — we re-derive
  // from wall-clock on every tick so drift can't accumulate.
  useEffect(() => {
    if (totalSeconds === 0 || remainingSeconds === 0) {
      stopInterval();
      return;
    }
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => {
      const persisted = storage.getRestTimerState(userId);
      if (!persisted) {
        setRemainingSeconds(0);
        stopInterval();
        return;
      }
      const startedAtMs = Date.parse(persisted.startedAt);
      const next = computeRemaining(
        startedAtMs,
        persisted.totalSeconds,
        clock(),
      );
      setRemainingSeconds(next);
      if (next === 0) {
        storage.clearRestTimerState(userId);
        stopInterval();
      }
    }, 1000);
    return () => stopInterval();
  }, [totalSeconds, remainingSeconds, storage, userId, clock, stopInterval]);

  const start = useCallback(
    (seconds: number, exerciseName?: string) => {
      if (seconds <= 0) return;
      cancelNotification();
      const startedAt = new Date(clock()).toISOString();
      storage.setRestTimerState(userId, { startedAt, totalSeconds: seconds });
      setTotalSeconds(seconds);
      setRemainingSeconds(seconds);

      const payload: LocalNotification = {
        title: NOTIFICATION_TITLE,
        body: exerciseName
          ? `${exerciseName} — next set ready`
          : "Next set ready",
        triggerSeconds: seconds,
      };

      // Permission safety net. The first-authenticated-mount prompt
      // in `useNotificationPermissions` covers the common path, but
      // a user can still land here in the `not_determined` state if
      // they (a) skipped past the home screen via a deep link,
      // (b) signed out and back in with a stale AsyncStorage flag,
      // or (c) revoked permission in Settings then re-installed
      // without clearing app data. Re-checking here means the
      // earliest possible moment a user actually needs the
      // permission triggers the prompt; if they already granted /
      // denied, this is a no-op. Denied → fall through to in-app
      // countdown only (the catch below already covers schedule
      // failures, but we don't want to schedule at all when status
      // is denied — silently scheduling is what made the bug
      // invisible on staging before).
      void (async () => {
        try {
          const status = await notifications.getPermissionStatus();
          if (status === "not_determined") {
            await notifications.requestPermissions();
          }
          const finalStatus =
            status === "not_determined"
              ? await notifications.getPermissionStatus()
              : status;
          if (finalStatus !== "granted") return;
          const id = await notifications.scheduleLocalNotification(payload);
          notificationIdRef.current = id || null;
        } catch {
          // Adapter throw or platform-level scheduling failure —
          // fall back to the in-app countdown only. The screen's
          // `RestTimerDisplay` keeps running on its own setInterval
          // tick regardless of notification state.
        }
      })();
    },
    [cancelNotification, clock, notifications, storage, userId],
  );

  const extend = useCallback(
    (extra: number) => {
      if (extra <= 0) return;
      const persisted = storage.getRestTimerState(userId);
      if (!persisted) return;
      const newTotal = persisted.totalSeconds + extra;
      storage.setRestTimerState(userId, {
        startedAt: persisted.startedAt,
        totalSeconds: newTotal,
      });
      cancelNotification();
      setTotalSeconds(newTotal);
      setRemainingSeconds((prev) => prev + extra);

      // Reschedule notification for the new remaining duration. Skip
      // outright when permission isn't granted — `start` would have
      // already handled the prompt if status was `not_determined`,
      // so here we only need a status read (no re-prompt) to avoid
      // a silent no-op schedule.
      const startedAtMs = Date.parse(persisted.startedAt);
      const newRemaining = computeRemaining(startedAtMs, newTotal, clock());
      if (newRemaining > 0) {
        void (async () => {
          try {
            const status = await notifications.getPermissionStatus();
            if (status !== "granted") return;
            const id = await notifications.scheduleLocalNotification({
              title: NOTIFICATION_TITLE,
              body: "Next set ready",
              triggerSeconds: newRemaining,
            });
            notificationIdRef.current = id || null;
          } catch {
            // Adapter throw — in-app countdown still ticks.
          }
        })();
      }
    },
    [cancelNotification, clock, notifications, storage, userId],
  );

  const skip = useCallback(() => {
    cancelNotification();
    storage.clearRestTimerState(userId);
    setTotalSeconds(0);
    setRemainingSeconds(0);
    stopInterval();
  }, [cancelNotification, storage, stopInterval, userId]);

  const dismiss = skip;

  return {
    isActive: totalSeconds > 0 && remainingSeconds > 0,
    remainingSeconds,
    totalSeconds,
    progress: computeProgress(remainingSeconds, totalSeconds),
    start,
    extend,
    skip,
    dismiss,
  };
}
