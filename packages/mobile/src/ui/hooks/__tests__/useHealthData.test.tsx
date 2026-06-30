import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AppState, type AppStateStatus } from "react-native";
import type { HealthPort } from "@/domain/ports/health.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  HEALTH_READ_RATE_LIMIT_MS,
  useHealthData,
} from "@/ui/hooks/useHealthData";

// Spy on the real AppState; capture registered listeners so we can
// drive foreground transitions + verify cleanup. Restored after each
// suite run so other tests see pristine RN modules.
const appStateListeners: ((status: AppStateStatus) => void)[] = [];
let mockRemove: jest.Mock;
let addEventListenerSpy: jest.SpiedFunction<typeof AppState.addEventListener>;

beforeEach(() => {
  appStateListeners.length = 0;
  mockRemove = jest.fn();
  addEventListenerSpy = jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation(((
      _event: string,
      cb: (status: AppStateStatus) => void,
    ) => {
      appStateListeners.push(cb);
      return { remove: mockRemove };
    }) as unknown as typeof AppState.addEventListener);
});

afterEach(() => {
  addEventListenerSpy.mockRestore();
});

function makeHealthAdapter(overrides: Partial<HealthPort> = {}): HealthPort {
  const grantedStatus = {
    steps: "granted",
    calories: "granted",
    bodyWeight: "granted",
    heartRate: "granted",
  } as const;
  const base: HealthPort = {
    isAvailable: async () => true,
    requestPermissions: async () => ok(grantedStatus),
    getPermissionStatus: async () => grantedStatus,
    getStepsToday: async () => ok(4812),
    getStepsLastNDays: async () => ok([]),
    getActiveCaloriesToday: async () => ok(312),
    getBasalCaloriesToday: async () => ok(1450),
    getStandTimeTodayMinutes: async () => ok(54),
    getLatestBodyWeight: async () =>
      ok({ value: 74.5, unit: "kg" as const, date: "2026-04-20T07:00:00Z" }),
    getHeartRateLatest: async () => ok(62),
    getLatestBodyFat: async () => ok(18.2),
    writeBodyWeight: async () =>
      ok(undefined) as Awaited<ReturnType<HealthPort["writeBodyWeight"]>>,
    writeBodyFat: async () =>
      ok(undefined) as Awaited<ReturnType<HealthPort["writeBodyFat"]>>,
    disconnect: async () => {},
  };
  // Wrap every function in a jest.fn so tests can count calls / override.
  const wrapped: HealthPort = {
    isAvailable: jest.fn(base.isAvailable),
    requestPermissions: jest.fn(base.requestPermissions),
    getPermissionStatus: jest.fn(base.getPermissionStatus),
    getStepsToday: jest.fn(base.getStepsToday),
    getStepsLastNDays: jest.fn(base.getStepsLastNDays),
    getActiveCaloriesToday: jest.fn(base.getActiveCaloriesToday),
    getBasalCaloriesToday: jest.fn(base.getBasalCaloriesToday),
    getStandTimeTodayMinutes: jest.fn(base.getStandTimeTodayMinutes),
    getLatestBodyWeight: jest.fn(base.getLatestBodyWeight),
    getHeartRateLatest: jest.fn(base.getHeartRateLatest),
    getLatestBodyFat: jest.fn(base.getLatestBodyFat),
    writeBodyWeight: jest.fn(base.writeBodyWeight),
    writeBodyFat: jest.fn(base.writeBodyFat),
    disconnect: jest.fn(base.disconnect),
  };
  return { ...wrapped, ...overrides };
}

function makeAdapters(health: HealthPort): Adapters {
  return {
    api: {} as Adapters["api"],
    auth: {} as Adapters["auth"],
    storage: {} as Adapters["storage"],
    health,
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
    netInfo: {} as Adapters["netInfo"],
  };
}

function wrap(adapters: Adapters) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  }
  return Wrapper;
}

