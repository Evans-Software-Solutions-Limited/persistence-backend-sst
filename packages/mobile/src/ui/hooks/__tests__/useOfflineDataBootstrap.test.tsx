import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { Exercise } from "@/domain/models/exercise";
import type { AuthSession } from "@/domain/ports/auth.port";
import { fail, ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  useOfflineDataBootstrap,
  warmOfflineData,
} from "@/ui/hooks/useOfflineDataBootstrap";

const mockProcessSyncQueue = jest.fn(
  async (..._args: unknown[]): Promise<void> => undefined,
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
  beforeEach(() => mockProcessSyncQueue.mockClear());

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
});

describe("useOfflineDataBootstrap", () => {
  beforeEach(() => mockProcessSyncQueue.mockClear());

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
      () => new Promise<void>((resolve) => (release = resolve)),
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
});
