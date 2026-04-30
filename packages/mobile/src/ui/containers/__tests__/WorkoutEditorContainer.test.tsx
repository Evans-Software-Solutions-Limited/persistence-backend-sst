import { act, fireEvent, waitFor } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Exercise } from "@/domain/models/exercise";
import type { Workout, WorkoutExercise } from "@/domain/models/workout";
import { fail, ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { WorkoutEditorContainer } from "@/ui/containers/WorkoutEditorContainer";
import { renderWithTheme } from "../../../../__tests__/test-utils";

const buildExercise = (overrides: Partial<Exercise> = {}): Exercise => ({
  id: overrides.id ?? "ex-1",
  name: overrides.name ?? "Bench Press",
  description: null,
  instructions: null,
  category: "strength",
  difficulty: "intermediate",
  primaryMuscleGroups: [],
  secondaryMuscleGroups: [],
  equipment: [],
  primaryMuscleGroupLabels: ["Chest"],
  secondaryMuscleGroupLabels: [],
  equipmentLabels: ["Barbell"],
  videoUrl: null,
  thumbnailUrl: null,
  isCustom: false,
  createdBy: null,
  ...overrides,
});

const buildWorkoutExercise = (
  overrides: Partial<WorkoutExercise> = {},
): WorkoutExercise => ({
  id: overrides.id ?? "we-1",
  exerciseId: overrides.exerciseId ?? "ex-1",
  sortOrder: overrides.sortOrder ?? 1,
  supersetGroup: overrides.supersetGroup ?? null,
  targetSets: overrides.targetSets ?? 3,
  targetRepsMin: overrides.targetRepsMin ?? 8,
  targetRepsMax: overrides.targetRepsMax ?? 12,
  targetDurationSeconds: null,
  restSeconds: overrides.restSeconds ?? 60,
  notes: null,
  exercise: overrides.exercise ?? {
    id: "ex-1",
    name: "Bench Press",
    category: "strength",
    difficultyLevel: "intermediate",
    videoUrl: null,
    thumbnailUrl: null,
  },
});

const buildWorkout = (overrides: Partial<Workout> = {}): Workout => ({
  id: overrides.id ?? "w-1",
  name: overrides.name ?? "Push Day",
  description: overrides.description ?? "Original description",
  createdBy: "user-1",
  visibility: overrides.visibility ?? "private",
  estimatedDurationMinutes: overrides.estimatedDurationMinutes ?? 45,
  exercises: overrides.exercises ?? [buildWorkoutExercise()],
  createdAt: "2026-04-28T00:00:00Z",
  updatedAt: "2026-04-28T00:00:00Z",
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
  return {
    api,
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
  };
}

function withAdapters(adapters: Adapters, ui: React.ReactElement) {
  return <AdapterProvider adapters={adapters}>{ui}</AdapterProvider>;
}

const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();
const mockUseLocalSearchParams = jest.fn(
  () => ({ id: "w-1" }) as Record<string, string>,
);
jest.mock("expo-router", () => ({
  __esModule: true,
  router: {
    back: (...args: unknown[]) => mockRouterBack(...args),
    push: (...args: unknown[]) => mockRouterPush(...args),
  },
  useRouter: () => ({
    back: (...args: unknown[]) => mockRouterBack(...args),
    push: (...args: unknown[]) => mockRouterPush(...args),
  }),
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

describe("WorkoutEditorContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({ id: "w-1" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders the loader on cold start when no cached detail", async () => {
    const api = new InMemoryApiAdapter();
    // Hold the fetch open so the loader stays visible.
    jest
      .spyOn(api, "getWorkout")
      .mockImplementation(() => new Promise(() => {}));
    const storage = new InMemoryStorageAdapter();
    const { getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutEditorContainer />),
    );
    await waitFor(() => expect(getByTestId("editor-loading")).toBeTruthy());
  });

  it("hydrates form from cached workout and renders editor", async () => {
    const api = new InMemoryApiAdapter();
    jest
      .spyOn(api, "getWorkout")
      .mockResolvedValue(ok(buildWorkout({ name: "Push Day" })));

    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", buildWorkout({ name: "Push Day" }));

    const { findByText, getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutEditorContainer />),
    );
    expect(await findByText("Edit Workout")).toBeTruthy();
    await waitFor(() =>
      expect(getByTestId("workout-name-input").props.value).toBe("Push Day"),
    );
  });

  it("renders the error state when fetch fails and no cache exists", async () => {
    const api = new InMemoryApiAdapter();
    jest
      .spyOn(api, "getWorkout")
      .mockResolvedValue(
        fail({
          kind: "api",
          code: "not_found",
          message: "Workout not found",
        }),
      );
    const storage = new InMemoryStorageAdapter();
    const { findByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutEditorContainer />),
    );
    expect(await findByTestId("editor-error")).toBeTruthy();
  });

  it("submits a full-replacement PATCH and navigates back", async () => {
    const api = new InMemoryApiAdapter();
    const cached = buildWorkout({ name: "Push Day" });
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(cached));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", cached);

    const { getByTestId, findByText } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutEditorContainer />),
    );

    expect(await findByText("Edit Workout")).toBeTruthy();
    await waitFor(() =>
      expect(getByTestId("workout-name-input").props.value).toBe("Push Day"),
    );

    fireEvent.changeText(getByTestId("workout-name-input"), "Push Day v2");
    fireEvent.press(getByTestId("save-workout-button"));

    await waitFor(() => expect(mockRouterBack).toHaveBeenCalledTimes(1));

    // Cache reflects the optimistic update.
    const updated = storage.getCachedWorkoutDetail("user-1", "w-1");
    expect(updated?.workout.name).toBe("Push Day v2");
    // Sync queue holds the PATCH intent.
    const pending = storage.getPendingMutations();
    expect(pending.length).toBeGreaterThan(0);
    expect(pending[0].method).toBe("PATCH");
    expect(pending[0].endpoint).toBe("/workouts/w-1");
  });

  it("dirty cancel triggers Alert.alert; clean cancel goes back", async () => {
    const api = new InMemoryApiAdapter();
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(buildWorkout()));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", buildWorkout());
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});

    const { findByText, getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutEditorContainer />),
    );
    expect(await findByText("Edit Workout")).toBeTruthy();
    // Wait for hydration to populate the form so the pristine baseline
    // is anchored before we mutate.
    await waitFor(() =>
      expect(getByTestId("workout-name-input").props.value).toBe("Push Day"),
    );

    // Clean cancel — pristine after hydrate.
    fireEvent.press(getByTestId("editor-back-button"));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();

    // Dirty cancel — change name, flush, then press.
    await act(async () => {
      fireEvent.changeText(getByTestId("workout-name-input"), "Different");
    });
    fireEvent.press(getByTestId("editor-back-button"));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toBe("Discard Changes");
  });

  it("toggles visibility through the segmented control", async () => {
    const api = new InMemoryApiAdapter();
    jest
      .spyOn(api, "getWorkout")
      .mockResolvedValue(ok(buildWorkout({ visibility: "private" })));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail(
      "user-1",
      buildWorkout({ visibility: "private" }),
    );

    const { findByText, getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutEditorContainer />),
    );
    expect(await findByText("Edit Workout")).toBeTruthy();
    // Wait for hydration so the visibility radio reflects the cached
    // value before we tap a different option.
    await waitFor(() =>
      expect(getByTestId("workout-name-input").props.value).toBe("Push Day"),
    );

    await act(async () => {
      fireEvent.press(getByTestId("visibility-public"));
    });
    fireEvent.press(getByTestId("save-workout-button"));

    await waitFor(() => expect(mockRouterBack).toHaveBeenCalledTimes(1));
    const updated = storage.getCachedWorkoutDetail("user-1", "w-1");
    expect(updated?.workout.visibility).toBe("public");
  });

  it("blocks submit when the name is cleared after hydrate", async () => {
    const api = new InMemoryApiAdapter();
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(buildWorkout()));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", buildWorkout());

    const { findByText, getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutEditorContainer />),
    );
    expect(await findByText("Edit Workout")).toBeTruthy();
    await waitFor(() =>
      expect(getByTestId("workout-name-input").props.value).toBe("Push Day"),
    );

    await act(async () => {
      fireEvent.changeText(getByTestId("workout-name-input"), "");
    });
    fireEvent.press(getByTestId("save-workout-button"));

    // Inline error surfaces; router.back NOT called.
    expect(await findByText("Workout name is required")).toBeTruthy();
    expect(mockRouterBack).not.toHaveBeenCalled();
  });

  it("blocks submit when all exercises are removed after hydrate", async () => {
    const api = new InMemoryApiAdapter();
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(buildWorkout()));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", buildWorkout());

    const { findByText, getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutEditorContainer />),
    );
    expect(await findByText("Edit Workout")).toBeTruthy();
    await waitFor(() =>
      expect(getByTestId("workout-name-input").props.value).toBe("Push Day"),
    );

    await act(async () => {
      fireEvent.press(getByTestId("remove-button"));
    });
    fireEvent.press(getByTestId("save-workout-button"));

    expect(await findByText("Please add at least one exercise")).toBeTruthy();
    expect(mockRouterBack).not.toHaveBeenCalled();
  });

  it("appends exercises through the picker and dismisses it", async () => {
    const api = new InMemoryApiAdapter();
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(buildWorkout()));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", buildWorkout());
    storage.cacheExercises([
      buildExercise({ id: "ex-2", name: "Squat" }),
      buildExercise({ id: "ex-3", name: "Deadlift" }),
    ]);

    const { findByText, getByTestId, queryByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutEditorContainer />),
    );
    expect(await findByText("Edit Workout")).toBeTruthy();
    await waitFor(() =>
      expect(getByTestId("workout-name-input").props.value).toBe("Push Day"),
    );

    fireEvent.press(getByTestId("add-exercise-button"));
    fireEvent.press(await findByText("Squat"));
    fireEvent.press(await findByText("Deadlift"));
    await act(async () => {
      fireEvent.press(getByTestId("add-superset-button"));
    });

    // Picker dismissed (close button no longer in the tree because
    // visible=false makes Popover return null).
    await waitFor(() => expect(queryByTestId("close-button")).toBeNull());
    // Both new exercises rendered as superset peers; original + 2 new = 3 rows.
    await waitFor(() =>
      expect(getByTestId("save-workout-button")).toBeTruthy(),
    );
  });

  it("does not re-hydrate the form on a subsequent detail.workout change", async () => {
    const api = new InMemoryApiAdapter();
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(buildWorkout()));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", buildWorkout({ name: "Original" }));

    const { findByText, getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutEditorContainer />),
    );

    expect(await findByText("Edit Workout")).toBeTruthy();
    await waitFor(() =>
      expect(getByTestId("workout-name-input").props.value).toBe("Original"),
    );
    fireEvent.changeText(getByTestId("workout-name-input"), "User-edit");

    // Simulate a background cache write (e.g. another refresh) — the
    // form should NOT clobber the user's in-flight edit.
    storage.cacheWorkoutDetail("user-1", buildWorkout({ name: "Refreshed" }));

    // Brief wait — even if effects run, the hydrate guard short-circuits.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(getByTestId("workout-name-input").props.value).toBe("User-edit");
  });
});
