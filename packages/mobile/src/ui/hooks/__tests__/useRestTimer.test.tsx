import { act, renderHook } from "@testing-library/react-native";
import { useRestTimerWith } from "../useRestTimer";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { WorkoutSession } from "@/domain/models/session";
import type {
  LocalNotification,
  NotificationsPort,
  NotificationError,
} from "@/domain/ports/notifications.port";
import { ok, type Result } from "@/shared/errors";

const buildSession = (): WorkoutSession => ({
  id: "local-s1",
  userId: "user-1",
  workoutId: null,
  name: "Push",
  status: "in_progress",
  startedAt: "2026-05-05T10:00:00.000Z",
  completedAt: null,
  notes: null,
  exercises: [],
});

class StubNotifications implements NotificationsPort {
  scheduledIds: string[] = [];
  cancelledIds: string[] = [];
  scheduleArgs: LocalNotification[] = [];
  nextId = 1;

  async requestPermissions(): Promise<
    Result<"granted" | "denied", NotificationError>
  > {
    return ok("granted");
  }
  async getPermissionStatus(): Promise<
    "granted" | "denied" | "not_determined"
  > {
    return "granted";
  }
  async getDevicePushToken(): Promise<Result<string, NotificationError>> {
    return ok("stub");
  }
  async scheduleLocalNotification(n: LocalNotification): Promise<string> {
    this.scheduleArgs.push(n);
    const id = `notif-${this.nextId++}`;
    this.scheduledIds.push(id);
    return id;
  }
  async cancelLocalNotification(id: string): Promise<void> {
    this.cancelledIds.push(id);
  }
  addPushTokenListener(): () => void {
    return () => {};
  }
  addNotificationReceivedListener(): () => void {
    return () => {};
  }
  addNotificationResponseListener(): () => void {
    return () => {};
  }
  async getLastNotificationResponse(): Promise<null> {
    return null;
  }
}

