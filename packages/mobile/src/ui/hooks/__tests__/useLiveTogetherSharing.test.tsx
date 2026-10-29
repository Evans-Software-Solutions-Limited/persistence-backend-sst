import { act, renderHook } from "@testing-library/react-native";
import {
  sessionTitle,
  useLiveTogetherSharing,
} from "../useLiveTogetherSharing";
import type {
  TogetherSharedPort,
  TogetherSharedSnapshot,
} from "@/domain/ports/togetherShared.port";
import type {
  TogetherLobbyPort,
  TogetherLobbySnapshot,
} from "@/domain/ports/togetherLobby.port";
import type {
  TogetherCloudPort,
  TogetherCloudState,
} from "@/domain/ports/togetherCloud.port";
import type { WorkoutSession } from "@/domain/models/session";

function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: T) => {
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}
const workout: WorkoutSession = {
  id: "w",
  userId: "me",
  workoutId: null,
  name: "Lower Body B",
  status: "in_progress",
  startedAt: "2026-10-27T09:00:00Z",
  completedAt: null,
  notes: null,
  exercises: [
    {
      id: "x",
      sessionId: "w",
      exerciseId: "squat",
      exerciseName: "Squat",
      sortOrder: 0,
      supersetGroup: null,
      isSubstituted: false,
      originalExerciseId: null,
      notes: null,
      sets: [],
    },
  ],
};
const storage = {
  getActiveSession: jest.fn(() => workout),
  getPreviousForTogether: jest.fn(() => [
    {
      exerciseId: "squat",
      setNumber: 1,
      reps: 8,
      weightKg: 60,
      recordedAt: "2026-10-20T09:00:00Z",
    },
  ]),
};

function nearby(phase: TogetherLobbySnapshot["phase"] = "joined") {
  const shared = store<TogetherSharedSnapshot>({
    progress: [],
    plan: null,
    planHash: null,
    athletePlans: {},
    profiles: { host: "Brad", t: "Tom" },
    athletes: [],
    previous: {},
    grants: [],
    closures: [],
    delegated: [],
    deliveries: [],
  });
  const sharedPort = {
    getSnapshot: shared.get,
    subscribe: shared.subscribe,
    setConsent: jest.fn(async () => {}),
    publishPrevious: jest.fn(async () => {}),
  } as unknown as TogetherSharedPort;
  const lobby = store({
    phase,
    role: "guest",
    sessionId: "s1",
    members: [
      { userId: "host", host: true },
      { userId: "me", host: false },
      { userId: "t", host: false },
    ],
    pending: [],
  } as unknown as TogetherLobbySnapshot);
  const port = {
    getSnapshot: lobby.get,
    subscribe: lobby.subscribe,
    shared: sharedPort,
  } as unknown as TogetherLobbyPort;
  return { port, lobby, shared, sharedPort };
}

it("names whose session it is", () => {
  expect(sessionTitle("me", "me", "Mia")).toBe("Your session");
  expect(sessionTitle("me", "host", "Brad")).toBe("Brad’s session");
  expect(sessionTitle("me", "host", null)).toBe("The host’s session");
});

it("reads a live Nearby session and writes to it, previous values included", async () => {
  const n = nearby();
  const { result } = renderHook(() =>
    useLiveTogetherSharing({ userId: "me", lobby: n.port, storage }),
  );
  expect(result.current?.title).toBe("Brad’s session");
  expect(result.current?.state.recipients.map((r) => r.name)).toEqual([
    "Brad",
    "Tom",
  ]);
  await act(async () =>
    result.current!.onChange({ recipient: "t", value: true }),
  );
  expect(n.sharedPort.setConsent).toHaveBeenCalledWith("t", {
    numbers: false,
    prev: true,
    logging: false,
  });
  expect(n.sharedPort.publishPrevious).toHaveBeenCalledWith(
    "t",
    [
      expect.objectContaining({
        exerciseId: "squat",
        recordedAt: Date.parse("2026-10-20T09:00:00Z"),
      }),
    ],
    Date.parse(workout.startedAt),
  );
  // The grant lands; the card follows the engine.
  act(() =>
    n.shared.set({
      ...n.shared.get(),
      grants: [
        {
          ownerId: "me",
          recipientId: "t",
          version: 1,
          consent: { numbers: false, prev: true, logging: false },
        },
      ],
    }),
  );
  expect(result.current?.state.previous).toBe(true);
  // Leaving ends it: the card goes.
  act(() =>
    n.shared.set({
      ...n.shared.get(),
      closures: [{ userId: "me", mode: "leave" }],
    } as TogetherSharedSnapshot),
  );
  expect(result.current).toBeNull();
});

