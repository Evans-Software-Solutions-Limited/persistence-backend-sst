/**
 * SessionSummaryContainer tests — exercise the summary path against
 * an in-memory storage adapter. (M3.)
 *
 * Spec: specs/05-active-session/requirements.md STORY-006, STORY-007
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 8
 */

import { fireEvent, waitFor } from "@testing-library/react-native";
import React from "react";
import { Share } from "react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { NotificationsPort } from "@/domain/ports/notifications.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { SessionSummaryContainer } from "@/ui/containers/SessionSummaryContainer";
import { renderWithTheme } from "../../../../__tests__/test-utils";

// M2 learning #13: cascading-async container tests blow the 5s default
// on loaded CI workers. Match the existing 15s used by HomeContainer /
// DevExerciseCreatorContainer / ExerciseListContainer.

function makeAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
): Adapters {
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: "user-1",
    email: "u@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    signInWithEmail: jest.fn(),
    signUpWithEmail: jest.fn(),
    signInWithOAuth: jest.fn(),
    signOut: jest.fn(),
    getSession: jest.fn(async () => ok(session)),
    // Fire the auth-state callback synchronously at registration —
    // see SwapExercisePopover.test.tsx for the full rationale (CI
    // flake from deferred-via-setTimeout setState racing with test-
    // library polling).
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    resetPassword: jest.fn(),
    refreshSession: jest.fn(),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];

  const notifications: NotificationsPort = {
    requestPermissions: jest.fn(async () => ok("granted" as const)),
    getPermissionStatus: jest.fn(async () => "granted" as const),
    getDevicePushToken: jest.fn(async () => ok("device-token")),
    scheduleLocalNotification: jest.fn(async () => "notif-1"),
    cancelLocalNotification: jest.fn(async () => undefined),
    setBadgeCount: jest.fn(async () => undefined),
    addPushTokenListener: jest.fn(() => () => {}),
    addNotificationReceivedListener: jest.fn(() => () => {}),
    addNotificationResponseListener: jest.fn(() => () => {}),
    getLastNotificationResponse: jest.fn(async () => null),
  };

  return {
    api,
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications,
    netInfo: {} as Adapters["netInfo"],
  };
}

const seedActive = (storage: InMemoryStorageAdapter) => {
  storage.cacheActiveSession("user-1", {
    id: "local-1",
    userId: "user-1",
    workoutId: "wk-1",
    name: "Push Day",
    status: "in_progress",
    startedAt: "2026-05-05T10:00:00.000Z",
    completedAt: null,
    notes: null,
    exercises: [
      {
        id: "se-1",
        sessionId: "local-1",
        exerciseId: "ex-bench",
        exerciseName: "Bench Press",
        sortOrder: 0,
        supersetGroup: null,
        isSubstituted: false,
        originalExerciseId: null,
        notes: null,
        sets: [
          {
            id: "set-1",
            sessionExerciseId: "se-1",
            setNumber: 1,
            weightKg: 120,
            reps: 5,
            rpe: 9,
            durationSeconds: null,
            distanceMeters: null,
            isCompleted: true,
            completedAt: "2026-05-05T10:30:00.000Z",
          },
        ],
      },
    ],
  });
};

const mockRouterBack = jest.fn();
const mockRouterDismissAll = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({}) as Record<string, string>);
jest.mock("expo-router", () => {
  const React = jest.requireActual("react") as typeof import("react");
  return {
    __esModule: true,
    router: {
      back: (...args: unknown[]) => mockRouterBack(...args),
      dismissAll: (...args: unknown[]) => mockRouterDismissAll(...args),
      push: jest.fn(),
    },
    useLocalSearchParams: () => mockUseLocalSearchParams(),
    useFocusEffect: (cb: React.EffectCallback) => {
      React.useEffect(() => cb(), [cb]);
    },
  };
});

async function renderSummary(storage: InMemoryStorageAdapter) {
  const q = renderWithTheme(
    <AdapterProvider adapters={makeAdapters(new InMemoryApiAdapter(), storage)}>
      <SessionSummaryContainer />
    </AdapterProvider>,
  );
  // The pager sizes itself before it draws a page.
  fireEvent(await q.findByTestId("summary-pages"), "layout", {
    nativeEvent: { layout: { width: 400, height: 600 } },
  });
  return q;
}