// jest.useFakeTimers() blocks setImmediate; flush microtasks via real
// Promise.resolve to drain pending .then() callbacks (e.g. notification
// scheduling) without leaving fake-timer mode.
const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("useRestTimer", () => {
  let storage: InMemoryStorageAdapter;
  let notifications: StubNotifications;
  let nowMs = Date.parse("2026-05-05T10:00:00.000Z");
  const clock = () => nowMs;

  beforeEach(() => {
    jest.useFakeTimers();
    nowMs = Date.parse("2026-05-05T10:00:00.000Z");
    storage = new InMemoryStorageAdapter();
    notifications = new StubNotifications();
    storage.cacheActiveSession("user-1", buildSession());
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("starts inactive when no persisted state exists", () => {
    const { result } = renderHook(() =>
      useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
    );
    expect(result.current.isActive).toBe(false);
    expect(result.current.remainingSeconds).toBe(0);
  });

  it("start() persists state, schedules a notification, and renders the countdown", async () => {
    const { result } = renderHook(() =>
      useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
    );

    act(() => {
      result.current.start(90, "Bench Press");
    });
    await flushMicrotasks();

    expect(result.current.isActive).toBe(true);
    expect(result.current.totalSeconds).toBe(90);
    expect(result.current.remainingSeconds).toBe(90);
    expect(result.current.progress).toBe(0);

    expect(storage.getRestTimerState("user-1")).toEqual({
      startedAt: "2026-05-05T10:00:00.000Z",
      totalSeconds: 90,
    });
    expect(notifications.scheduleArgs).toHaveLength(1);
    expect(notifications.scheduleArgs[0].triggerSeconds).toBe(90);
    expect(notifications.scheduleArgs[0].body).toContain("Bench Press");
  });

  it("ticks down each second using wall-clock reconciliation", () => {
    const { result } = renderHook(() =>
      useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
    );
    act(() => {
      result.current.start(60);
    });

    act(() => {
      nowMs += 5_000;
      jest.advanceTimersByTime(1_000);
    });
    expect(result.current.remainingSeconds).toBe(55);
    expect(result.current.progress).toBeCloseTo(5 / 60);
  });

  it("clears storage when the timer naturally hits zero", () => {
    const { result } = renderHook(() =>
      useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
    );
    act(() => {
      result.current.start(3);
    });
    act(() => {
      nowMs += 5_000;
      jest.advanceTimersByTime(1_000);
    });
    expect(result.current.remainingSeconds).toBe(0);
    expect(storage.getRestTimerState("user-1")).toBeNull();
  });

  it("skip() clears state and cancels the pending notification", async () => {
    const { result } = renderHook(() =>
      useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
    );
    act(() => {
      result.current.start(90);
    });
    await flushMicrotasks();
    expect(notifications.scheduledIds).toHaveLength(1);

    act(() => {
      result.current.skip();
    });
    expect(result.current.isActive).toBe(false);
    expect(storage.getRestTimerState("user-1")).toBeNull();
    expect(notifications.cancelledIds).toEqual(notifications.scheduledIds);
  });

  it("extend(+30) bumps total + remaining and reschedules the notification", async () => {
    const { result } = renderHook(() =>
      useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
    );
    act(() => {
      result.current.start(60);
    });
    await flushMicrotasks();

    act(() => {
      nowMs += 10_000;
      jest.advanceTimersByTime(1_000);
    });
    expect(result.current.remainingSeconds).toBe(50);

    act(() => {
      result.current.extend(30);
    });
    await flushMicrotasks();

    expect(result.current.totalSeconds).toBe(90);
    expect(result.current.remainingSeconds).toBe(80);
    expect(notifications.scheduleArgs.length).toBeGreaterThan(1);
    expect(notifications.cancelledIds.length).toBeGreaterThan(0);
  });

  it("bootstraps from persisted state on mount (background-survival)", () => {
    const startedAtMs = Date.parse("2026-05-05T09:59:30.000Z");
    storage.setRestTimerState("user-1", {
      startedAt: new Date(startedAtMs).toISOString(),
      totalSeconds: 60,
    });
    nowMs = Date.parse("2026-05-05T10:00:00.000Z");

    const { result } = renderHook(() =>
      useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
    );

    // 30s elapsed since persisted start → 30s remaining.
    expect(result.current.totalSeconds).toBe(60);
    expect(result.current.remainingSeconds).toBe(30);
    expect(result.current.isActive).toBe(true);
  });

  it("clears persisted state on mount when bootstrapped past zero", () => {
    storage.setRestTimerState("user-1", {
      startedAt: "2026-05-05T09:00:00.000Z",
      totalSeconds: 60,
    });
    const { result } = renderHook(() =>
      useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
    );
    expect(result.current.isActive).toBe(false);
    expect(storage.getRestTimerState("user-1")).toBeNull();
  });

  it("clears persisted state when bootstrapped with an unparsable startedAt", () => {
    storage.setRestTimerState("user-1", {
      startedAt: "not-an-iso",
      totalSeconds: 60,
    });
    renderHook(() =>
      useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
    );
    expect(storage.getRestTimerState("user-1")).toBeNull();
  });

  it("treats start(0) as a no-op", () => {
    const { result } = renderHook(() =>
      useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
    );
    act(() => {
      result.current.start(0);
    });
    expect(result.current.isActive).toBe(false);
    expect(notifications.scheduleArgs).toHaveLength(0);
  });

  it("dismiss() behaves identically to skip", async () => {
    const { result } = renderHook(() =>
      useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
    );
    act(() => {
      result.current.start(60);
    });
    await flushMicrotasks();
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.isActive).toBe(false);
  });

  it("survives notification scheduling failures (no throw, fallback to in-app countdown)", async () => {
    notifications.scheduleLocalNotification = jest
      .fn()
      .mockRejectedValue(new Error("permission denied"));
    const { result } = renderHook(() =>
      useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
    );
    act(() => {
      result.current.start(30);
    });
    await flushMicrotasks();
    expect(result.current.isActive).toBe(true);
  });

  it("extend(0) is a no-op", () => {
    const { result } = renderHook(() =>
      useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
    );
    act(() => {
      result.current.start(60);
    });
    act(() => {
      result.current.extend(0);
    });
    expect(result.current.totalSeconds).toBe(60);
  });

  it("start() never calls requestPermissions — permission is asked once at app load only (no mid-flow prompts)", async () => {
    // Brad's call: "We should not request notification permissions
    // halfway through flows." The hook reads the OS status and
    // schedules only when it's already `granted`; the prompt itself
    // is owned by `NotificationPermissionsBootstrap` at app load.
    // This test covers both `not_determined` and `denied` start
    // states to assert the hook silently falls back to in-app
    // countdown in either case.
    const requestSpy = jest.spyOn(notifications, "requestPermissions");

    for (const status of ["not_determined", "denied"] as const) {
      notifications.getPermissionStatus = jest.fn().mockResolvedValue(status);
      const { result, unmount } = renderHook(() =>
        useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
      );
      act(() => {
        result.current.start(60);
      });
      await flushMicrotasks();
      // Timer still ticks in-app regardless of status.
      expect(result.current.isActive).toBe(true);
      unmount();
      storage.clearRestTimerState("user-1");
    }
    expect(requestSpy).not.toHaveBeenCalled();
    expect(notifications.scheduleArgs).toHaveLength(0);
  });

  it("start() recomputes triggerSeconds from startedAt so the OS banner fires when the in-app countdown reaches zero (drift fix)", async () => {
    // Bug Brad flagged: the original code passed the literal
    // `seconds` arg to scheduleLocalNotification, but the schedule
    // call happens AFTER an `await getPermissionStatus()`. If the
    // status read takes 10 s (slow device, debugger pause, etc.),
    // the OS would schedule `now + 60` while the in-app countdown
    // has been ticking from `startedAt` — the banner ends up 10 s
    // late. Recomputing the trigger from `startedAt` keeps both
    // clocks aligned.
    let resolveStatus: ((s: "granted") => void) | null = null;
    notifications.getPermissionStatus = jest.fn().mockImplementation(
      () =>
        new Promise<"granted">((r) => {
          resolveStatus = r;
        }),
    );

    const { result } = renderHook(() =>
      useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
    );

    // T=0: user starts a 60 s rest.
    act(() => {
      result.current.start(60);
    });
    // T=10: clock advances while the permission-status call is
    // still pending (simulates a slow / blocked status read).
    nowMs += 10_000;

    // Now resolve the status — the IIFE will compute its
    // triggerSeconds *after* this resolves.
    if (resolveStatus) (resolveStatus as (s: "granted") => void)("granted");
    await flushMicrotasks();
    await flushMicrotasks();

    expect(notifications.scheduleArgs).toHaveLength(1);
    // 60 s rest, 10 s burned waiting on the status read → 50 s
    // remaining when the OS banner gets scheduled. Pre-fix this
    // would have been 60 s, i.e. the banner would fire 10 s after
    // the in-app countdown reached zero.
    expect(notifications.scheduleArgs[0].triggerSeconds).toBe(50);
  });

  it("skip() called mid-schedule cancels the just-scheduled notification (race guard)", async () => {
    // The user taps Skip while the platform's
    // `scheduleLocalNotification` is still in flight. Pre-fix, the
    // skip ran `cancelNotification` with `notificationIdRef.current
    // === null` (the IIFE hadn't returned the id yet) so nothing
    // got cancelled; moments later the OS would fire a banner for
    // the dismissed timer. Post-fix, the generation token tells the
    // IIFE its work is no longer wanted — it cancels the id the OS
    // hands back instead of stashing it.
    let resolveSchedule: ((id: string) => void) | null = null;
    notifications.scheduleLocalNotification = jest.fn().mockImplementation(
      () =>
        new Promise<string>((r) => {
          resolveSchedule = r;
        }),
    );

    const { result } = renderHook(() =>
      useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
    );
    act(() => {
      result.current.start(60);
    });
    // Drain the status microtask so we're now suspended on the
    // schedule call.
    await flushMicrotasks();

    // User skips mid-flight.
    act(() => {
      result.current.skip();
    });
    expect(result.current.isActive).toBe(false);

    // Schedule promise resolves AFTER skip — the IIFE's post-await
    // gen check should detect the mismatch and cancel the id.
    if (resolveSchedule) (resolveSchedule as (id: string) => void)("late-id-1");
    await flushMicrotasks();
    await flushMicrotasks();

    expect(notifications.cancelledIds).toContain("late-id-1");
  });

  it("start() called twice in rapid succession cancels the first scheduled notification (no leak)", async () => {
    // Re-entrant start: user starts a 60 s rest, then immediately
    // starts again with 120 s (e.g. picked the wrong exercise's
    // rest preset). Both IIFEs race; without the generation guard,
    // both schedules land in the OS queue but only the second's
    // id is stored in `notificationIdRef`. Skip would then only
    // cancel the second — the first leaks and fires for a timer
    // that no longer exists.
    let firstResolve: ((id: string) => void) | null = null;
    let secondResolve: ((id: string) => void) | null = null;
    let callCount = 0;
    notifications.scheduleLocalNotification = jest.fn().mockImplementation(
      () =>
        new Promise<string>((r) => {
          callCount += 1;
          if (callCount === 1) firstResolve = r;
          else secondResolve = r;
        }),
    );

    const { result } = renderHook(() =>
      useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
    );
    act(() => {
      result.current.start(60);
    });
    await flushMicrotasks();
    // Restart with a different duration before the first schedule
    // resolves.
    act(() => {
      result.current.start(120);
    });
    await flushMicrotasks();

    // First IIFE's schedule resolves with an id the user doesn't
    // want — the post-await gen check must cancel it.
    if (firstResolve) (firstResolve as (id: string) => void)("first-id");
    await flushMicrotasks();
    // Second IIFE's schedule resolves cleanly.
    if (secondResolve) (secondResolve as (id: string) => void)("second-id");
    await flushMicrotasks();

    expect(notifications.cancelledIds).toContain("first-id");
    expect(notifications.cancelledIds).not.toContain("second-id");
  });

  it("extend() does NOT prompt for permission (no mid-flow prompts)", async () => {
    // Same rationale as start(): permission is owned by app-load.
    // Extend just reads status — never prompts.
    const { result } = renderHook(() =>
      useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
    );
    act(() => {
      result.current.start(60);
    });
    await flushMicrotasks();
    const requestSpy = jest.spyOn(notifications, "requestPermissions");

    act(() => {
      result.current.extend(30);
    });
    await flushMicrotasks();

    expect(requestSpy).not.toHaveBeenCalled();
    expect(notifications.scheduleArgs.length).toBeGreaterThan(1);
  });

  it("extend() skips scheduling when permission isn't granted at extend time", async () => {
    // Race-edge: user starts timer (granted), then revokes
    // permission via Settings while the app is backgrounded, then
    // foregrounds and taps Extend. extend() must not silently
    // schedule a notification the OS will drop.
    notifications.getPermissionStatus = jest
      .fn()
      // start() sees granted, first schedule fires.
      .mockResolvedValueOnce("granted")
      // extend() sees denied — skip the schedule.
      .mockResolvedValueOnce("denied");
    const { result } = renderHook(() =>
      useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
    );
    act(() => {
      result.current.start(60);
    });
    await flushMicrotasks();
    const scheduleCountAfterStart = notifications.scheduleArgs.length;

    act(() => {
      result.current.extend(30);
    });
    await flushMicrotasks();

    // No new schedule fired — extend bailed on the denied status.
    expect(notifications.scheduleArgs.length).toBe(scheduleCountAfterStart);
  });
});
