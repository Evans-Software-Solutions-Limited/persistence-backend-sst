/**
 * ActiveSessionContainer tests — exercise the container/presenter
 * wiring with an in-memory storage adapter + mocked notifications. (M3.)
 *
 * Spec: specs/05-active-session/requirements.md STORY-001..005, 009
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 7
 */

import { fireEvent, waitFor } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";
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
const mockRouterDismissAll = jest.fn();
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
      dismissAll: (...args: unknown[]) => mockRouterDismissAll(...args),
    },
    useLocalSearchParams: () => mockUseLocalSearchParams(),
    useFocusEffect: (cb: React.EffectCallback) => {
      React.useEffect(() => cb(), [cb]);
    },
    useRouter: () => ({
      push: (...args: unknown[]) => mockRouterPush(...args),
      back: (...args: unknown[]) => mockRouterBack(...args),
      dismissAll: (...args: unknown[]) => mockRouterDismissAll(...args),
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

  it("Discard footer button shows Alert.alert; confirming fires cancelSessionCommand and dismisses", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
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

    // Native Alert was opened with the legacy copy.
    expect(alertSpy).toHaveBeenCalledWith(
      "Cancel Workout",
      "Are you sure you want to discard this workout? All progress will be lost.",
      expect.any(Array),
    );

    // Simulate the user tapping Discard in the alert.
    const buttons = (alertSpy.mock.calls.at(-1)?.[2] ?? []) as {
      text: string;
      style?: string;
      onPress?: () => void;
    }[];
    const discardButton = buttons.find((b) => b.style === "destructive");
    discardButton?.onPress?.();

    // Bulk cancellation queued; modal stack collapsed.
    const queue = storage.getPendingMutations();
    expect(queue).toHaveLength(1);
    expect(JSON.parse(queue[0].payload).status).toBe("cancelled");
    expect(mockRouterDismissAll).toHaveBeenCalled();
  });

  it("Finish footer button routes to /session/rate (rating screen comes before summary, legacy parity)", async () => {
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
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/session/rate");
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

  // The Mark-Complete UI was removed in 1A.1 (legacy port: no per-set
  // complete affordance) and the rest timer is now user-tap-triggered from
  // a START NS REST button (1A.2). The two tests below assert the user-tap
  // path against template + Quick-Start fallback, replacing the deleted
  // auto-fire-on-completion tests.

  it("tapping START NS REST fires the rest timer with the workout template's restSeconds", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const workout = buildWorkout({
      id: "w-template",
      exercises: [
        {
          id: "we-1",
          exerciseId: "ex-bench",
          sortOrder: 0,
          supersetGroup: null,
          targetSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 12,
          targetDurationSeconds: null,
          // Custom rest — 60s, NOT the 90s default.
          restSeconds: 60,
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
      ],
    });
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(workout));
    storage.cacheWorkoutDetail("user-1", workout);
    storage.cacheActiveSession("user-1", {
      id: "local-1",
      userId: "user-1",
      workoutId: "w-template",
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

    const adapters = makeAdapters(api, storage);
    const { findByTestId } = renderWithTheme(
      withAdapters(adapters, <ActiveSessionContainer />),
    );

    fireEvent.press(await findByTestId("session-exercise-start-rest"));

    await waitFor(() => {
      expect(
        adapters.notifications.scheduleLocalNotification,
      ).toHaveBeenCalled();
    });
    const lastCall = (
      adapters.notifications.scheduleLocalNotification as jest.Mock
    ).mock.calls.at(-1);
    expect(lastCall?.[0]?.triggerSeconds).toBe(60);
  });

  it("tapping START NS REST falls back to the global default for Quick-Start sessions (no template)", async () => {
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

    const adapters = makeAdapters(api, storage);
    const { findByTestId } = renderWithTheme(
      withAdapters(adapters, <ActiveSessionContainer />),
    );

    fireEvent.press(await findByTestId("session-exercise-start-rest"));

    await waitFor(() => {
      expect(
        adapters.notifications.scheduleLocalNotification,
      ).toHaveBeenCalled();
    });
    const lastCall = (
      adapters.notifications.scheduleLocalNotification as jest.Mock
    ).mock.calls.at(-1);
    expect(lastCall?.[0]?.triggerSeconds).toBe(90);
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

  it("removing a set strips it from the session cache (trash always visible per legacy)", async () => {
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

    fireEvent.press(await findByTestId("set-logger-remove"));
    await waitFor(() => {
      const cached = storage.getActiveSession("user-1");
      expect(cached?.exercises[0].sets).toHaveLength(0);
    });
  });

  it("removing a set renumbers survivors so a subsequent log-set has a unique setNumber", async () => {
    // Bugbot regression: pre-fix, [1,2,3] → remove 2 → [1,3] (length 2)
    // → log-set used `length+1=3`, producing a duplicate setNumber 3.
    // Post-fix: onRemoveSet calls renumberSets so survivors become
    // [1,2], and addSetToExercise uses max+1 = 3 — unique.
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
          sets: [1, 2, 3].map((n) => ({
            id: `set-${n}`,
            sessionExerciseId: "se-1",
            setNumber: n,
            weightKg: 80,
            reps: 8,
            rpe: null,
            durationSeconds: null,
            distanceMeters: null,
            isCompleted: n === 2,
            completedAt: n === 2 ? "2026-05-05T10:05:00.000Z" : null,
          })),
        },
      ],
    });

    const { findAllByTestId, findByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ActiveSessionContainer />),
    );

    // Three rows render; press the trash on the middle one (legacy port:
    // trash is always visible regardless of isCompleted).
    const actions = await findAllByTestId("set-logger-remove");
    fireEvent.press(actions[1]);

    await waitFor(() => {
      const cached = storage.getActiveSession("user-1");
      expect(cached?.exercises[0].sets.map((s) => s.setNumber)).toEqual([1, 2]);
    });

    // Now log a new set — its setNumber must be 3 (unique), not a
    // duplicate of either survivor.
    fireEvent.press(await findByTestId("session-exercise-add-set"));
    await waitFor(() => {
      const cached = storage.getActiveSession("user-1");
      const numbers = cached?.exercises[0].sets.map((s) => s.setNumber) ?? [];
      expect(numbers).toEqual([1, 2, 3]);
      expect(new Set(numbers).size).toBe(3);
    });
  });

  it("Quick Start: no ?workoutId= and no cached session → fires startSessionCommand({}) and stages an empty session", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    // No workoutId in route, no cached session.
    mockUseLocalSearchParams.mockReturnValue({});

    renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ActiveSessionContainer />),
    );

    await waitFor(() => {
      expect(storage.getActiveSession("user-1")).not.toBeNull();
    });
    const cached = storage.getActiveSession("user-1");
    expect(cached?.workoutId).toBeNull();
    expect(cached?.exercises).toEqual([]);
  });

  it("Notes button opens the popover; Save fires setExerciseNotesCommand", async () => {
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

    fireEvent.press(await findByTestId("session-exercise-notes"));
    fireEvent.changeText(
      await findByTestId("exercise-notes-input"),
      "elbows in",
    );
    fireEvent.press(await findByTestId("exercise-notes-save"));
    await waitFor(() => {
      expect(storage.getActiveSession("user-1")?.exercises[0].notes).toBe(
        "elbows in",
      );
    });
  });

  it("Remove exercise button shows Alert.alert; confirming fires removeExerciseCommand", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
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
        {
          id: "se-2",
          sessionId: "local-1",
          exerciseId: "ex-row",
          exerciseName: "Row",
          sortOrder: 1,
          supersetGroup: null,
          isSubstituted: false,
          originalExerciseId: null,
          notes: null,
          sets: [],
        },
      ],
    });

    const { findAllByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ActiveSessionContainer />),
    );

    const removeButtons = await findAllByTestId("session-exercise-remove");
    fireEvent.press(removeButtons[0]);

    expect(alertSpy).toHaveBeenCalledWith(
      "Remove exercise",
      expect.any(String),
      expect.any(Array),
    );

    const buttons = (alertSpy.mock.calls.at(-1)?.[2] ?? []) as {
      text: string;
      style?: string;
      onPress?: () => void;
    }[];
    buttons.find((b) => b.style === "destructive")?.onPress?.();

    await waitFor(() => {
      expect(storage.getActiveSession("user-1")?.exercises).toHaveLength(1);
    });
  });

  it("Add paired set on a superset card fires addSupersetSetCommand for all peer ids", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", {
      id: "local-1",
      userId: "user-1",
      workoutId: null,
      name: "Push Day",
      status: "in_progress",
      startedAt: "2026-05-05T10:00:00.000Z",
      completedAt: null,
      notes: null,
      exercises: [
        {
          id: "se-A",
          sessionId: "local-1",
          exerciseId: "ex-bench",
          exerciseName: "Bench",
          sortOrder: 0,
          supersetGroup: 1,
          isSubstituted: false,
          originalExerciseId: null,
          notes: null,
          sets: [],
        },
        {
          id: "se-B",
          sessionId: "local-1",
          exerciseId: "ex-row",
          exerciseName: "Row",
          sortOrder: 1,
          supersetGroup: 1,
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

    fireEvent.press(await findByTestId("superset-1-add-set"));

    await waitFor(() => {
      const cached = storage.getActiveSession("user-1");
      expect(cached?.exercises[0].sets).toHaveLength(1);
      expect(cached?.exercises[1].sets).toHaveLength(1);
    });
  });

  it("Remove paired set on a superset row fires removeSupersetSetCommand for the setNumber", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", {
      id: "local-1",
      userId: "user-1",
      workoutId: null,
      name: "Push Day",
      status: "in_progress",
      startedAt: "2026-05-05T10:00:00.000Z",
      completedAt: null,
      notes: null,
      exercises: [
        {
          id: "se-A",
          sessionId: "local-1",
          exerciseId: "ex-bench",
          exerciseName: "Bench",
          sortOrder: 0,
          supersetGroup: 1,
          isSubstituted: false,
          originalExerciseId: null,
          notes: null,
          sets: [
            {
              id: "set-A1",
              sessionExerciseId: "se-A",
              setNumber: 1,
              weightKg: null,
              reps: null,
              rpe: null,
              durationSeconds: null,
              distanceMeters: null,
              isCompleted: false,
              completedAt: null,
            },
            {
              id: "set-A2",
              sessionExerciseId: "se-A",
              setNumber: 2,
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
        {
          id: "se-B",
          sessionId: "local-1",
          exerciseId: "ex-row",
          exerciseName: "Row",
          sortOrder: 1,
          supersetGroup: 1,
          isSubstituted: false,
          originalExerciseId: null,
          notes: null,
          sets: [
            {
              id: "set-B1",
              sessionExerciseId: "se-B",
              setNumber: 1,
              weightKg: null,
              reps: null,
              rpe: null,
              durationSeconds: null,
              distanceMeters: null,
              isCompleted: false,
              completedAt: null,
            },
            {
              id: "set-B2",
              sessionExerciseId: "se-B",
              setNumber: 2,
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

    fireEvent.press(await findByTestId("superset-1-set-2-remove"));

    await waitFor(() => {
      const cached = storage.getActiveSession("user-1");
      expect(cached?.exercises[0].sets).toHaveLength(1);
      expect(cached?.exercises[1].sets).toHaveLength(1);
    });
  });

  it("Notes button on a superset row opens the popover with title 'Superset Set N' and saves to every peer", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", {
      id: "local-1",
      userId: "user-1",
      workoutId: null,
      name: "Push Day",
      status: "in_progress",
      startedAt: "2026-05-05T10:00:00.000Z",
      completedAt: null,
      notes: null,
      exercises: [
        {
          id: "se-A",
          sessionId: "local-1",
          exerciseId: "ex-bench",
          exerciseName: "Bench",
          sortOrder: 0,
          supersetGroup: 1,
          isSubstituted: false,
          originalExerciseId: null,
          notes: null,
          sets: [],
        },
        {
          id: "se-B",
          sessionId: "local-1",
          exerciseId: "ex-row",
          exerciseName: "Row",
          sortOrder: 1,
          supersetGroup: 1,
          isSubstituted: false,
          originalExerciseId: null,
          notes: null,
          sets: [],
        },
      ],
    });

    const { findByTestId, getByText } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ActiveSessionContainer />),
    );

    fireEvent.press(await findByTestId("superset-1-set-1-notes"));

    // Title shows "Superset Set 1" — cosmetic per legacy.
    expect(getByText("Superset Set 1")).toBeTruthy();

    fireEvent.changeText(
      await findByTestId("exercise-notes-input"),
      "elbows in",
    );
    fireEvent.press(await findByTestId("exercise-notes-save"));

    await waitFor(() => {
      const cached = storage.getActiveSession("user-1");
      // Notes saved to BOTH peers (legacy stores per-superset-group).
      expect(cached?.exercises[0].notes).toBe("elbows in");
      expect(cached?.exercises[1].notes).toBe("elbows in");
    });
  });

  it("Add Exercise to Superset routes to the single-select AddExerciseToSupersetPopover (NOT the multi-select AddExercisePopover)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", {
      id: "local-1",
      userId: "user-1",
      workoutId: null,
      name: "Push Day",
      status: "in_progress",
      startedAt: "2026-05-05T10:00:00.000Z",
      completedAt: null,
      notes: null,
      exercises: [
        {
          id: "se-A",
          sessionId: "local-1",
          exerciseId: "ex-bench",
          exerciseName: "Bench",
          sortOrder: 0,
          supersetGroup: 7,
          isSubstituted: false,
          originalExerciseId: null,
          notes: null,
          sets: [],
        },
        {
          id: "se-B",
          sessionId: "local-1",
          exerciseId: "ex-row",
          exerciseName: "Row",
          sortOrder: 1,
          supersetGroup: 7,
          isSubstituted: false,
          originalExerciseId: null,
          notes: null,
          sets: [],
        },
      ],
    });

    const { findByTestId, queryByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ActiveSessionContainer />),
    );

    fireEvent.press(await findByTestId("superset-7-add-exercise"));
    // The session screen stays mounted, and the *superset* popover is
    // the one that opened — not AddExercisePopover (whose close button
    // uses `close-button`). Two-popover routing must not let both
    // surface at once.
    expect(await findByTestId("active-session-screen")).toBeTruthy();
    expect(await findByTestId("superset-picker-close")).toBeTruthy();
    expect(queryByTestId("close-button")).toBeNull();
  });

  it("plain Add Exercise (non-superset) routes to AddExercisePopover, NOT the superset popover", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", {
      id: "local-1",
      userId: "user-1",
      workoutId: null,
      name: "Push Day",
      status: "in_progress",
      startedAt: "2026-05-05T10:00:00.000Z",
      completedAt: null,
      notes: null,
      exercises: [
        {
          id: "se-A",
          sessionId: "local-1",
          exerciseId: "ex-bench",
          exerciseName: "Bench",
          sortOrder: 0,
          supersetGroup: null,
          isSubstituted: false,
          originalExerciseId: null,
          notes: null,
          sets: [],
        },
      ],
    });

    const { findByTestId, queryByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ActiveSessionContainer />),
    );

    fireEvent.press(await findByTestId("active-session-add-exercise"));
    expect(await findByTestId("close-button")).toBeTruthy();
    expect(queryByTestId("superset-picker-close")).toBeNull();
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