it("publishes no previous values when no workout is open", async () => {
  storage.getActiveSession.mockReturnValueOnce(null as never);
  storage.getActiveSession.mockReturnValueOnce(null as never);
  const n = nearby();
  const { result } = renderHook(() =>
    useLiveTogetherSharing({ userId: "me", lobby: n.port, storage }),
  );
  await act(async () =>
    result.current!.onChange({ key: "previous", value: true }),
  );
  expect(n.sharedPort.setConsent).toHaveBeenCalled();
  expect(n.sharedPort.publishPrevious).not.toHaveBeenCalled();
});

it("is empty before a Nearby session is live, or without an account", () => {
  const n = nearby("selected");
  expect(
    renderHook(() =>
      useLiveTogetherSharing({ userId: "me", lobby: n.port, storage }),
    ).result.current,
  ).toBeNull();
  expect(
    renderHook(() =>
      useLiveTogetherSharing({ userId: null, lobby: nearby().port, storage }),
    ).result.current,
  ).toBeNull();
});

it("reads a live Online session and writes recipient lists", async () => {
  const cloud = store<TogetherCloudState>({
    phase: "active",
    requests: [],
    previous: {},
    pendingCount: 0,
    snapshot: {
      sessionId: "c1",
      sharingActive: true,
      hostId: "me",
      participants: [
        {
          userId: "me",
          status: "active",
          allowPartnerLogging: false,
          numbersConsent: { version: 0, recipientIds: [] },
          previousConsent: { version: 0, recipientIds: [] },
        },
        { userId: "v", displayName: "Mia", allowPartnerLogging: true },
        { userId: "w", displayName: null, allowPartnerLogging: false },
      ],
    } as never,
  });
  const port = {
    getSnapshot: cloud.get,
    subscribe: cloud.subscribe,
    numbersConsent: jest.fn(async () => {}),
    previousConsent: jest.fn(async () => {}),
    delegation: jest.fn(async () => {}),
  } as unknown as TogetherCloudPort;
  const { result } = renderHook(() =>
    useLiveTogetherSharing({ userId: "me", cloud: port, storage }),
  );
  expect(result.current?.title).toBe("Your session");
  expect(result.current?.state.recipients.map((r) => r.name)).toEqual([
    "Mia",
    "Athlete 3",
  ]);
  await act(async () =>
    result.current!.onChange({ key: "numbers", value: true }),
  );
  expect(port.numbersConsent).toHaveBeenCalledWith(["v", "w"]);
  await act(async () =>
    result.current!.onChange({ key: "previous", value: true }),
  );
  expect(port.previousConsent).toHaveBeenCalledWith(["v", "w"]);
  await act(async () =>
    result.current!.onChange({ key: "logging", value: true }),
  );
  expect(port.delegation).toHaveBeenCalledWith(true);
  // A guest sees the host's name; a session that stopped sharing has no card.
  act(() =>
    cloud.set({
      ...cloud.get(),
      snapshot: { ...cloud.get().snapshot!, hostId: "v" },
    }),
  );
  expect(result.current?.title).toBe("Mia’s session");
  // Once this athlete has finished their own workout the server refuses every
  // change, even while the session shares on for the others: no card.
  const training = cloud.get().snapshot!.participants;
  act(() =>
    cloud.set({
      ...cloud.get(),
      snapshot: {
        ...cloud.get().snapshot!,
        participants: [
          { ...training[0]!, status: "saved" },
          ...training.slice(1),
        ],
      },
    }),
  );
  expect(result.current).toBeNull();
  act(() =>
    cloud.set({
      ...cloud.get(),
      snapshot: { ...cloud.get().snapshot!, participants: training },
    }),
  );
  expect(result.current?.title).toBe("Mia’s session");
  act(() =>
    cloud.set({
      ...cloud.get(),
      snapshot: { ...cloud.get().snapshot!, sharingActive: false },
    }),
  );
  expect(result.current).toBeNull();
  act(() =>
    cloud.set({
      ...cloud.get(),
      snapshot: {
        ...cloud.get().snapshot!,
        sharingActive: true,
        participants: [],
      },
    }),
  );
  expect(result.current).toBeNull();
});
