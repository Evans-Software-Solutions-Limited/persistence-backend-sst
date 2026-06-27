import { act, fireEvent } from "@testing-library/react-native";
import React from "react";
import { Alert, RefreshControl } from "react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Exercise } from "@/domain/models/exercise";
import type { Workout, WorkoutExercise } from "@/domain/models/workout";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { WorkoutsListContainer } from "@/ui/containers/WorkoutsListContainer";
import { useTrainSegment } from "@/ui/hooks/useTrainSegment";
import { renderWithTheme } from "../../../../__tests__/test-utils";

const buildWorkout = (overrides: Partial<Workout> = {}): Workout => ({
  id: overrides.id ?? "w-1",
  name: overrides.name ?? "Push Day",
  description: null,
  createdBy: overrides.createdBy ?? "test-user",
  visibility: overrides.visibility ?? "private",
  estimatedDurationMinutes: 45,
  exercises: overrides.exercises ?? [],
  createdAt: "2026-04-28T00:00:00Z",
  updatedAt: "2026-04-28T00:00:00Z",
  ...overrides,
});

const DEFAULT_SESSION: AuthSession = {
  accessToken: "t",
  refreshToken: "r",
  userId: "test-user",
  email: "u@example.com",
  expiresAt: Date.now() + 60_000,
};

function makeAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
  session: AuthSession | null = DEFAULT_SESSION,
): Adapters {
  const auth = {
    signInWithEmail: jest.fn(),
    signUpWithEmail: jest.fn(),
    signInWithOAuth: jest.fn(),
    signOut: jest.fn(),
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    resetPassword: jest.fn(),
    refreshSession: jest.fn(),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  return {
    api,
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
    netInfo: {} as Adapters["netInfo"],
  };
}

function withAdapters(adapters: Adapters, ui: React.ReactElement) {
  return <AdapterProvider adapters={adapters}>{ui}</AdapterProvider>;
}

const mockRouterPush = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({}));
jest.mock("expo-router", () => {
  const React = jest.requireActual("react") as typeof import("react");
  return {
    __esModule: true,
    router: {
      push: (...args: unknown[]) => mockRouterPush(...args),
    },
    useLocalSearchParams: () => mockUseLocalSearchParams(),
    useNavigation: () => ({ addListener: () => () => {} }),
    useFocusEffect: (cb: React.EffectCallback) => {
      React.useEffect(() => cb(), [cb]);
    },
  };
});

/** Seed all three list slices; `mine` carries the optional quota. */
function seedSlices(
  storage: InMemoryStorageAdapter,
  opts: {
    mine?: Workout[];
    assigned?: Workout[];
    defaults?: Workout[];
    quota?: { used: number; limit: number } | null;
  } = {},
) {
  storage.cacheWorkoutsList(
    "test-user",
    "mine",
    opts.mine ?? [],
    opts.quota ?? null,
  );
  storage.cacheWorkoutsList("test-user", "assigned", opts.assigned ?? [], null);
  storage.cacheWorkoutsList("test-user", "default", opts.defaults ?? [], null);
}

