import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { Exercise } from "@/domain/models/exercise";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { SyncResult } from "@/application/commands/sync.command";
import { fail, ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  useOfflineDataBootstrap,
  warmOfflineData,
} from "@/ui/hooks/useOfflineDataBootstrap";

const EMPTY_SYNC_RESULT: SyncResult = {
  processed: 0,
  succeeded: 0,
  failed: 0,
  blocked: 0,
};
const mockProcessSyncQueue = jest.fn(
  async (..._args: unknown[]): Promise<SyncResult> => EMPTY_SYNC_RESULT,
);
jest.mock("@/application/commands/sync.command", () => ({
  processSyncQueue: (...args: unknown[]) => mockProcessSyncQueue(...args),
}));
jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

const SESSION: AuthSession = {
  accessToken: "token",
  refreshToken: "refresh",
  userId: "user-1",
  email: "athlete@example.com",
  expiresAt: Date.now() + 60_000,
};

function exercise(): Exercise {
  return {
    id: "exercise-1",
    name: "Back Squat",
    description: null,
    instructions: null,
    category: "strength",
    difficulty: "intermediate",
    primaryMuscleGroups: [],
    secondaryMuscleGroups: [],
    equipment: [],
    videoUrl: null,
    thumbnailUrl: null,
    isCustom: false,
    createdBy: null,
  };
}

function makeAdapters(
  connected = true,
  activeSession: AuthSession | null = SESSION,
) {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  storage.initialize();
  const netInfo = new InMemoryNetInfoAdapter(connected);
  const auth = {
    ...new InMemoryAuthAdapter(),
    onAuthStateChange: (cb: (session: AuthSession | null) => void) => {
      cb(activeSession);
      return () => {};
    },
    getSession: jest.fn(async () => ok(activeSession)),
    getAccessToken: jest.fn(async () => "token"),
  } as unknown as Adapters["auth"];
  const adapters = {
    api,
    auth,
    storage,
    netInfo,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
  } satisfies Adapters;
  return { adapters, api, auth, storage, netInfo };
}

function wrapper(adapters: Adapters) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

describe("warmOfflineData", () => {
  beforeEach(() => {
    mockProcessSyncQueue.mockReset();
    mockProcessSyncQueue.mockResolvedValue(EMPTY_SYNC_RESULT);
  });

  it("warms the Fuel, Progress and Exercises offline baseline", async () => {
    const { api, auth, storage } = makeAdapters();
    api.exercises = [exercise()];
    api.nutritionTarget = {
      userId: SESSION.userId,
      dailyKcal: 2200,
      proteinG: 160,
      carbsG: 240,
      fatG: 70,
      waterCups: 8,
      preset: "custom",
      setByUserId: null,
      setByName: null,
      updatedAt: null,
    };
    api.streaks = [
      {
        id: "streak-1",
        userId: SESSION.userId,
        streakType: "workout_streak",
        sourceGoalId: null,
        period: "weekly",
        currentCount: 2,
        longestCount: 4,
        lastPeriodEnd: "2026-08-30",
        freezeTokens: 1,
        status: "active",
      },
    ];

    await warmOfflineData({
      api,
      auth,
      storage,
      userId: SESSION.userId,
      date: "2026-08-31",
    });

    expect(mockProcessSyncQueue).toHaveBeenCalledTimes(1);
    expect(
      storage.getCachedFuelToday(SESSION.userId, "2026-08-31"),
    ).not.toBeNull();
    expect(storage.getCachedNutritionTarget(SESSION.userId)).not.toBeNull();
    expect(storage.getCachedStreaks(SESSION.userId)).toHaveLength(1);
    expect(storage.getCachedVolumeStats(SESSION.userId)).not.toBeNull();
    expect(storage.getCachedExercises()).toHaveLength(1);
    expect(storage.getLastSyncedAt("exercises")).not.toBeNull();
  });

  it("continues warming other read models when one endpoint fails", async () => {
    const { api, auth, storage } = makeAdapters();
    jest
      .spyOn(api, "getFuelToday")
      .mockResolvedValue(
        fail({ kind: "api", code: "network", message: "offline" }),
      );
    api.exercises = [exercise()];

    await warmOfflineData({
      api,
      auth,
      storage,
      userId: SESSION.userId,
      date: "2026-08-31",
    });

    expect(storage.getCachedFuelToday(SESSION.userId, "2026-08-31")).toBeNull();
    expect(storage.getCachedVolumeStats(SESSION.userId)).not.toBeNull();
    expect(storage.getCachedExercises()).toHaveLength(1);
  });

  it("tolerates every baseline endpoint being unavailable", async () => {
    const { api, auth, storage } = makeAdapters();
    api.shouldFail = true;

    await expect(
      warmOfflineData({
        api,
        auth,
        storage,
        userId: SESSION.userId,
        date: "2026-08-31",
      }),
    ).resolves.toBeUndefined();

    expect(storage.getCachedFuelToday(SESSION.userId, "2026-08-31")).toBeNull();
    expect(storage.getCachedVolumeStats(SESSION.userId)).toBeNull();
    expect(storage.getCachedExercises()).toHaveLength(0);
  });

  it("does not replace optimistic Fuel while a Fuel mutation remains queued", async () => {
    const { api, auth, storage } = makeAdapters();
    const date = "2026-08-31";
    const initial = await api.getFuelToday(date);
    if (!initial.ok) throw new Error("test fixture returned no Fuel data");
    storage.cacheFuelToday(SESSION.userId, date, initial.value);
    storage.enqueueMutation({
      entityType: "nutrition_entry",
      entityId: "local-entry",
      operation: "create",
      payload: {},
      endpoint: "/nutrition/entries",
      method: "POST",
    });
    const fuelSpy = jest.spyOn(api, "getFuelToday");

    await warmOfflineData({
      api,
      auth,
      storage,
      userId: SESSION.userId,
      date,
    });

    expect(fuelSpy).not.toHaveBeenCalled();
    expect(storage.getCachedFuelToday(SESSION.userId, date)).toEqual(
      initial.value,
    );
  });

  it("does not refresh Fuel when the queue drain itself fails", async () => {
    const { api, auth, storage } = makeAdapters();
    mockProcessSyncQueue.mockRejectedValueOnce(new Error("sync unavailable"));
    const fuelSpy = jest.spyOn(api, "getFuelToday");

    await warmOfflineData({
      api,
      auth,
      storage,
      userId: SESSION.userId,
      date: "2026-08-31",
    });

    expect(fuelSpy).not.toHaveBeenCalled();
    expect(storage.getCachedVolumeStats(SESSION.userId)).not.toBeNull();
  });
});

