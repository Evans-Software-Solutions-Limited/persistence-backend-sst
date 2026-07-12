import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { WorkoutHistory } from "@/domain/models/workout";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useWorkoutHistory } from "@/ui/hooks/useWorkoutHistory";

function makeAdapters(api: InMemoryApiAdapter): Adapters {
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: "user-1",
    email: "u@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  return {
    api,
    auth,
    storage: new InMemoryStorageAdapter(),
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
    netInfo: {} as Adapters["netInfo"],
  };
}

function wrap(adapters: Adapters) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

const HISTORY: WorkoutHistory = {
  completedCount: 5,
  lastCompletedAt: "2026-07-01T00:00:00Z",
  avgDurationSeconds: 2400,
  lastSession: {
    completedAt: "2026-07-01T00:00:00Z",
    totalVolumeKg: 5000,
    durationSeconds: 2500,
  },
};

describe("useWorkoutHistory", () => {
  it("stays null with no fetch when workoutId is null", () => {
    const api = new InMemoryApiAdapter();
    const spy = jest.spyOn(api, "getWorkoutHistory");
    const { result } = renderHook(() => useWorkoutHistory(null), {
      wrapper: wrap(makeAdapters(api)),
    });
    expect(result.current.history).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("skips the round-trip for optimistic local- ids", () => {
    const api = new InMemoryApiAdapter();
    const spy = jest.spyOn(api, "getWorkoutHistory");
    const { result } = renderHook(() => useWorkoutHistory("local-123"), {
      wrapper: wrap(makeAdapters(api)),
    });
    expect(result.current.history).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("loads history for a server id", async () => {
    const api = new InMemoryApiAdapter();
    api.workoutHistory.set("w-1", HISTORY);
    const { result } = renderHook(() => useWorkoutHistory("w-1"), {
      wrapper: wrap(makeAdapters(api)),
    });
    await waitFor(() => expect(result.current.history).toEqual(HISTORY));
    expect(result.current.error).toBeNull();
  });

  it("renders null (non-fatal) on error", async () => {
    const api = new InMemoryApiAdapter();
    api.shouldFail = true;
    const { result } = renderHook(() => useWorkoutHistory("w-1"), {
      wrapper: wrap(makeAdapters(api)),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.history).toBeNull();
    expect(result.current.error).not.toBeNull();
  });
});
