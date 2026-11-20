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
import {
  record,
  session as finished,
} from "@/domain/services/__tests__/youFixtures";
import {
  HistoryWorkoutContainer,
  toSummaryRecord,
} from "../HistoryWorkoutContainer";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));
const mockBack = jest.fn();
const mockParams: { id?: string } = {};
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

describe("HistoryWorkoutContainer (Y2b)", () => {
  beforeEach(() => {
    mockProbe.pages = null;
    mockProbe.details = null;
    mockBack.mockClear();
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
    storage.cachePersonalRecords("user-1", [
      record("bench", "2026-10-26T07:30:00.000Z", {
        sessionId: "w1",
        exerciseName: "Bench",
      }),
      record("squat", "2026-10-01T07:30:00.000Z", { sessionId: "other" }),
    ]);
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

it("maps a cached record without a 'was' value", () => {
  expect(
    toSummaryRecord(
      record("bench", "x", { exerciseName: "Bench", value: 95, setId: null }),
    ),
  ).toEqual({
    exerciseId: "bench",
    exerciseName: "Bench",
    recordType: "1rm",
    newValue: 95,
    previousValue: null,
    setId: undefined,
  });
});