describe("SessionSummaryContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("builds the pages from the finished session and the exercise library", async () => {
    const storage = new InMemoryStorageAdapter();
    seedActive(storage);
    // Cached exercises carry catalogue UUIDs; the reference list names them.
    storage.cacheReferenceList("muscle_groups", [
      { id: "uuid-chest", name: "Chest", displayName: "Chest" },
      { id: "uuid-triceps", name: "triceps", displayName: "Triceps" },
    ]);
    storage.cacheExercises([
      {
        id: "ex-bench",
        name: "Bench Press",
        description: null,
        instructions: null,
        category: "strength",
        difficulty: "intermediate",
        primaryMuscleGroups: ["uuid-chest" as never],
        secondaryMuscleGroups: ["uuid-triceps" as never],
        equipment: [],
      } as never,
    ]);
    const q = await renderSummary(storage);
    expect(q.getByText("600")).toBeTruthy();
    expect(q.getByText("Push Day · 5 May")).toBeTruthy();
    expect(
      q.getByLabelText("Muscles worked: chest 67%, triceps 33%"),
    ).toBeTruthy();
    expect(q.getByText("1×5")).toBeTruthy();
    // No server response yet: no records page, no month count.
    expect(q.queryByTestId("summary-page-records")).toBeNull();
    expect(q.queryByText(/this month/)).toBeNull();
  });

  it("hides Muscles worked when the exercise is not in the library", async () => {
    const storage = new InMemoryStorageAdapter();
    seedActive(storage);
    const q = await renderSummary(storage);
    expect(q.queryByTestId("summary-page-muscles")).toBeNull();
  });

  it("ignores a cached server response whose localSessionId doesn't match the current snapshot (Inspector Brad PR #62 regression)", async () => {
    // The sync worker's FIFO drain can briefly leave a prior session's
    // response in the slot. Without the id guard the summary would show
    // that session's records and month count for good.
    const storage = new InMemoryStorageAdapter();
    seedActive(storage);
    storage.cacheRecordResponse("user-1", {
      localSessionId: "local-PRIOR-SESSION",
      personalRecords: [
        {
          exerciseId: "ex-bench",
          exerciseName: "Bench Press",
          recordType: "1rm",
          newValue: 999,
          previousValue: 800,
          setId: "set-prior",
        },
      ],
      workoutsThisMonth: 99,
      cachedAt: "2026-05-12T00:00:00.000Z",
    });
    const q = await renderSummary(storage);
    expect(q.queryByTestId("summary-page-records")).toBeNull();
    expect(q.queryByText("99 workouts this month")).toBeNull();
  });

  it("clears the record-response cache on cacheActiveSession when starting a NEW session (belt-and-braces)", () => {
    // Companion to the container-side id guard: even if the guard
    // were bypassed somehow, the storage layer ensures the slot
    // can't carry stale data across a session boundary.
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();

    // Cache slot has Session A's response.
    storage.cacheRecordResponse("user-1", {
      localSessionId: "local-A",
      personalRecords: [],
      workoutsThisMonth: 5,
      cachedAt: "2026-05-12T00:00:00.000Z",
    });
    expect(storage.getRecordResponse("user-1")).not.toBeNull();

    // User starts Session B — cacheActiveSession should detect the
    // session-boundary and clear A's stale response.
    storage.cacheActiveSession("user-1", {
      id: "local-B",
      userId: "user-1",
      workoutId: null,
      name: "Quick Workout",
      status: "in_progress",
      startedAt: "2026-05-12T01:00:00.000Z",
      completedAt: null,
      notes: null,
      exercises: [],
    });
    expect(storage.getRecordResponse("user-1")).toBeNull();

    // Mid-session update of the SAME session id (B → B) must NOT
    // clear the cache — that would clobber the response right when
    // the sync worker has written it.
    storage.cacheRecordResponse("user-1", {
      localSessionId: "local-B",
      personalRecords: [],
      workoutsThisMonth: 6,
      cachedAt: "2026-05-12T01:00:01.000Z",
    });
    storage.cacheActiveSession("user-1", {
      id: "local-B",
      userId: "user-1",
      workoutId: null,
      name: "Quick Workout",
      status: "in_progress",
      startedAt: "2026-05-12T01:00:00.000Z",
      completedAt: null,
      notes: null,
      exercises: [],
    });
    expect(storage.getRecordResponse("user-1")?.localSessionId).toBe("local-B");
    // Reset the InMemory adapter spec separately — `api` unused here.
    void api;
  });

  it("adds the records page and the month count once the server response lands", async () => {
    const storage = new InMemoryStorageAdapter();
    seedActive(storage);
    const q = await renderSummary(storage);
    expect(q.queryByTestId("summary-page-records")).toBeNull();
    storage.cacheRecordResponse("user-1", {
      localSessionId: "local-1",
      personalRecords: [
        {
          exerciseId: "ex-bench",
          exerciseName: "Bench Press",
          recordType: "1rm",
          newValue: 137.4,
          previousValue: 120,
          setId: "set-1",
        },
      ],
      workoutsThisMonth: 12,
      cachedAt: "2026-05-05T10:30:01.000Z",
    });
    expect(await q.findByText("12 workouts this month")).toBeTruthy();
    expect(q.getByText("New personal record")).toBeTruthy();
    expect(q.getByText("137.4")).toBeTruthy();
    expect(q.getByText("1 rep max · was 120 kg")).toBeTruthy();
    // Workout details marks the record set.
    fireEvent.press(q.getByTestId("summary-details"));
    expect(await q.findByTestId("workout-details-screen")).toBeTruthy();
    expect(q.getByText("120 kg ★")).toBeTruthy();
  });

  it("shows the effort and who trained together from the rating screen's params", async () => {
    mockUseLocalSearchParams.mockReturnValue({
      rating: "8",
      together: JSON.stringify({
        self: "Mia",
        names: ["Brad", "Tom"],
        connection: "Nearby",
      }),
    });
    const storage = new InMemoryStorageAdapter();
    seedActive(storage);
    const q = await renderSummary(storage);
    expect(q.getByText("Effort 8/10 · Hard")).toBeTruthy();
    expect(q.getByText("With Brad and Tom")).toBeTruthy();
    fireEvent.press(q.getByTestId("summary-details"));
    expect(await q.findByText(/Hard 8\/10 · with Brad, Tom/)).toBeTruthy();
    fireEvent.press(q.getByTestId("workout-details-back"));
    expect(await q.findByTestId("session-summary-screen")).toBeTruthy();
  });

  it.each([
    [{ rating: "11", together: "{not json" }],
    [
      {
        rating: "x",
        together: JSON.stringify({
          self: "Mia",
          names: [1],
          connection: "Nearby",
        }),
      },
    ],
    [
      {
        together: JSON.stringify({
          self: "Mia",
          names: ["Brad"],
          connection: "Radio",
        }),
      },
    ],
  ])("ignores malformed params %#", async (params) => {
    mockUseLocalSearchParams.mockReturnValue(params as Record<string, string>);
    const storage = new InMemoryStorageAdapter();
    seedActive(storage);
    const q = await renderSummary(storage);
    expect(q.queryByTestId("summary-effort")).toBeNull();
    expect(q.queryByTestId("summary-page-together")).toBeNull();
  });

  it.each(["summary-continue", "session-summary-close"])(
    "%s clears the local row and dismisses the modal stack (the rating screen already recorded it)",
    async (button) => {
      const storage = new InMemoryStorageAdapter();
      storage.cacheActiveSession("user-1", {
        id: "local-1",
        userId: "user-1",
        workoutId: "wk-1",
        name: "Push Day",
        status: "completed",
        startedAt: "2026-05-05T10:00:00.000Z",
        completedAt: "2026-05-05T10:30:00.000Z",
        notes: null,
        exercises: [],
      });
      const q = await renderSummary(storage);
      fireEvent.press(q.getByTestId(button));
      expect(storage.getPendingMutations()).toHaveLength(0);
      expect(storage.getLatestSession("user-1")).toBeNull();
      expect(mockRouterDismissAll).toHaveBeenCalledTimes(1);
    },
  );

  it("shares the page and the workout details through the system sheet", async () => {
    const share = jest
      .spyOn(Share, "share")
      .mockResolvedValue({ action: "sharedAction" });
    const storage = new InMemoryStorageAdapter();
    seedActive(storage);
    const q = await renderSummary(storage);
    fireEvent.press(q.getByTestId("session-summary-share"));
    expect(share).toHaveBeenLastCalledWith({
      message: expect.stringContaining("Workout complete: Push Day"),
    });
    fireEvent.press(q.getByTestId("summary-details"));
    share.mockRejectedValueOnce(new Error("dismissed"));
    fireEvent.press(await q.findByTestId("workout-details-share"));
    expect(share).toHaveBeenLastCalledWith({
      message: expect.stringContaining("Bench Press: 120×5"),
    });
  });

  it("renders nothing when no active session exists (race guard)", () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();

    const { queryByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(api, storage)}>
        <SessionSummaryContainer />
      </AdapterProvider>,
    );

    expect(queryByTestId("session-summary-screen")).toBeNull();
  });
});

