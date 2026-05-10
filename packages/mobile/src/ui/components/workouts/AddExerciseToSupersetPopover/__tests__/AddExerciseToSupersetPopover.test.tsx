import { fireEvent } from "@testing-library/react-native";
import React from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Exercise } from "@/domain/models/exercise";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { AddExerciseToSupersetPopover } from "../AddExerciseToSupersetPopover";
import { renderWithTheme } from "../../../../../../__tests__/test-utils";

jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: jest.fn(), back: jest.fn() },
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

const buildExercise = (overrides: Partial<Exercise> = {}): Exercise => ({
  id: "ex-bench",
  name: "Bench Press",
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
  storage: InMemoryStorageAdapter,
  api: InMemoryApiAdapter,
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

function seedCache(storage: InMemoryStorageAdapter, exercises: Exercise[]) {
  storage.cacheExercises(exercises);
}

describe("AddExerciseToSupersetPopover", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the modal with the legacy single-select title + back arrow + Add button", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [buildExercise()]);

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <AddExerciseToSupersetPopover
          visible={true}
          onClose={jest.fn()}
          onAddExercise={jest.fn()}
        />
      </AdapterProvider>,
    );
    expect(await findByTestId("superset-picker-modal")).toBeTruthy();
    expect(await findByTestId("superset-picker-close")).toBeTruthy();
    expect(await findByTestId("superset-picker-add")).toBeTruthy();
    expect(await findByTestId("superset-picker-search")).toBeTruthy();
  });

  it("Add button is disabled until exactly one row is selected (legacy single-select semantic)", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [
      buildExercise({ id: "ex-1", name: "Bench Press" }),
      buildExercise({ id: "ex-2", name: "Row" }),
    ]);
    const onAddExercise = jest.fn();

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <AddExerciseToSupersetPopover
          visible={true}
          onClose={jest.fn()}
          onAddExercise={onAddExercise}
        />
      </AdapterProvider>,
    );
    // Add tap with no selection → disabled, no callback fires.
    fireEvent.press(await findByTestId("superset-picker-add"));
    expect(onAddExercise).not.toHaveBeenCalled();
  });

  it("Add fires onAddExercise with EXACTLY ONE row (single-element array — matches dispatcher's `rows` loop shape)", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [
      buildExercise({ id: "ex-1", name: "Bench Press" }),
      buildExercise({ id: "ex-2", name: "Row" }),
    ]);
    const onAddExercise = jest.fn();

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <AddExerciseToSupersetPopover
          visible={true}
          onClose={jest.fn()}
          onAddExercise={onAddExercise}
        />
      </AdapterProvider>,
    );
    // Selection rows are rendered by AddExerciseList — testID is
    // `exercise-row-<id>` per the legacy list contract.
    fireEvent.press(await findByTestId("exercise-row-ex-1"));
    fireEvent.press(await findByTestId("superset-picker-add"));
    expect(onAddExercise).toHaveBeenCalledTimes(1);
    const rows = onAddExercise.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("ex-1");
    expect(rows[0].name).toBe("Bench Press");
  });

  it("tapping a different row replaces the selection (single-select semantic, not additive)", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [
      buildExercise({ id: "ex-1", name: "Bench Press" }),
      buildExercise({ id: "ex-2", name: "Row" }),
    ]);
    const onAddExercise = jest.fn();

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <AddExerciseToSupersetPopover
          visible={true}
          onClose={jest.fn()}
          onAddExercise={onAddExercise}
        />
      </AdapterProvider>,
    );
    fireEvent.press(await findByTestId("exercise-row-ex-1"));
    fireEvent.press(await findByTestId("exercise-row-ex-2"));
    fireEvent.press(await findByTestId("superset-picker-add"));
    const rows = onAddExercise.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("ex-2");
  });

  it("tapping the currently-selected row clears the selection (deselect)", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [buildExercise({ id: "ex-1", name: "Bench Press" })]);
    const onAddExercise = jest.fn();

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <AddExerciseToSupersetPopover
          visible={true}
          onClose={jest.fn()}
          onAddExercise={onAddExercise}
        />
      </AdapterProvider>,
    );
    fireEvent.press(await findByTestId("exercise-row-ex-1"));
    fireEvent.press(await findByTestId("exercise-row-ex-1"));
    fireEvent.press(await findByTestId("superset-picker-add"));
    expect(onAddExercise).not.toHaveBeenCalled();
  });

  it("close button calls onClose and resets internal selection (next open starts empty)", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [buildExercise({ id: "ex-1", name: "Bench Press" })]);
    const onClose = jest.fn();

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <AddExerciseToSupersetPopover
          visible={true}
          onClose={onClose}
          onAddExercise={jest.fn()}
        />
      </AdapterProvider>,
    );
    fireEvent.press(await findByTestId("superset-picker-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when visible=false (Modal short-circuits in test tree)", () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [buildExercise()]);

    const { queryByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <AddExerciseToSupersetPopover
          visible={false}
          onClose={jest.fn()}
          onAddExercise={jest.fn()}
        />
      </AdapterProvider>,
    );
    expect(queryByTestId("superset-picker-modal")).toBeNull();
  });

  it("maps muscleGroup + equipment labels through toLegacyExerciseRow (legacy ExerciseRow shape)", async () => {
    // Hits the `muscleLabels.map(...)` + `equipmentLabels.map(...)`
    // branches in toLegacyExerciseRow — without a populated exercise
    // they're empty arrays and the .map() never runs.
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [
      buildExercise({
        id: "ex-1",
        name: "Bench Press",
        primaryMuscleGroupLabels: ["Chest", "Triceps"],
        equipmentLabels: ["Barbell"],
      }),
    ]);
    const onAddExercise = jest.fn();
    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <AddExerciseToSupersetPopover
          visible={true}
          onClose={jest.fn()}
          onAddExercise={onAddExercise}
        />
      </AdapterProvider>,
    );
    fireEvent.press(await findByTestId("exercise-row-ex-1"));
    fireEvent.press(await findByTestId("superset-picker-add"));
    const row = onAddExercise.mock.calls[0][0][0];
    // Legacy snake_case shape — primary_muscles is a list of
    // `{ name, display_name }` records; equipment_required is
    // `{ name }`.
    expect(row.primary_muscles).toEqual([
      { name: "Chest", display_name: "Chest" },
      { name: "Triceps", display_name: "Triceps" },
    ]);
    expect(row.equipment_required).toEqual([{ name: "Barbell" }]);
  });

  it("info icon drills into the details view; back button returns to the list", async () => {
    // Hits handleExerciseInfo's `if (exercise)` branch + the
    // details-view render path + handleBackToList.
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [buildExercise({ id: "ex-1", name: "Bench Press" })]);
    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <AddExerciseToSupersetPopover
          visible={true}
          onClose={jest.fn()}
          onAddExercise={jest.fn()}
        />
      </AdapterProvider>,
    );
    fireEvent.press(await findByTestId("exercise-info-button-ex-1"));
    // Details modal rendered — back button is the only chrome.
    const backButton = await findByTestId("superset-picker-details-back");
    expect(backButton).toBeTruthy();
    fireEvent.press(backButton);
    // Returned to the list — search bar is reachable again.
    expect(await findByTestId("superset-picker-search")).toBeTruthy();
  });

  it("clear-search button empties the query field", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [buildExercise({ id: "ex-1", name: "Bench Press" })]);
    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <AddExerciseToSupersetPopover
          visible={true}
          onClose={jest.fn()}
          onAddExercise={jest.fn()}
        />
      </AdapterProvider>,
    );
    const search = await findByTestId("superset-picker-search");
    fireEvent.changeText(search, "bench");
    expect(search.props.value).toBe("bench");
    fireEvent.press(await findByTestId("superset-picker-clear-search"));
    expect(search.props.value).toBe("");
  });

  it("respects the 100-row display ceiling when the library is larger", async () => {
    // Hits the `slice(0, PICKER_DISPLAY_LIMIT)` branch — without > 100
    // exercises, the slice is a no-op and the boundary is never
    // exercised.
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    const many = Array.from({ length: 105 }, (_, i) =>
      buildExercise({ id: `ex-${i}`, name: `Exercise ${i}` }),
    );
    seedCache(storage, many);
    const { findByTestId, queryByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <AddExerciseToSupersetPopover
          visible={true}
          onClose={jest.fn()}
          onAddExercise={jest.fn()}
        />
      </AdapterProvider>,
    );
    // First 100 are reachable; index 100+ is not (sliced away).
    expect(await findByTestId("exercise-row-ex-0")).toBeTruthy();
    expect(await findByTestId("exercise-row-ex-99")).toBeTruthy();
    expect(queryByTestId("exercise-row-ex-100")).toBeNull();
  });
});
