import { act, render, waitFor } from "@testing-library/react-native";
import { Share } from "react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { SessionSummaryPresenterProps } from "@/ui/presenters/SessionSummaryPresenter";
import type { WorkoutDetailsPresenterProps } from "@/ui/presenters/WorkoutDetailsPresenter";
import { session as finished } from "@/domain/services/__tests__/youFixtures";
import { createYouRemoteSource } from "@/application/queries/youRemote";
import { remoteDayFixture } from "@/application/queries/__tests__/youRemoteFixtures";
import {
  HistoryWorkoutContainer,
  toSummaryRecord,
} from "../HistoryWorkoutContainer";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));
const mockBack = jest.fn();
const mockParams: { id?: string; at?: string } = {};
jest.mock("expo-router", () => ({
  router: { back: () => mockBack() },
  useLocalSearchParams: () => mockParams,
}));
const mockProbe: {
  pages: SessionSummaryPresenterProps | null;
  details: WorkoutDetailsPresenterProps | null;
} = { pages: null, details: null };
jest.mock("@/ui/presenters/SessionSummaryPresenter", () => ({
  SessionSummaryPresenter: (p: SessionSummaryPresenterProps) => {
    mockProbe.pages = p;
    mockProbe.details = null;
    return null;
  },
}));
jest.mock("@/ui/presenters/WorkoutDetailsPresenter", () => ({
  WorkoutDetailsPresenter: (p: WorkoutDetailsPresenterProps) => {
    mockProbe.details = p;
    mockProbe.pages = null;
    return null;
  },
}));
(globalThis as Record<string, unknown>).fetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: {} }),
}));

function makeAdapters() {
  const storage = new InMemoryStorageAdapter();
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: "user-1",
    email: "a@b.c",
    expiresAt: Date.now() + 60_000,
  };
  return {
    storage,
    adapters: {
      api: new InMemoryApiAdapter(),
      auth: {
        getSession: jest.fn(async () => ok(session)),
        onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
          cb(session);
          return () => {};
        }),
        getAccessToken: jest.fn(async () => "t"),
      } as unknown as Adapters["auth"],
      storage,
      health: {} as Adapters["health"],
      notifications: {} as Adapters["notifications"],
      netInfo: {} as Adapters["netInfo"],
    } as Adapters,
  };
}

/** A record response, as the sync drain caches it for a finished workout. */
function respond(
  storage: InMemoryStorageAdapter,
  localSessionId: string,
  exerciseId: string,
) {
  storage.cacheRecordResponse("user-1", {
    localSessionId,
    personalRecords: [
      {
        exerciseId,
        exerciseName: exerciseId,
        recordType: "1rm",
        newValue: 100,
        previousValue: 95,
        setId: "s1",
      },
    ],
    workoutsThisMonth: 1,
    cachedAt: "x",
  });
}

