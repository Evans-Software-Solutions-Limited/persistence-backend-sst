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
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      setTimeout(() => cb(session), 0);
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

  it("renders summary stats from the active session", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    seedActive(storage);

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(api, storage)}>
        <SessionSummaryContainer />
      </AdapterProvider>,
    );

    expect(await findByTestId("summary-stat-duration")).toBeTruthy();
    expect(await findByTestId("summary-stat-volume")).toBeTruthy();
    expect(await findByTestId("summary-stat-exercises")).toBeTruthy();
  });

  it("predicts a PR when the session beats the cached previous best", async () => {
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

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(api, storage)}>
        <SessionSummaryContainer />
      </AdapterProvider>,
    );

    expect(await findByTestId("summary-pr-section")).toBeTruthy();
    expect(await findByTestId("summary-pr-ex-bench")).toBeTruthy();
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
