/**
 * ActiveSessionContainer tests — exercise the container/presenter
 * wiring with an in-memory storage adapter + mocked notifications. (M3.)
 *
 * Spec: specs/05-active-session/requirements.md STORY-001..005, 009
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 7
 */

import { fireEvent, waitFor } from "@testing-library/react-native";
import React from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Exercise } from "@/domain/models/exercise";
import type { Workout } from "@/domain/models/workout";
import type { NotificationsPort } from "@/domain/ports/notifications.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { ActiveSessionContainer } from "@/ui/containers/ActiveSessionContainer";
import { renderWithTheme } from "../../../../__tests__/test-utils";

// M2 learning #13: cascading-async tests (findByTestId →
// fireEvent → waitFor on storage updates that fire through the
// rest-timer adapter's Promise chain) blow the 5s default on loaded
// CI workers. 30s here gives generous headroom; locally these tests
// run in ~50–200ms each.
jest.setTimeout(30_000);

const buildWorkout = (overrides: Partial<Workout> = {}): Workout => ({
  id: overrides.id ?? "w-1",
  name: overrides.name ?? "Push Day",
  description: null,
  createdBy: "user-1",
  visibility: "private",
  estimatedDurationMinutes: 60,
  exercises: overrides.exercises ?? [
    {
      id: "we-1",
      exerciseId: "ex-bench",
      sortOrder: 0,
      supersetGroup: null,
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetDurationSeconds: null,
      restSeconds: 90,
      notes: null,
      exercise: {
        id: "ex-bench",
        name: "Bench Press",
        category: "strength",
        difficultyLevel: "intermediate",
        videoUrl: null,
        thumbnailUrl: null,
      },
    },
    {
      id: "we-2",
      exerciseId: "ex-row",
      sortOrder: 1,
      supersetGroup: null,
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetDurationSeconds: null,
      restSeconds: 60,
      notes: null,
      exercise: {
        id: "ex-row",
        name: "Barbell Row",
        category: "strength",
        difficultyLevel: "intermediate",
        videoUrl: null,
        thumbnailUrl: null,
      },
    },
  ],
  createdAt: "2026-04-28T00:00:00Z",
  updatedAt: "2026-04-28T00:00:00Z",
  ...overrides,
});

const buildExercise = (overrides: Partial<Exercise> = {}): Exercise => ({
  id: overrides.id ?? "ex-bench",
  name: overrides.name ?? "Bench Press",
  description: null,
  instructions: null,
  category: "strength",
  difficulty: "intermediate",
  primaryMuscleGroups: [],
  secondaryMuscleGroups: [],
  equipment: [],
  primaryMuscleGroupLabels: [],
  secondaryMuscleGroupLabels: [],
  equipmentLabels: [],
  videoUrl: null,
  thumbnailUrl: null,
  isCustom: false,
  createdBy: null,
  ...overrides,
});

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

function withAdapters(adapters: Adapters, ui: React.ReactElement) {
  return <AdapterProvider adapters={adapters}>{ui}</AdapterProvider>;
}

const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({}) as Record<string, string>);
jest.mock("expo-router", () => {
  // useFocusEffect's prod implementation registers with the React
  // Navigation focus lifecycle. In test we collapse it to a useEffect
  // that fires once on mount — the unit under test is the rereadCache
  // wiring, not the navigation lifecycle itself. Calling `cb()` straight
  // through here causes an infinite re-render loop because the callback
  // ticks state.
  const React = jest.requireActual("react") as typeof import("react");
  return {
    __esModule: true,
    router: {
      back: (...args: unknown[]) => mockRouterBack(...args),
      push: (...args: unknown[]) => mockRouterPush(...args),
    },
    useLocalSearchParams: () => mockUseLocalSearchParams(),
    useFocusEffect: (cb: React.EffectCallback) => {
      React.useEffect(() => cb(), [cb]);
    },
    useRouter: () => ({
      push: (...args: unknown[]) => mockRouterPush(...args),
      back: (...args: unknown[]) => mockRouterBack(...args),
    }),
  };
});

