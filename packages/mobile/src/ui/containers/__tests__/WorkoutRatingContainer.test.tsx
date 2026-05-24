import { fireEvent, waitFor } from "@testing-library/react-native";
import React from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { WorkoutRatingContainer } from "@/ui/containers/WorkoutRatingContainer";
import { renderWithTheme } from "../../../../__tests__/test-utils";

jest.setTimeout(15_000);

function makeAdapters(storage: InMemoryStorageAdapter): Adapters {
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
  return {
    api: new InMemoryApiAdapter(),
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
    netInfo: {} as Adapters["netInfo"],
  };
}

const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: {
    back: (...args: unknown[]) => mockRouterBack(...args),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
  },
}));

// Submit triggers an inline `processSyncQueue` drain (the
// `useSyncWorker` hook only fires on mount + AppState→active, so
// without this kick the bulk-record POST sits in the queue forever
// while the user is on the Summary screen — bug Brad caught on
// device review of PR #62). Stub global fetch so the drain has
// deterministic behaviour: we mock a successful /sessions/record
// response so the entry transitions to "completed" cleanly.
const mockFetch = jest.fn();
(globalThis as Record<string, unknown>).fetch = mockFetch;

const seed = (storage: InMemoryStorageAdapter) => {
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
            weightKg: 80,
            reps: 8,
            rpe: null,
            durationSeconds: null,
            distanceMeters: null,
            isCompleted: true,
            completedAt: "2026-05-05T10:05:00.000Z",
          },
        ],
      },
    ],
  });
};

describe("WorkoutRatingContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    // Default to a successful /sessions/record response so the
    // inline drain marks the queue entry completed. Individual tests
    // that need different behaviour override this.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          id: "server-1",
          personalRecords: [],
          workoutsThisMonth: 1,
        },
      }),
    });
  });

  it("renders the rating screen when an in-progress session exists", async () => {
    const storage = new InMemoryStorageAdapter();
    seed(storage);

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage)}>
        <WorkoutRatingContainer />
      </AdapterProvider>,
    );

    expect(await findByTestId("workout-rating-screen")).toBeTruthy();
  });

  it("Submit fires completeSessionCommand with the rating + notes and replaces with summary", async () => {
    const storage = new InMemoryStorageAdapter();
    seed(storage);

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage)}>
        <WorkoutRatingContainer />
      </AdapterProvider>,
    );

    fireEvent.press(await findByTestId("workout-rating-7"));
    fireEvent.changeText(
      await findByTestId("workout-rating-notes"),
      "Felt strong on bench",
    );
    fireEvent.press(await findByTestId("workout-rating-submit"));

    // Inline drain fires after Submit; assert the POST went out with
    // the right payload. (Pre-fix, this would have asserted the
    // queue entry shape via `getPendingMutations`; post-fix, the
    // drain consumes the entry and the POST itself is the
    // observable signal.)
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/sessions/record"),
        expect.objectContaining({ method: "POST" }),
      );
    });
    const [, init] = mockFetch.mock.calls[0]!;
    const payload = JSON.parse((init as { body: string }).body);
    expect(payload.status).toBe("completed");
    expect(payload.sessionRating).toBe(7);
    expect(payload.difficultyRanking).toBe(7);
    expect(payload.userNotes).toBe("Felt strong on bench");
    // Replace, not push — so the back stack doesn't accumulate
    // /rate → /summary on subsequent finishes.
    expect(mockRouterReplace).toHaveBeenCalledWith("/(app)/session/summary");
  });

  it("Submit with empty notes sends userNotes=null", async () => {
    const storage = new InMemoryStorageAdapter();
    seed(storage);

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage)}>
        <WorkoutRatingContainer />
      </AdapterProvider>,
    );

    fireEvent.press(await findByTestId("workout-rating-3"));
    fireEvent.press(await findByTestId("workout-rating-submit"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/sessions/record"),
        expect.objectContaining({ method: "POST" }),
      );
    });
    const [, init] = mockFetch.mock.calls[0]!;
    const payload = JSON.parse((init as { body: string }).body);
    expect(payload.sessionRating).toBe(3);
    expect(payload.userNotes).toBeNull();
  });

  it("Submit kicks off an inline sync drain so /sessions/record lands before the Summary screen polls (Brad on-device regression)", async () => {
    // Brad caught this on PR #62 device review: the Workouts Completed
    // tile + subtitle count stayed on the em-dash placeholder
    // because `useSyncWorker` only fires on mount / AppState → active.
    // After Submit, the bulk-record POST was queued but never sent
    // until the user backgrounded + foregrounded the app. Fix: kick
    // an inline drain right after `completeSessionCommand` so the
    // Summary container's 500ms cache poll catches the augmented
    // response within one tick.
    const storage = new InMemoryStorageAdapter();
    seed(storage);

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage)}>
        <WorkoutRatingContainer />
      </AdapterProvider>,
    );

    fireEvent.press(await findByTestId("workout-rating-5"));
    fireEvent.press(await findByTestId("workout-rating-submit"));

    // Pre-fix this would have failed: fetch was NEVER called from
    // the rating screen — only on the next AppState-active event.
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/sessions/record"),
      expect.objectContaining({ method: "POST" }),
    );

    // End-to-end signal: after the drain completes, the cache slot
    // carries the server response so the Summary screen can render
    // the real `workoutsThisMonth` value instead of em-dash.
    await waitFor(() => {
      expect(storage.getRecordResponse("user-1")).not.toBeNull();
    });
    expect(storage.getRecordResponse("user-1")?.workoutsThisMonth).toBe(1);
  });

  it("Submit doesn't block on the drain — router.replace fires even if the network is unreachable", async () => {
    // Offline-first invariant: tapping Submit must navigate
    // immediately. If the network is down or the server is
    // unreachable, the queue entry stays pending and the Summary
    // screen falls back to local prediction — but the user is NOT
    // held on a spinner.
    const storage = new InMemoryStorageAdapter();
    seed(storage);
    mockFetch.mockRejectedValue(new Error("network down"));

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage)}>
        <WorkoutRatingContainer />
      </AdapterProvider>,
    );

    fireEvent.press(await findByTestId("workout-rating-5"));
    fireEvent.press(await findByTestId("workout-rating-submit"));

    // Routing must happen even though the fetch failed.
    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith("/(app)/session/summary");
    });
    // Entry stays in pendingMutations for the next drain attempt.
    expect(
      storage
        .getPendingMutations()
        .some((e) => e.endpoint === "/sessions/record"),
    ).toBe(true);
  });

  it("Back button calls router.back", async () => {
    const storage = new InMemoryStorageAdapter();
    seed(storage);

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage)}>
        <WorkoutRatingContainer />
      </AdapterProvider>,
    );

    fireEvent.press(await findByTestId("workout-rating-back"));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when no active session exists (race guard)", () => {
    const storage = new InMemoryStorageAdapter();
    const { queryByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage)}>
        <WorkoutRatingContainer />
      </AdapterProvider>,
    );
    expect(queryByTestId("workout-rating-screen")).toBeNull();
  });
});
