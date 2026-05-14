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
import type { NotificationsPort } from "@/domain/ports/notifications.port";
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
  // Monotonically-incrementing generation counter — bumped by every
  // `start`, `extend`, and `skip`. An in-flight schedule IIFE
  // captures the value at invocation and re-checks after each await;
  // a mismatch means the user moved on (skipped, restarted with a
  // different duration, extended) while the platform notification
  // call was still in flight. The IIFE then either bails out before
  // scheduling, or cancels the just-scheduled id so the OS doesn't
  // fire a banner for a timer the user already dismissed. Closes the
  // race Brad flagged on the first notifications PR.
  const pendingScheduleGenRef = useRef(0);

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
      const startedAtIso = new Date(clock()).toISOString();
      storage.setRestTimerState(userId, {
        startedAt: startedAtIso,
        totalSeconds: seconds,
      });
      setTotalSeconds(seconds);
      setRemainingSeconds(seconds);

      // Bump the generation BEFORE the IIFE so any prior in-flight
      // schedule (from a quick double-tap on Start, or a previous
      // exercise's timer that's still resolving its
      // `scheduleLocalNotification` call) sees a stale value when
      // its post-await gen check runs, and bails out cleanly.
      const gen = ++pendingScheduleGenRef.current;

      // Permission is requested ONCE at app load in
      // `NotificationPermissionsBootstrap`; the in-flight code here
      // only reads status and skips silently when not granted. We
      // never prompt mid-flow — Brad's call, mirroring how
      // every other production app handles this.
      void (async () => {
        try {
          const status = await notifications.getPermissionStatus();
          // After the status await, the user may have skipped /
          // restarted. Compare gen — if it doesn't match, the IIFE
          // is for a timer that no longer exists.
          if (gen !== pendingScheduleGenRef.current) return;
          if (status !== "granted") return;

          // Recompute the trigger from wall-clock so the OS banner
          // fires at the same instant the in-app countdown reaches
          // zero. If we passed the original `seconds` here, the OS
          // would schedule `now + seconds` — but `now` is offset
          // from `startedAt` by however long the
          // `getPermissionStatus` call took (≪1 ms typically, but
          // an arbitrary amount on a slow device). The drift was
          // Brad's first review finding; without this recompute, a
          // 60 s rest timer with a 10 s status call would ding 10 s
          // after the in-app countdown hit zero.
          const startedAtMs = Date.parse(startedAtIso);
          const remaining = computeRemaining(startedAtMs, seconds, clock());
          if (remaining <= 0) return;

          const id = await notifications.scheduleLocalNotification({
            title: NOTIFICATION_TITLE,
            body: exerciseName
              ? `${exerciseName} — next set ready`
              : "Next set ready",
            triggerSeconds: remaining,
          });

          // Race-edge: between the schedule await suspending and
          // resolving, the user may have skipped. Re-check gen; if
          // stale, immediately cancel the id the OS just gave us so
          // the banner doesn't fire for a dismissed timer.
          if (gen !== pendingScheduleGenRef.current) {
            if (id) void notifications.cancelLocalNotification(id);
            return;
          }
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

      // Reschedule for the new remaining duration. Same race-guard
      // pattern as `start` — bump gen so any in-flight prior IIFE
      // bails, then recheck gen + recompute trigger from wall-clock
      // after the status await.
      const gen = ++pendingScheduleGenRef.current;
      const startedAtMs = Date.parse(persisted.startedAt);
      const initialRemaining = computeRemaining(startedAtMs, newTotal, clock());
      if (initialRemaining <= 0) return;

      void (async () => {
        try {
          const status = await notifications.getPermissionStatus();
          if (gen !== pendingScheduleGenRef.current) return;
          if (status !== "granted") return;

          // Re-read persisted state + recompute trigger from wall-
          // clock so the OS banner fires at the same instant the
          // in-app countdown reaches zero (cf. `start` for the
          // drift rationale).
          const refreshed = storage.getRestTimerState(userId);
          if (!refreshed) return;
          const refreshedStartedAtMs = Date.parse(refreshed.startedAt);
          const remaining = computeRemaining(
            refreshedStartedAtMs,
            refreshed.totalSeconds,
            clock(),
          );
          if (remaining <= 0) return;

          const id = await notifications.scheduleLocalNotification({
            title: NOTIFICATION_TITLE,
            body: "Next set ready",
            triggerSeconds: remaining,
          });
          if (gen !== pendingScheduleGenRef.current) {
            if (id) void notifications.cancelLocalNotification(id);
            return;
          }
          notificationIdRef.current = id || null;
        } catch {
          // Adapter throw — in-app countdown still ticks.
        }
      })();
    },
    [cancelNotification, clock, notifications, storage, userId],
  );

  const skip = useCallback(() => {
    // Bump gen so any IIFE from a prior `start` / `extend` whose
    // platform notification call is still in flight bails out on
    // its next post-await gen check (or cancels the id it just
    // received if it already scheduled). Without this, a user who
    // hits Skip during the brief window before
    // `scheduleLocalNotification` resolves would still get the
    // banner moments later for a timer they dismissed.
    pendingScheduleGenRef.current++;
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
