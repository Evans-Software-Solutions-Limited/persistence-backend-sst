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
  ...(overrides.setTargets ? { setTargets: overrides.setTargets } : {}),
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
  showInOwnerLibrary: overrides.showInOwnerLibrary ?? true,
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
    api,
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    netInfo: {} as Adapters["netInfo"],
  };
}

function withAdapters(adapters: Adapters, ui: React.ReactElement) {
  return <AdapterProvider adapters={adapters}>{ui}</AdapterProvider>;
}

const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();
const mockRedirect = jest.fn((_props: { href: string }) => null);
const mockLoadoutGate = {
  allowed: true,
  isResolved: true,
  upgradePriceMonthly: null,
  onUpgrade: jest.fn(),
  refetch: jest.fn(),
};
jest.mock("@/ui/hooks/useLoadoutGate", () => ({
  useLoadoutGate: () => mockLoadoutGate,
}));
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
  Redirect: (props: { href: string }) => mockRedirect(props),
}));

describe("WorkoutEditorContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({ id: "w-1" });
    mockLoadoutGate.allowed = true;
    mockLoadoutGate.isResolved = true;
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
    jest.spyOn(api, "getWorkout").mockResolvedValue(
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

  it("falls through to the editor form when refresh fails but cache exists (offline edit)", async () => {
    const api = new InMemoryApiAdapter();
    // Cache populated (user has been here before); refresh now fails.
    jest.spyOn(api, "getWorkout").mockResolvedValue(
      fail({
        kind: "api",
        code: "network",
        message: "offline",
      }),
    );
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail(
      "user-1",
      buildWorkout({ name: "Cached offline workout" }),
    );

    const { findByText, getByTestId, queryByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutEditorContainer />),
    );

    // The editor form renders and pre-populates from the cache; the
    // error screen does NOT clobber the editing surface.
    expect(await findByText("Edit Workout")).toBeTruthy();
    await waitFor(() =>
      expect(getByTestId("workout-name-input").props.value).toBe(
        "Cached offline workout",
      ),
    );
    expect(queryByTestId("editor-error")).toBeNull();
  });

  it("submits a PATCH and navigates back", async () => {
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

  it("omits `exercises` from a rename-only PATCH so the duration isn't re-derived", async () => {
    // The server re-derives the duration whenever a PATCH carries the plan.
    // Sending it on a rename would rewrite durations authored by the still-live
    // legacy app (whose formula differs), and the next legacy edit would write
    // its value back — a number that flips between clients. The backfill
    // migration deliberately leaves legacy values alone; the edit path must
    // too.
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

    const payload = JSON.parse(
      storage.getPendingMutations()[0].payload,
    ) as Record<string, unknown>;
    expect(payload.name).toBe("Push Day v2");
    expect(payload.exercises).toBeUndefined();
    expect(payload.estimatedDurationMinutes).toBeUndefined();
  });

  it("sends `exercises` once the plan actually changes", async () => {
    const api = new InMemoryApiAdapter();
    const cached = buildWorkout({ name: "Push Day" });
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(cached));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", cached);

    const {
      getByTestId,
      findByText,
      getAllByTestId: getAllById,
    } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutEditorContainer />),
    );
    expect(await findByText("Edit Workout")).toBeTruthy();
    await waitFor(() =>
      expect(getByTestId("workout-name-input").props.value).toBe("Push Day"),
    );

    // The loaded plan starts collapsed, reading as it did before PER-139.
    expect(getAllById("set-summary")[0].props.children).toBe(
      "3 sets · 8–12 reps",
    );
    // Add a set — a real plan edit. An exercise on the old range keeps its
    // range (no per-set reps until a set's reps change).
    fireEvent.press(getAllById("toggle-button")[0]);
    expect(getAllById("set-0-reps")[0].props.children).toBe("8–12");
    fireEvent.press(getAllById("add-set")[0]);
    fireEvent.press(getByTestId("save-workout-button"));
    await waitFor(() => expect(mockRouterBack).toHaveBeenCalledTimes(1));

    const payload = JSON.parse(storage.getPendingMutations()[0].payload) as {
      exercises: Record<string, unknown>[];
      estimatedDurationMinutes?: number;
    };
    expect(Array.isArray(payload.exercises)).toBe(true);
    expect(payload.exercises[0]).toMatchObject({
      targetSets: 4,
      targetRepsMin: 8,
      targetRepsMax: 12,
    });
    expect(payload.exercises[0]).not.toHaveProperty("setTargets");
    // Still omitted — the server derives it from the plan it just received.
    expect(payload.estimatedDurationMinutes).toBeUndefined();
  });

  it("in coach context: shows the owner-visibility toggle and PATCHes the flipped value", async () => {
    mockUseLocalSearchParams.mockReturnValue({ id: "w-1", ctx: "coach" });
    const api = new InMemoryApiAdapter();
    const cached = buildWorkout({ name: "Push Day", showInOwnerLibrary: true });
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(cached));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", cached);

    const { getByTestId, findByText } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutEditorContainer />),
    );
    expect(await findByText("Edit Workout")).toBeTruthy();
    const toggle = getByTestId("show-in-owner-library-toggle");
    await waitFor(() => expect(toggle.props.value).toBe(true));

    fireEvent(toggle, "valueChange", false);
    fireEvent.press(getByTestId("save-workout-button"));

    await waitFor(() => expect(mockRouterBack).toHaveBeenCalledTimes(1));
    const pending = storage.getPendingMutations();
    const payload = JSON.parse(pending[0].payload as string) as {
      showInOwnerLibrary?: boolean;
    };
    expect(payload.showInOwnerLibrary).toBe(false);
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
      fireEvent.press(getByTestId("visibility-friends"));
    });
    fireEvent.press(getByTestId("save-workout-button"));

    await waitFor(() => expect(mockRouterBack).toHaveBeenCalledTimes(1));
    const updated = storage.getCachedWorkoutDetail("user-1", "w-1");
    expect(updated?.workout.visibility).toBe("friends");
  });

  it("shows an already-public workout read-only (v1) and lets you move it OFF public", async () => {
    // Edge case: editing a legacy/seeded "public" workout. v1 removed Public
    // as a selectable option, so the current value renders as a disabled
    // read-only chip — visible but not re-selectable — while Private/Friends
    // stay tappable so the user can move it off public one-way.
    const api = new InMemoryApiAdapter();
    jest
      .spyOn(api, "getWorkout")
      .mockResolvedValue(ok(buildWorkout({ visibility: "public" })));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail(
      "user-1",
      buildWorkout({ visibility: "public" }),
    );

    const { findByText, getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutEditorContainer />),
    );
    expect(await findByText("Edit Workout")).toBeTruthy();
    await waitFor(() =>
      expect(getByTestId("workout-name-input").props.value).toBe("Push Day"),
    );

    // The read-only "Public" chip is present but disabled (no re-selecting).
    expect(
      getByTestId("visibility-public").props.accessibilityState?.disabled,
    ).toBe(true);

    // Moving it to Private is allowed and persists off public.
    await act(async () => {
      fireEvent.press(getByTestId("visibility-private"));
    });
    fireEvent.press(getByTestId("save-workout-button"));

    await waitFor(() => expect(mockRouterBack).toHaveBeenCalledTimes(1));
    const updated = storage.getCachedWorkoutDetail("user-1", "w-1");
    expect(updated?.workout.visibility).toBe("private");
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

  // Explicit 30s timeout — this test chains five cascading async waits
  // (auth bootstrap → useWorkout cache hit → form hydrate → picker
  // open → picker dismiss). Each `findBy*` polls for up to 4.5s, and
  // a loaded CI worker can blow past the 5s default cumulatively. See
  // brief learning #9 (M2 follow-up).
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
    // Anchor on hydrate first — proves auth + cache + form reset
    // have all propagated before we open the picker.
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
    await waitFor(() =>
      expect(getByTestId("save-workout-button")).toBeTruthy(),
    );
  }, 30_000);

  it("set editor (PER-139): a 10/8/8 workout loads, edits and saves per set", async () => {
    const api = new InMemoryApiAdapter();
    const cached = buildWorkout({
      exercises: [
        buildWorkoutExercise({
          targetSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 10,
          setTargets: [{ reps: 10 }, { reps: 8 }, { reps: 8 }],
        }),
      ],
    });
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(cached));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", cached);

    const { findByText, getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutEditorContainer />),
    );
    expect(await findByText("Edit Workout")).toBeTruthy();
    await waitFor(() =>
      expect(getByTestId("set-summary").props.children).toBe(
        "3 sets · 10, 8, 8",
      ),
    );
    fireEvent.press(getByTestId("exercise-header"));
    expect(getByTestId("set-0-reps").props.children).toBe("10");
    expect(getByTestId("set-2-reps").props.children).toBe("8");

    fireEvent.press(getByTestId("set-2-dec")); // 10, 8, 7
    fireEvent.press(getByTestId("save-workout-button"));
    await waitFor(() => expect(mockRouterBack).toHaveBeenCalledTimes(1));

    const payload = JSON.parse(storage.getPendingMutations()[0].payload) as {
      exercises: Record<string, unknown>[];
    };
    expect(payload.exercises[0]).toMatchObject({
      setTargets: [{ reps: 10 }, { reps: 8 }, { reps: 7 }],
      targetSets: 3,
      targetRepsMin: 7,
      targetRepsMax: 10,
    });
    // The cached copy (offline display) carries the new per-set reps.
    expect(
      storage.getCachedWorkoutDetail("user-1", "w-1")?.workout.exercises[0]
        .setTargets,
    ).toEqual([{ reps: 10 }, { reps: 8 }, { reps: 7 }]);
  });

  it("set editor: changing a set's reps turns an old range into per-set reps", async () => {
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
    fireEvent.press(getByTestId("toggle-button"));
    // 8–12 steps from its top: set 2 becomes 11, the others 12.
    fireEvent.press(getByTestId("set-1-dec"));
    expect(getByTestId("set-0-reps").props.children).toBe("12");
    expect(getByTestId("set-1-reps").props.children).toBe("11");
    fireEvent.press(getByTestId("save-workout-button"));
    await waitFor(() => expect(mockRouterBack).toHaveBeenCalledTimes(1));

    const payload = JSON.parse(storage.getPendingMutations()[0].payload) as {
      exercises: Record<string, unknown>[];
    };
    expect(payload.exercises[0]).toMatchObject({
      setTargets: [{ reps: 12 }, { reps: 11 }, { reps: 12 }],
      targetSets: 3,
      targetRepsMin: 11,
      targetRepsMax: 12,
    });
  });

  it("Save is refused by the schema when an exercise has more than 20 sets", async () => {
    const api = new InMemoryApiAdapter();
    const cached = buildWorkout({
      exercises: [buildWorkoutExercise({ targetSets: 25 })],
    });
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(cached));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", cached);

    const { findByText, getByTestId, queryByText } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutEditorContainer />),
    );
    expect(await findByText("Edit Workout")).toBeTruthy();
    await waitFor(() =>
      expect(getByTestId("workout-name-input").props.value).toBe("Push Day"),
    );
    fireEvent.press(getByTestId("toggle-button"));
    // An old 25-set range can't add more, and saves as it is until edited.
    expect(getByTestId("add-set").props.accessibilityState).toMatchObject({
      disabled: true,
    });
    fireEvent.press(getByTestId("set-0-inc"));
    fireEvent.press(getByTestId("save-workout-button"));

    expect(await findByText("Use 1 to 20 sets.")).toBeTruthy();
    expect(mockRouterBack).not.toHaveBeenCalled();
    expect(storage.getPendingMutations()).toHaveLength(0);

    // Removing sets down to 20 clears it, and Save goes through.
    for (let i = 0; i < 5; i += 1) {
      fireEvent.press(getByTestId("set-0-remove"));
    }
    await waitFor(() => expect(queryByText("Use 1 to 20 sets.")).toBeNull());
    fireEvent.press(getByTestId("save-workout-button"));
    await waitFor(() => expect(mockRouterBack).toHaveBeenCalledTimes(1));
  });

  it("dirty cancel + Discard tap invokes router.back", async () => {
    const api = new InMemoryApiAdapter();
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(buildWorkout()));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", buildWorkout());
    jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      const destructive = (
        buttons as { style?: string; onPress?: () => void }[] | undefined
      )?.find((b) => b.style === "destructive");
      destructive?.onPress?.();
    });

    const { findByText, getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutEditorContainer />),
    );
    expect(await findByText("Edit Workout")).toBeTruthy();
    await waitFor(() =>
      expect(getByTestId("workout-name-input").props.value).toBe("Push Day"),
    );
    await act(async () => {
      fireEvent.changeText(getByTestId("workout-name-input"), "Different");
    });
    fireEvent.press(getByTestId("editor-back-button"));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
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

  it("redirects instead of hydrating a retained Loadout editor after entitlement loss", async () => {
    const api = new InMemoryApiAdapter();
    const variation = buildWorkout({
      id: "v-locked",
      parentWorkoutId: null,
      variationKind: "loadout",
    });
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(variation));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", variation);
    mockUseLocalSearchParams.mockReturnValue({ id: "v-locked" });
    mockLoadoutGate.allowed = false;

    const { queryByText } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutEditorContainer />),
    );

    await waitFor(() =>
      expect(mockRedirect).toHaveBeenCalledWith({
        href: "/(app)/(tabs)/train",
      }),
    );
    expect(queryByText("Edit Workout")).toBeNull();
  });
});
