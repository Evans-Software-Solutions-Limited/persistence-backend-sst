/**
 * SessionSummaryContainer tests — exercise the summary path against
 * an in-memory storage adapter. (M3.)
 *
 * Spec: specs/05-active-session/requirements.md STORY-006, STORY-007
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 8
 */

import { fireEvent } from "@testing-library/react-native";
import React from "react";
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
jest.setTimeout(15_000);

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
  };

  return {
    api,
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications,
    payments: {} as Adapters["payments"],
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

describe("SessionSummaryContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders the legacy 3-stat strip (Workouts Completed / Records Hit / Total Volume)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    seedActive(storage);

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(api, storage)}>
        <SessionSummaryContainer />
      </AdapterProvider>,
    );

    expect(await findByTestId("summary-stat-workouts-this-month")).toBeTruthy();
    expect(await findByTestId("summary-stat-records-hit")).toBeTruthy();
    expect(await findByTestId("summary-stat-total-volume")).toBeTruthy();
  });

  it("predicts a PR locally when the session beats the cached previous best (pre-server, no previousValue arrow)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    seedActive(storage);
    storage.cachePersonalRecords("user-1", [
      {
        id: "pr-prev",
        userId: "user-1",
        exerciseId: "ex-bench",
        exerciseName: "Bench Press",
        recordType: "1rm",
        value: 100,
        achievedAt: "2026-04-01T00:00:00.000Z",
        sessionId: "old",
        setId: null,
      },
    ]);

    const { findByTestId, queryByText } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(api, storage)}>
        <SessionSummaryContainer />
      </AdapterProvider>,
    );

    // Local prediction surfaces the section + card.
    expect(await findByTestId("summary-pr-section")).toBeTruthy();
    expect(await findByTestId("summary-pr-ex-bench-1rm")).toBeTruthy();
    // Local prediction has previousValue=null → no arrow rendered.
    expect(queryByText("→")).toBeNull();
  });

  it("ignores a cached server response whose localSessionId doesn't match the current snapshot (Inspector Brad PR #62 regression)", async () => {
    // The high-severity stale-cache leak: sync worker FIFO drain
    // can transiently write a prior session's response into the
    // slot before the current session's response overwrites it. If
    // the container poll fires in that window without the id guard,
    // the current Summary screen permanently renders the prior
    // session's PRs + workoutsThisMonth.
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    seedActive(storage); // Active session id = "local-1"

    // Cache slot pre-populated with a DIFFERENT session's response —
    // simulates the transient FIFO-drain window where session A's
    // response landed before session B's.
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

    const { findByTestId, queryByText } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(api, storage)}>
        <SessionSummaryContainer />
      </AdapterProvider>,
    );

    await findByTestId("session-summary-screen");
    // The prior session's payload must NOT surface. No arrow (id
    // guard rejected the cache hit), no "99 total workouts" in the
    // subtitle, no "999.0 kg" PR.
    expect(queryByText("→")).toBeNull();
    expect(queryByText("999.0 kg")).toBeNull();
    expect(
      queryByText(
        "You've completed 99 workouts this month. Keep the momentum going!",
      ),
    ).toBeNull();
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

  it("swaps to the server PR shape (with previousValue + arrow) once the sync worker writes the cache slot", async () => {
    // The cache-and-subscribe contract end-to-end: container mounts
    // with local prediction (no arrow), poll picks up the cached
    // server response, re-renders with the legacy before→after arrow
    // and the real workoutsThisMonth in both the subtitle + the
    // stat tile.
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    seedActive(storage);

    const { findByTestId, queryByText, findByText } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(api, storage)}>
        <SessionSummaryContainer />
      </AdapterProvider>,
    );

    // Pre-server: em-dash on the Workouts this month tile, no arrow
    // on PR rows. Wait for the mount + first poll tick to settle.
    expect(await findByTestId("session-summary-screen")).toBeTruthy();
    expect(queryByText("→")).toBeNull();

    // Sync worker fires (simulated): cache slot written with the
    // augmented response.
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

    // Poll picks up the cache slot — subtitle gets the count, tile
    // gets 12, PR card now shows the arrow.
    expect(
      await findByText(
        "You've completed 12 workouts this month. Keep the momentum going!",
      ),
    ).toBeTruthy();
    expect(await findByText("→")).toBeTruthy();
    expect(await findByText("120.0 kg")).toBeTruthy();
    expect(await findByText("137.4 kg")).toBeTruthy();
  });

  it("Continue tap clears the local row and dismisses the modal stack (the rating screen already fired completeSessionCommand)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    // Seed a finalized row — by the time the user lands on the
    // summary screen, /session/rate has already flipped the row to
    // status=completed and queued the bulk-record flush.
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

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(api, storage)}>
        <SessionSummaryContainer />
      </AdapterProvider>,
    );

    fireEvent.press(await findByTestId("summary-save-button"));
    // No NEW recordSession enqueue — the rating screen already did
    // that; summary just retires the local row.
    expect(storage.getPendingMutations()).toHaveLength(0);
    expect(storage.getLatestSession("user-1")).toBeNull();
    expect(mockRouterDismissAll).toHaveBeenCalledTimes(1);
  });

  it("save-only screen has no Discard button (legacy parity: discard is an Alert on the active screen)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    seedActive(storage);

    const { queryByTestId, findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(api, storage)}>
        <SessionSummaryContainer />
      </AdapterProvider>,
    );

    expect(await findByTestId("summary-save-button")).toBeTruthy();
    // No discard / keep-logging variants — the entire discard flow
    // lives in the ActiveSession Alert.alert per legacy.
    expect(queryByTestId("summary-discard-button")).toBeNull();
    expect(queryByTestId("summary-keep-button")).toBeNull();
    expect(queryByTestId("summary-confirm-discard-button")).toBeNull();
    expect(queryByTestId("summary-discard-warning")).toBeNull();
  });

  it("Close button clears the local row and dismisses the modal stack", async () => {
    const api = new InMemoryApiAdapter();
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

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(api, storage)}>
        <SessionSummaryContainer />
      </AdapterProvider>,
    );

    fireEvent.press(await findByTestId("session-summary-close"));
    expect(storage.getLatestSession("user-1")).toBeNull();
    expect(mockRouterDismissAll).toHaveBeenCalledTimes(1);
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