describe("useOfflineDataBootstrap", () => {
  beforeEach(() => {
    mockProcessSyncQueue.mockReset();
    mockProcessSyncQueue.mockResolvedValue(EMPTY_SYNC_RESULT);
  });

  it("waits while offline, then warms on reconnect", async () => {
    const { adapters, api, netInfo } = makeAdapters(false);
    const fuelSpy = jest.spyOn(api, "getFuelToday");

    renderHook(() => useOfflineDataBootstrap(), {
      wrapper: wrapper(adapters),
    });

    await act(async () => Promise.resolve());
    expect(fuelSpy).not.toHaveBeenCalled();

    act(() => netInfo.setConnected(true));
    await waitFor(() => expect(fuelSpy).toHaveBeenCalledTimes(1));
  });

  it("does not make authenticated requests without a session", async () => {
    const { adapters, api } = makeAdapters(true, null);
    const fuelSpy = jest.spyOn(api, "getFuelToday");

    renderHook(() => useOfflineDataBootstrap(), {
      wrapper: wrapper(adapters),
    });

    await act(async () => Promise.resolve());
    expect(fuelSpy).not.toHaveBeenCalled();
  });

  it("deduplicates a reconnect while the same user's warm is in flight", async () => {
    const { adapters, api, netInfo } = makeAdapters(true);
    let release!: () => void;
    mockProcessSyncQueue.mockImplementationOnce(
      () =>
        new Promise<SyncResult>(
          (resolve) => (release = () => resolve(EMPTY_SYNC_RESULT)),
        ),
    );
    const fuelSpy = jest.spyOn(api, "getFuelToday");

    renderHook(() => useOfflineDataBootstrap(), {
      wrapper: wrapper(adapters),
    });
    await waitFor(() => expect(mockProcessSyncQueue).toHaveBeenCalledTimes(1));

    act(() => {
      netInfo.setConnected(false);
      netInfo.setConnected(true);
    });
    release();

    await waitFor(() => expect(fuelSpy).toHaveBeenCalledTimes(1));
    expect(mockProcessSyncQueue).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale probe after the connectivity subscription has fired", async () => {
    const { adapters, api, netInfo } = makeAdapters(true);
    let resolveProbe!: (connected: boolean) => void;
    jest
      .spyOn(netInfo, "isConnected")
      .mockImplementationOnce(
        () => new Promise<boolean>((resolve) => (resolveProbe = resolve)),
      );
    const fuelSpy = jest.spyOn(api, "getFuelToday");

    renderHook(() => useOfflineDataBootstrap(), {
      wrapper: wrapper(adapters),
    });
    act(() => netInfo.setConnected(false));
    await act(async () => resolveProbe(true));
    expect(fuelSpy).not.toHaveBeenCalled();

    act(() => netInfo.setConnected(true));
    await waitFor(() => expect(fuelSpy).toHaveBeenCalledTimes(1));
  });

  it("recovers from a rejected initial connectivity probe", async () => {
    const { adapters, api, netInfo } = makeAdapters(true);
    jest
      .spyOn(netInfo, "isConnected")
      .mockRejectedValueOnce(new Error("probe unavailable"));
    const fuelSpy = jest.spyOn(api, "getFuelToday");

    renderHook(() => useOfflineDataBootstrap(), {
      wrapper: wrapper(adapters),
    });
    await act(async () => Promise.resolve());
    act(() => netInfo.setConnected(false));
    act(() => netInfo.setConnected(true));

    await waitFor(() => expect(fuelSpy).toHaveBeenCalledTimes(1));
  });
});