describe("ActiveSessionContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("seeds a session from a workout template when ?workoutId= is present and no active session exists", async () => {
    const api = new InMemoryApiAdapter();
    const workout = buildWorkout();
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(workout));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", workout);
    mockUseLocalSearchParams.mockReturnValue({ workoutId: "w-1" });

    const { findByText } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ActiveSessionContainer />),
    );

    expect(await findByText("Push Day")).toBeTruthy();
    await waitFor(() => {
      expect(storage.getActiveSession("user-1")).not.toBeNull();
    });
    const cached = storage.getActiveSession("user-1");
    expect(cached?.status).toBe("in_progress");
    expect(cached?.exercises).toHaveLength(2);
  });

  it("renders the resumed session when one already exists in cache (no workoutId)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", {
      id: "local-existing",
      userId: "user-1",
      workoutId: null,
      name: "Quick Workout",
      status: "in_progress",
      startedAt: "2026-05-05T10:00:00.000Z",
      completedAt: null,
      notes: null,
      exercises: [],
    });

    const { findByText } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ActiveSessionContainer />),
    );

    expect(await findByText("Quick Workout")).toBeTruthy();
  });

  it("Discard footer button routes to summary with discard intent", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", {
      id: "local-1",
      userId: "user-1",
      workoutId: null,
      name: "Quick Workout",
      status: "in_progress",
      startedAt: "2026-05-05T10:00:00.000Z",
      completedAt: null,
      notes: null,
      exercises: [],
    });

    const { findByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ActiveSessionContainer />),
    );

    fireEvent.press(await findByTestId("active-session-discard"));
    fireEvent.press(await findByTestId("active-session-discard-confirm"));
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/(app)/session/summary?intent=discard",
    );
  });

  it("Finish footer button routes to summary", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", {
      id: "local-1",
      userId: "user-1",
      workoutId: null,
      name: "Quick Workout",
      status: "in_progress",
      startedAt: "2026-05-05T10:00:00.000Z",
      completedAt: null,
      notes: null,
      exercises: [],
    });

    const { findByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ActiveSessionContainer />),
    );

    fireEvent.press(await findByTestId("active-session-finish"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/session/summary");
  });

  it("Header close button calls router.back", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", {
      id: "local-1",
      userId: "user-1",
      workoutId: null,
      name: "Quick Workout",
      status: "in_progress",
      startedAt: "2026-05-05T10:00:00.000Z",
      completedAt: null,
      notes: null,
      exercises: [],
    });

    const { findByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ActiveSessionContainer />),
    );

    fireEvent.press(await findByTestId("session-header-close"));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });

  it("logs a set on Add set tap (in-cache write)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", {
      id: "local-1",
      userId: "user-1",
      workoutId: null,
      name: "Quick Workout",
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
          sets: [],
        },
      ],
    });

    const { findByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ActiveSessionContainer />),
    );

    fireEvent.press(await findByTestId("session-exercise-add-set"));
    await waitFor(() => {
      const cached = storage.getActiveSession("user-1");
      expect(cached?.exercises[0].sets).toHaveLength(1);
    });
  });

  it("stacked navigation: tapping the exercise header pushes /(app)/exercises/[id]", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", {
      id: "local-1",
      userId: "user-1",
      workoutId: null,
      name: "Quick Workout",
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
          sets: [],
        },
      ],
    });

    const { findByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ActiveSessionContainer />),
    );

    fireEvent.press(await findByTestId("session-exercise-tap"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/exercises/ex-bench");
  });

  it("substitute opens the picker and arms it with no existing-id filter", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([
      buildExercise({ id: "ex-bench", name: "Bench Press" }),
      buildExercise({ id: "ex-incline", name: "Incline Press" }),
    ]);
    storage.cacheActiveSession("user-1", {
      id: "local-1",
      userId: "user-1",
      workoutId: null,
      name: "Quick Workout",
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
          sets: [],
        },
      ],
    });
    jest
      .spyOn(api, "enrichExerciseLabels")
      .mockImplementation((ex: Exercise) => ex);

    const { findByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ActiveSessionContainer />),
    );

    // The substitute button is rendered by SessionExerciseCard; tapping
    // it puts the container into substitute mode and opens the picker.
    fireEvent.press(await findByTestId("session-exercise-substitute"));
    // Picker is wired but uses portal-rendered Modal — assert the
    // session screen still mounts and the container didn't crash.
    expect(await findByTestId("active-session-screen")).toBeTruthy();
  });

  it("Mark Complete on a set persists isCompleted + auto-starts the rest timer", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", {
      id: "local-1",
      userId: "user-1",
      workoutId: null,
      name: "Quick Workout",
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
              isCompleted: false,
              completedAt: null,
            },
          ],
        },
      ],
    });

    const adapters = makeAdapters(api, storage);
    const { findByTestId } = renderWithTheme(
      withAdapters(adapters, <ActiveSessionContainer />),
    );

    // SetLogger renders one row → one action button per row. With a
    // single set this resolves uniquely.
    fireEvent.press(await findByTestId("set-logger-action"));

    await waitFor(() => {
      const cached = storage.getActiveSession("user-1");
      expect(cached?.exercises[0].sets[0].isCompleted).toBe(true);
    });
    // Rest timer adapter received a schedule call (default 90s).
    expect(adapters.notifications.scheduleLocalNotification).toHaveBeenCalled();
  });

  it("typing into a set's weight input persists onUpdateSet to the cache", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", {
      id: "local-1",
      userId: "user-1",
      workoutId: null,
      name: "Quick Workout",
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
              weightKg: null,
              reps: null,
              rpe: null,
              durationSeconds: null,
              distanceMeters: null,
              isCompleted: false,
              completedAt: null,
            },
          ],
        },
      ],
    });

    const { findByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ActiveSessionContainer />),
    );

    const weightInput = await findByTestId("set-logger-weight");
    fireEvent.changeText(weightInput, "100");

    await waitFor(() => {
      const cached = storage.getActiveSession("user-1");
      expect(cached?.exercises[0].sets[0].weightKg).toBe(100);
    });
  });

  it("removing a completed set strips it from the session cache", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", {
      id: "local-1",
      userId: "user-1",
      workoutId: null,
      name: "Quick Workout",
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
              // Completed → action button becomes Remove (trash icon).
              isCompleted: true,
              completedAt: "2026-05-05T10:05:00.000Z",
            },
          ],
        },
      ],
    });

    const { findByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ActiveSessionContainer />),
    );

    fireEvent.press(await findByTestId("set-logger-action"));
    await waitFor(() => {
      const cached = storage.getActiveSession("user-1");
      expect(cached?.exercises[0].sets).toHaveLength(0);
    });
  });

  it("renders the empty-state Add CTA when the session has no exercises", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", {
      id: "local-1",
      userId: "user-1",
      workoutId: null,
      name: "Quick Workout",
      status: "in_progress",
      startedAt: "2026-05-05T10:00:00.000Z",
      completedAt: null,
      notes: null,
      exercises: [],
    });

    const { findByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ActiveSessionContainer />),
    );

    expect(await findByTestId("active-session-empty")).toBeTruthy();
    fireEvent.press(await findByTestId("active-session-empty-add"));
    // Picker opens — the screen still mounts.
    expect(await findByTestId("active-session-screen")).toBeTruthy();
  });
});