describe("useHealthData", () => {
  it("reads health data on mount when available", async () => {
    const health = makeHealthAdapter();
    const { result } = renderHook(() => useHealthData(), {
      wrapper: wrap(makeAdapters(health)),
    });

    await waitFor(() => {
      expect(result.current.stepsToday).toBe(4812);
    });
    expect(result.current.activeCaloriesToday).toBe(312);
    expect(result.current.latestBodyWeight?.value).toBe(74.5);
    expect(result.current.latestBodyFat).toBe(18.2);
    expect(health.getLatestBodyFat).toHaveBeenCalled();
    expect(result.current.isAvailable).toBe(true);
    expect(result.current.permissionStatus.steps).toBe("granted");
    expect(result.current.lastReadAt).not.toBeNull();
  });

  it("skips reads when health is unavailable", async () => {
    const health = makeHealthAdapter({
      isAvailable: jest.fn(async () => false),
    });
    const { result } = renderHook(() => useHealthData(), {
      wrapper: wrap(makeAdapters(health)),
    });

    await waitFor(() => {
      expect(result.current.isAvailable).toBe(false);
    });
    expect(health.getStepsToday).not.toHaveBeenCalled();
  });

  it("refresh() bypasses the rate limit", async () => {
    const health = makeHealthAdapter();
    const { result } = renderHook(() => useHealthData(), {
      wrapper: wrap(makeAdapters(health)),
    });

    await waitFor(() => {
      expect(health.getStepsToday).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(health.getStepsToday).toHaveBeenCalledTimes(2);
  });

  it("read() respects the rate limit (unlike refresh)", async () => {
    const health = makeHealthAdapter();
    const { result } = renderHook(() => useHealthData(), {
      wrapper: wrap(makeAdapters(health)),
    });

    await waitFor(() => {
      expect(health.getStepsToday).toHaveBeenCalledTimes(1);
    });

    // Within the 5-min window since the mount read → read() is a no-op.
    await act(async () => {
      await result.current.read();
    });
    expect(health.getStepsToday).toHaveBeenCalledTimes(1);

    // refresh() still bypasses the window.
    await act(async () => {
      await result.current.refresh();
    });
    expect(health.getStepsToday).toHaveBeenCalledTimes(2);
  });

  it("requestPermissions() updates status and triggers a fresh read", async () => {
    const health = makeHealthAdapter();
    const { result } = renderHook(() => useHealthData(), {
      wrapper: wrap(makeAdapters(health)),
    });

    await waitFor(() => {
      expect(health.getStepsToday).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.requestPermissions();
    });

    expect(health.requestPermissions).toHaveBeenCalledTimes(1);
  });

  it("exposes a useful rate-limit constant (5 minutes)", () => {
    expect(HEALTH_READ_RATE_LIMIT_MS).toBe(5 * 60 * 1000);
  });

  it("re-reads on AppState foreground transition", async () => {
    const health = makeHealthAdapter();
    renderHook(() => useHealthData(), {
      wrapper: wrap(makeAdapters(health)),
    });

    await waitFor(() => {
      expect(health.getStepsToday).toHaveBeenCalled();
    });
    const initialCalls = (health.getStepsToday as jest.Mock).mock.calls.length;

    // Simulate app-foreground. Rate limiter will gate the re-read
    // (same tick), so the call count should NOT go up.
    act(() => {
      appStateListeners.forEach((cb) => cb("active"));
    });
    expect((health.getStepsToday as jest.Mock).mock.calls.length).toBe(
      initialCalls,
    );
  });

  it("does not consume the rate-limit window when health is unavailable", async () => {
    // Regression for bugbot finding on PR #37: lastReadAtRef used to
    // be set BEFORE the availability check, so an unavailable health
    // provider still burned the 5-minute rate-limit timer. The next
    // AppState foreground transition within the window (or any other
    // rate-limited caller) got silently skipped even though no real
    // read had ever happened. Fix: only set lastReadAtRef after
    // availability passes.
    const health = makeHealthAdapter({
      isAvailable: jest.fn(async () => false),
    });
    renderHook(() => useHealthData(), {
      wrapper: wrap(makeAdapters(health)),
    });

    // Mount-time read runs, hits isAvailable=false, returns early.
    await waitFor(() => {
      expect(health.isAvailable).toHaveBeenCalledTimes(1);
    });

    // Foreground transition in the same tick — if the rate-limit
    // window was burned by the mount call, this path would skip
    // entirely and isAvailable would still be at 1. With the fix,
    // the window is untouched and the availability check retries.
    await act(async () => {
      appStateListeners.forEach((cb) => cb("active"));
    });

    await waitFor(() => {
      expect(health.isAvailable).toHaveBeenCalledTimes(2);
    });
  });

  it("removes the AppState listener on unmount", async () => {
    const health = makeHealthAdapter();
    const { unmount } = renderHook(() => useHealthData(), {
      wrapper: wrap(makeAdapters(health)),
    });
    await waitFor(() => {
      expect(health.getStepsToday).toHaveBeenCalled();
    });
    unmount();
    expect(mockRemove).toHaveBeenCalled();
  });
});