it("hydrates Together stats from its confirmed own history instead of waiting for a solo record", async () => {
  const storage = new InMemoryStorageAdapter();
  seedActive(storage);
  const completed = {
    ...storage.getActiveSession("user-1")!,
    status: "completed" as const,
    completedAt: "2026-05-05T10:30:00Z",
    together: { sessionId: "shared", executionId: "own", historyId: "history" },
  };
  storage.cacheActiveSession("user-1", completed);
  const api = new InMemoryApiAdapter();
  const read = jest.spyOn(api, "getSession").mockResolvedValue(
    ok({
      id: "history",
      userId: "user-1",
      status: "completed",
      personalRecords: [],
      workoutsThisMonth: 3,
    } as never),
  );
  const r = renderWithTheme(
    <AdapterProvider adapters={makeAdapters(api, storage)}>
      <SessionSummaryContainer />
    </AdapterProvider>,
  );
  await waitFor(() =>
    expect(read).toHaveBeenCalledWith("history", { summary: true }),
  );
  await waitFor(() =>
    expect(storage.getRecordResponse("user-1")).toMatchObject({
      localSessionId: "local-1",
      workoutsThisMonth: 3,
      personalRecords: [],
    }),
  );
  expect(storage.getPendingMutations()).toHaveLength(0);
  r.unmount();
});
