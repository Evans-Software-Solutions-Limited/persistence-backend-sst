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

  it("start() prompts for permission when status is `not_determined`, then schedules on grant", async () => {
    // Reproduces the M3 Phase 3b staging bug: on a fresh install
    // status is `not_determined`. Pre-fix, the hook scheduled
    // straight away and the OS silently dropped the schedule. Post-
    // fix, the hook calls `requestPermissions` first; the user sees
    // the system permission prompt, grants, then the schedule
    // proceeds against `granted` status.
    let getStatusCalls = 0;
    notifications.getPermissionStatus = jest.fn().mockImplementation(() => {
      getStatusCalls += 1;
      // First read: status before prompt. Second read: status after
      // prompt resolved (granted).
      return Promise.resolve(
        getStatusCalls === 1 ? "not_determined" : "granted",
      );
    });
    const requestSpy = jest
      .spyOn(notifications, "requestPermissions")
      .mockResolvedValue(ok("granted"));

    const { result } = renderHook(() =>
      useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
    );
    act(() => {
      result.current.start(90);
    });
    // Two `await`s in the granted path; four in the `not_determined →
    // request → re-check → schedule` path. Flush generously.
    await flushMicrotasks();
    await flushMicrotasks();

    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(notifications.scheduleArgs).toHaveLength(1);
    expect(notifications.scheduleArgs[0].triggerSeconds).toBe(90);
  });

  it("start() skips scheduling when permission status is `denied` (no silent no-op)", async () => {
    // Pre-fix, the hook called `scheduleLocalNotification`
    // regardless of permission; on iOS the OS silently dropped the
    // notification and the user never saw a banner. Post-fix, the
    // hook reads the status, sees `denied`, falls back to the in-
    // app countdown only.
    notifications.getPermissionStatus = jest.fn().mockResolvedValue("denied");
    const requestSpy = jest.spyOn(notifications, "requestPermissions");

    const { result } = renderHook(() =>
      useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
    );
    act(() => {
      result.current.start(60);
    });
    await flushMicrotasks();

    // No re-prompt when status is already denied (the prompt would
    // be a no-op on iOS without going through Settings first).
    expect(requestSpy).not.toHaveBeenCalled();
    expect(notifications.scheduleArgs).toHaveLength(0);
    // Timer still runs in-app — the screen's RestTimerDisplay
    // doesn't need notification permission to tick down.
    expect(result.current.isActive).toBe(true);
    expect(result.current.remainingSeconds).toBe(60);
  });

  it("start() skips scheduling when the user denies the permission prompt", async () => {
    // `not_determined` → prompt → `denied`. The re-check after the
    // prompt sees the new status and bails out of the schedule.
    let getStatusCalls = 0;
    notifications.getPermissionStatus = jest.fn().mockImplementation(() => {
      getStatusCalls += 1;
      return Promise.resolve(
        getStatusCalls === 1 ? "not_determined" : "denied",
      );
    });
    jest
      .spyOn(notifications, "requestPermissions")
      .mockResolvedValue(ok("denied"));

    const { result } = renderHook(() =>
      useRestTimerWith({ storage, notifications, userId: "user-1", clock }),
    );
    act(() => {
      result.current.start(45);
    });
    await flushMicrotasks();
    await flushMicrotasks();

    expect(notifications.scheduleArgs).toHaveLength(0);
    expect(result.current.isActive).toBe(true);
  });

  it("extend() does NOT prompt for permission again (start already handled it)", async () => {
    // First `start` would have requested permission if needed; by
    // the time the user taps Extend, the status is settled. Extend
    // just reads the status — re-prompting from extend would be
    // pushy (user is mid-set, doesn't want a system modal).
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