describe("HistoryWorkoutContainer (Y2b)", () => {
  beforeEach(() => {
    mockProbe.pages = null;
    mockProbe.details = null;
    mockBack.mockClear();
  });

  it("opens a workout History read from the server (BE-H1)", async () => {
    const { storage, adapters } = makeAdapters();
    const api = adapters.api as InMemoryApiAdapter;
    api.historyDays.set("2026-09-14", remoteDayFixture);
    await createYouRemoteSource(api, storage, "user-1").historyDay!(
      "2026-09-14",
    );
    mockParams.id = "srv-1";
    mockParams.at = "2026-09-14T07:10:00.000Z";
    render(
      <AdapterProvider adapters={adapters}>
        <HistoryWorkoutContainer />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.pages).not.toBeNull());
    expect(mockProbe.pages!.model).toMatchObject({
      name: "Upper A",
      volumeKg: 500,
      sets: 1,
      durationSeconds: 600,
    });
    delete mockParams.id;
    delete mockParams.at;
  });

  it("opens a past workout in the summary carousel with Close, not Continue", async () => {
    const { storage, adapters } = makeAdapters();
    storage.saveTrainingLogEntry(
      "user-1",
      finished(
        "w1",
        "2026-10-26T07:10:00.000Z",
        {
          bench: [
            [95, 5],
            [95, 5],
          ],
        },
        { name: "Upper A" },
      ),
    );
    // Each workout's own records arrive with its record response.
    respond(storage, "w1", "bench");
    respond(storage, "other", "squat");
    mockParams.id = "w1";
    const share = jest
      .spyOn(Share, "share")
      .mockResolvedValue({ action: "sharedAction" } as never);
    render(
      <AdapterProvider adapters={adapters}>
        <HistoryWorkoutContainer />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.pages).not.toBeNull());
    const p = mockProbe.pages!;
    expect(p.title).toBe("Upper A");
    expect(p.onContinue).toBeUndefined();
    expect(p.model.volumeKg).toBe(950);
    expect(p.records.map((r) => r.exerciseId)).toEqual(["bench"]);
    // The "was" value from the workout's own response reaches the page.
    expect(p.records[0]!.previousValue).toBe(95);
    expect(p.rating).toBeNull();
    act(() => p.onShare("text"));
    expect(share).toHaveBeenCalledWith({ message: "text" });
    act(() => p.onClose());
    expect(mockBack).toHaveBeenCalled();
    act(() => p.onDetails());
    await waitFor(() => expect(mockProbe.details).not.toBeNull());
    expect(mockProbe.details!.recordsCount).toBe(1);
    act(() => mockProbe.details!.onBack());
    await waitFor(() => expect(mockProbe.pages).not.toBeNull());
    share.mockRestore();
  });

  it("stays open when the sync renames the workout (Inspector Brad #541)", async () => {
    const { storage, adapters } = makeAdapters();
    // The SQLite update hook wakes subscribers on a write; the in-memory
    // fake doesn't, so stand in for it here.
    const listeners = new Set<() => void>();
    const bus = new Proxy(storage, {
      get(target, prop, recv) {
        if (prop === "subscribe")
          return (_t: readonly string[], cb: () => void) => {
            listeners.add(cb);
            return () => listeners.delete(cb);
          };
        const v = Reflect.get(target, prop, recv);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const startedAt = "2026-10-26T07:10:00.000Z";
    storage.saveTrainingLogEntry(
      "user-1",
      finished("local-9", startedAt, { bench: [[95, 5]] }, { name: "Upper A" }),
    );
    respond(storage, "local-9", "bench");
    mockParams.id = "local-9";
    mockParams.at = startedAt;
    render(
      <AdapterProvider adapters={{ ...adapters, storage: bus }}>
        <HistoryWorkoutContainer />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.pages?.title).toBe("Upper A"));
    expect(mockProbe.pages!.records).toHaveLength(1);
    // The sync drain renames the workout and its record to the server id.
    // Clear the probe: only a fresh render of the carousel may refill it.
    mockProbe.pages = null;
    act(() => {
      storage.linkTrainingLogSessionId("local-9", "srv-9");
      listeners.forEach((cb) => cb());
    });
    expect(storage.getTrainingLogEntry("user-1", "local-9")).toBeNull();
    await waitFor(() => expect(mockProbe.pages).not.toBeNull());
    expect(mockProbe.pages!.title).toBe("Upper A");
    expect(mockProbe.pages!.records).toHaveLength(1);
  });

  it("keeps the last workout shown if it leaves the log entirely", async () => {
    const { storage, adapters } = makeAdapters();
    const listeners = new Set<() => void>();
    const bus = new Proxy(storage, {
      get(target, prop, recv) {
        if (prop === "subscribe")
          return (_t: readonly string[], cb: () => void) => {
            listeners.add(cb);
            return () => listeners.delete(cb);
          };
        const v = Reflect.get(target, prop, recv);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    storage.saveTrainingLogEntry(
      "user-1",
      finished(
        "w5",
        "2026-10-26T07:10:00.000Z",
        { bench: [[95, 5]] },
        {
          name: "Upper A",
        },
      ),
    );
    mockParams.id = "w5";
    mockParams.at = undefined;
    render(
      <AdapterProvider adapters={{ ...adapters, storage: bus }}>
        <HistoryWorkoutContainer />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.pages?.title).toBe("Upper A"));
    mockProbe.pages = null;
    act(() => {
      storage.clearAll();
      listeners.forEach((cb) => cb());
    });
    await waitFor(() => expect(mockProbe.pages?.title).toBe("Upper A"));
  });

  it("renders nothing for a workout the phone doesn't hold", async () => {
    const { adapters } = makeAdapters();
    mockParams.id = "missing";
    const r = render(
      <AdapterProvider adapters={adapters}>
        <HistoryWorkoutContainer />
      </AdapterProvider>,
    );
    await act(async () => {});
    expect(mockProbe.pages).toBeNull();
    expect(r.toJSON()).toBeNull();
  });
});

it("keeps a record's 'was' value from the workout's own response (Inspector Brad #541)", () => {
  expect(
    toSummaryRecord({
      exerciseId: "bench",
      exerciseName: "Bench",
      recordType: "1rm",
      newValue: 95,
      previousValue: 92.5,
      setId: "s1",
    }),
  ).toEqual({
    exerciseId: "bench",
    exerciseName: "Bench",
    recordType: "1rm",
    newValue: 95,
    previousValue: 92.5,
    setId: "s1",
  });
});