describe("WorkoutsListContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useTrainSegment.setState({ segment: "Workouts", pendingCreate: false });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders the cached payload on mount", async () => {
    const storage = new InMemoryStorageAdapter();
    seedSlices(storage, {
      mine: [buildWorkout({ id: "w-cached", name: "Cached Push" })],
      quota: { used: 1, limit: 50 },
    });

    const adapters = makeAdapters(new InMemoryApiAdapter(), storage);
    const { findByText } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );

    expect(await findByText("Cached Push")).toBeTruthy();
  });

  it("pushes the workout-detail route when a row is pressed", async () => {
    const storage = new InMemoryStorageAdapter();
    seedSlices(storage, {
      mine: [buildWorkout({ id: "w-1", name: "Push Day" })],
    });

    const adapters = makeAdapters(new InMemoryApiAdapter(), storage);
    const { findByTestId } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );

    fireEvent.press(await findByTestId("workout-row-w-1"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/workouts/w-1");
  });

  it("starts a session from the Play button via the session route", async () => {
    const storage = new InMemoryStorageAdapter();
    seedSlices(storage, {
      mine: [buildWorkout({ id: "w-1", name: "Push Day" })],
    });

    const adapters = makeAdapters(new InMemoryApiAdapter(), storage);
    const { findByLabelText } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );

    fireEvent.press(await findByLabelText("Start Push Day"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/session?workoutId=w-1");
  });

  it("long-press → Edit routes to the editor modal", async () => {
    const storage = new InMemoryStorageAdapter();
    seedSlices(storage, {
      mine: [buildWorkout({ id: "w-1", name: "Push Day" })],
    });

    // Auto-press the "Edit" entry of the long-press context menu.
    jest
      .spyOn(Alert, "alert")
      .mockImplementation((_title, _message, buttons) => {
        buttons?.find((b) => b.text === "Edit")?.onPress?.();
      });

    const adapters = makeAdapters(new InMemoryApiAdapter(), storage);
    const { findByTestId } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );

    fireEvent(await findByTestId("workout-row-w-1"), "longPress");
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/workouts/w-1/edit");
  });

  it("long-press → Delete enqueues a DELETE sync intent and prunes the cache", async () => {
    const storage = new InMemoryStorageAdapter();
    seedSlices(storage, {
      mine: [buildWorkout({ id: "w-delete", name: "Delete Me" })],
    });

    // Cascade: press the destructive button on every Alert — the menu's
    // "Delete" opens the confirm Alert, whose "Delete" runs the command.
    jest
      .spyOn(Alert, "alert")
      .mockImplementation((_title, _message, buttons) => {
        buttons?.find((b) => b.style === "destructive")?.onPress?.();
      });

    const adapters = makeAdapters(new InMemoryApiAdapter(), storage);
    const { findByTestId } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );

    await act(async () => {
      fireEvent(await findByTestId("workout-row-w-delete"), "longPress");
    });

    const pending = storage.getPendingMutations();
    expect(pending).toHaveLength(1);
    expect(pending[0].operation).toBe("delete");
    expect(pending[0].entityId).toBe("w-delete");
    expect(
      storage.getCachedWorkoutsList("test-user", "mine")?.workouts,
    ).toEqual([]);
    expect(storage.getCachedWorkoutDetail("test-user", "w-delete")).toBeNull();
  });

  it("Create Workout routes to the creator modal", async () => {
    const storage = new InMemoryStorageAdapter();
    seedSlices(storage, { quota: { used: 0, limit: 3 } });

    const adapters = makeAdapters(new InMemoryApiAdapter(), storage);
    const { findByTestId } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );

    fireEvent.press(await findByTestId("create-workout-cta"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/workouts/create");
  });

  it("at-limit users see the indicator and Upgrade routes to subscription management", async () => {
    const storage = new InMemoryStorageAdapter();
    seedSlices(storage, {
      mine: [buildWorkout({ id: "w-1", name: "Push Day" })],
      quota: { used: 3, limit: 3 },
    });

    const adapters = makeAdapters(new InMemoryApiAdapter(), storage);
    const { findByText } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );

    expect(await findByText("Push Day")).toBeTruthy();
    fireEvent.press(await findByText("Upgrade Now"));
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/(app)/subscription-management",
    );
  }, 30_000);

  it("renders public defaults as templates and opens them on press", async () => {
    const storage = new InMemoryStorageAdapter();
    seedSlices(storage, {
      defaults: [buildWorkout({ id: "tpl-1", name: "PPL Push" })],
    });

    const adapters = makeAdapters(new InMemoryApiAdapter(), storage);
    const { findByTestId, queryByLabelText } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );

    const row = await findByTestId("workout-row-tpl-1");
    // Template rows have no Play button.
    expect(queryByLabelText("Start PPL Push")).toBeNull();
    fireEvent.press(row);
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/workouts/tpl-1");
  });

  it("derives a split badge from the cached exercise library", async () => {
    const storage = new InMemoryStorageAdapter();
    // Seed push-muscle exercises in the runtime shape: primaryMuscleGroups
    // are UUIDs, readable names are in primaryMuscleGroupLabels.
    storage.cacheExercises([
      {
        id: "ex-1",
        primaryMuscleGroups: ["15f7ddb6-uuid-chest"],
        primaryMuscleGroupLabels: ["Chest"],
      } as unknown as Exercise,
      // ex-2 has no resolved labels — falls back to enum keys on
      // primaryMuscleGroups (legacy-cached shape).
      {
        id: "ex-2",
        primaryMuscleGroups: ["shoulders"],
      } as unknown as Exercise,
    ]);
    seedSlices(storage, {
      mine: [
        buildWorkout({
          id: "w-1",
          name: "Push Day",
          exercises: [
            { exerciseId: "ex-1" } as WorkoutExercise,
            { exerciseId: "ex-2" } as WorkoutExercise,
          ],
        }),
      ],
    });

    const adapters = makeAdapters(new InMemoryApiAdapter(), storage);
    const { findByText } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );

    expect(await findByText("Push Day")).toBeTruthy();
    expect(await findByText("PUSH")).toBeTruthy();
  });

  it("pull-to-refresh re-fetches the workouts from the API", async () => {
    const storage = new InMemoryStorageAdapter();
    seedSlices(storage, {
      mine: [buildWorkout({ id: "w-1", name: "Push Day" })],
    });

    const api = new InMemoryApiAdapter();
    const getWorkoutsSpy = jest.spyOn(api, "getWorkouts");
    const adapters = makeAdapters(api, storage);
    const { findByText, UNSAFE_getByType } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );
    await findByText("Push Day");

    // Ignore any initial stale-cache auto-refresh — assert the pull-to-refresh
    // gesture specifically re-hits the API.
    getWorkoutsSpy.mockClear();
    await act(async () => {
      fireEvent(UNSAFE_getByType(RefreshControl), "refresh");
    });

    // onRefresh must wire through to workouts.refresh() -> api.getWorkouts().
    expect(getWorkoutsSpy).toHaveBeenCalled();
  });

  it("renders the empty state when there is no authenticated user", async () => {
    const storage = new InMemoryStorageAdapter();
    seedSlices(storage);

    const adapters = makeAdapters(new InMemoryApiAdapter(), storage, null);
    const { findByText } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );

    // userId resolves to null → currentUserId undefined, no rows; the Mine
    // empty state still renders.
    expect(await findByText("No workouts yet")).toBeTruthy();
  });
});
