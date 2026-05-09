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
});
