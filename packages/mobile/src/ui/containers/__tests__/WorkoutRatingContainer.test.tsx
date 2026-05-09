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
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      setTimeout(() => cb(session), 0);
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

    await waitFor(() => {
      expect(storage.getPendingMutations()).toHaveLength(1);
    });
    const queued = storage.getPendingMutations()[0];
    expect(queued.endpoint).toBe("/sessions/record");
    const payload = JSON.parse(queued.payload);
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
      expect(storage.getPendingMutations()).toHaveLength(1);
    });
    const payload = JSON.parse(storage.getPendingMutations()[0].payload);
    expect(payload.sessionRating).toBe(3);
    expect(payload.userNotes).toBeNull();
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
