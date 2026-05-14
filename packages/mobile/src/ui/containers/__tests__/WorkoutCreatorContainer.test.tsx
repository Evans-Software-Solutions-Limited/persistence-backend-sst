import { act, fireEvent, waitFor } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Exercise } from "@/domain/models/exercise";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { WorkoutCreatorContainer } from "@/ui/containers/WorkoutCreatorContainer";
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
    payments: {} as Adapters["payments"],
  };
}

function withAdapters(adapters: Adapters, ui: React.ReactElement) {
  return <AdapterProvider adapters={adapters}>{ui}</AdapterProvider>;
}

const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();
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
}));

describe("WorkoutCreatorContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders empty creator with disabled-by-default empty state", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const { findByText, getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutCreatorContainer />),
    );
    expect(await findByText("Create Workout")).toBeTruthy();
    expect(getByTestId("workout-name-input")).toBeTruthy();
    expect(await findByText("No exercises added")).toBeTruthy();
  });

  it("surfaces validation: name required + ≥1 exercise", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const { findByText, getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutCreatorContainer />),
    );
    fireEvent.press(getByTestId("save-workout-button"));
    expect(await findByText("Workout name is required")).toBeTruthy();

    fireEvent.changeText(getByTestId("workout-name-input"), "Push Day");
    fireEvent.press(getByTestId("save-workout-button"));
    expect(await findByText("Please add at least one exercise")).toBeTruthy();
  });

  // Explicit 30s timeout — picker-chain tests cascade four+ async waits
  // (auth bootstrap → picker open → exercise select → submit) and a
  // loaded CI worker can blow past the 5s default cumulatively. See
  // brief learning #9.
  it("happy path: name + exercise → submit → router.back + cached row", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([buildExercise({ id: "ex-1", name: "Bench" })]);

    const { findByText, getByTestId, getByText } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutCreatorContainer />),
    );

    expect(await findByText("Create Workout")).toBeTruthy();
    fireEvent.changeText(getByTestId("workout-name-input"), "Push Day");

    // Open picker.
    fireEvent.press(getByTestId("add-exercise-button"));
    // Pick Bench, confirm with "Add" (singular).
    fireEvent.press(await findByText("Bench"));
    fireEvent.press(getByTestId("add-exercises-button"));

    // Picker dismissed; row is in the form.
    await waitFor(() => expect(getByText("Bench")).toBeTruthy());

    fireEvent.press(getByTestId("save-workout-button"));

    await waitFor(() => expect(mockRouterBack).toHaveBeenCalledTimes(1));
    // Optimistic cache write — `mine` slice now holds the new workout.
    const cachedMine = storage.getCachedWorkoutsList("user-1", "mine");
    expect(cachedMine?.workouts.length).toBe(1);
    expect(cachedMine?.workouts[0].name).toBe("Push Day");
  }, 30_000);

  it("dirty-form cancel triggers Alert.alert; clean cancel goes back", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});

    const { findByText, getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutCreatorContainer />),
    );
    expect(await findByText("Create Workout")).toBeTruthy();

    // Clean cancel — no alert, immediate back.
    fireEvent.press(getByTestId("creator-back-button"));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();

    // Dirty cancel — alert prompts.
    fireEvent.changeText(getByTestId("workout-name-input"), "Anything");
    await act(async () => {});
    fireEvent.press(getByTestId("creator-back-button"));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toBe("Discard Changes");
  });

  it("surfaces command validation failure as submitError", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([buildExercise({ id: "ex-1", name: "Bench" })]);

    const { findByText, getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutCreatorContainer />),
    );

    expect(await findByText("Create Workout")).toBeTruthy();
    fireEvent.changeText(getByTestId("workout-name-input"), "Push Day");

    fireEvent.press(getByTestId("add-exercise-button"));
    fireEvent.press(await findByText("Bench"));
    await act(async () => {
      fireEvent.press(getByTestId("add-exercises-button"));
    });

    // Drive targetSets to 0 — passes the container pre-check (name OK,
    // ≥1 exercise) but fails `createWorkoutCommand`'s validation.
    fireEvent.changeText(getByTestId("sets-input"), "0");
    fireEvent(getByTestId("sets-input"), "blur");

    fireEvent.press(getByTestId("save-workout-button"));

    expect(await findByText("Sets must be at least 1")).toBeTruthy();
    expect(mockRouterBack).not.toHaveBeenCalled();
  }, 30_000);

  it("dirty cancel + Discard tap invokes router.back", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    // Fire the destructive button immediately when Alert.alert is called.
    jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      const destructive = (
        buttons as { style?: string; onPress?: () => void }[] | undefined
      )?.find((b) => b.style === "destructive");
      destructive?.onPress?.();
    });

    const { findByText, getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutCreatorContainer />),
    );
    expect(await findByText("Create Workout")).toBeTruthy();
    await act(async () => {
      fireEvent.changeText(getByTestId("workout-name-input"), "Anything");
    });
    fireEvent.press(getByTestId("creator-back-button"));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });

  it("renders supersets with shared-fields propagation through picker", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([
      buildExercise({ id: "a", name: "Bench" }),
      buildExercise({ id: "b", name: "Fly" }),
    ]);

    const { findByText, getByTestId, getAllByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutCreatorContainer />),
    );

    fireEvent.changeText(getByTestId("workout-name-input"), "Chest Day");
    fireEvent.press(getByTestId("add-exercise-button"));
    fireEvent.press(await findByText("Bench"));
    fireEvent.press(await findByText("Fly"));
    fireEvent.press(getByTestId("add-superset-button"));

    // Both exercises rendered as superset peers — second row should
    // show the "Inherited from superset" hint twice (sets + rest).
    await waitFor(() =>
      expect(getByTestId("save-workout-button")).toBeTruthy(),
    );
    const setsInputs = getAllByTestId("sets-input");
    expect(setsInputs.length).toBe(2);
    // Lead row's input is editable; peer's is not.
    expect(setsInputs[0].props.editable).toBe(true);
    expect(setsInputs[1].props.editable).toBe(false);
  }, 30_000);
});
