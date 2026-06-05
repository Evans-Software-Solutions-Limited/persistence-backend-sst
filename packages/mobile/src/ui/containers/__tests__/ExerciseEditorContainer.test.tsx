import { act, fireEvent, waitFor } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";

import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Exercise } from "@/domain/models/exercise";
import { fail, ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useExerciseLibrary } from "@/ui/hooks/useExerciseLibrary";
import * as updateExerciseCommandModule from "@/application/commands/update-exercise.command";
import { ExerciseEditorContainer } from "@/ui/containers/ExerciseEditorContainer";
import { renderWithTheme } from "../../../../__tests__/test-utils";

const buildExercise = (overrides: Partial<Exercise> = {}): Exercise => ({
  id: "ex-1",
  name: "Bench Press",
  description: null,
  instructions: null,
  category: "strength",
  difficulty: "intermediate",
  primaryMuscleGroups: ["chest"],
  secondaryMuscleGroups: ["triceps"],
  equipment: ["barbell"],
  primaryMuscleGroupLabels: ["Chest"],
  secondaryMuscleGroupLabels: ["Triceps"],
  equipmentLabels: ["Barbell"],
  videoUrl: null,
  thumbnailUrl: null,
  isCustom: true,
  createdBy: "user-1",
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

const mockRouterBack = jest.fn();
const mockUseLocalSearchParams = jest.fn(
  () => ({ id: "ex-1" }) as Record<string, string>,
);
jest.mock("expo-router", () => ({
  __esModule: true,
  router: {
    back: (...args: unknown[]) => mockRouterBack(...args),
    push: jest.fn(),
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

describe("ExerciseEditorContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({ id: "ex-1" });
  });
  afterEach(() => jest.restoreAllMocks());

  it("preserves the original granular muscle/equipment arrays when only the name changes", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([buildExercise()]);
    const revisionBefore = useExerciseLibrary.getState().revision;

    const { getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ExerciseEditorContainer />),
    );

    fireEvent.changeText(getByTestId("exercise-form-name"), "Flat Bench Press");
    await act(async () => {
      fireEvent.press(getByTestId("exercise-editor-save"));
    });

    const [pending] = storage.getPendingMutations();
    expect(pending.method).toBe("PATCH");
    const payload = JSON.parse(pending.payload);
    expect(payload.name).toBe("Flat Bench Press");
    // Untouched pickers → original granular arrays preserved verbatim.
    expect(payload.primary_muscles).toEqual(["chest"]);
    expect(payload.secondary_muscles).toEqual(["triceps"]);
    expect(payload.equipment_required).toEqual(["barbell"]);
    // The library signal bumped so the list re-reads.
    expect(useExerciseLibrary.getState().revision).toBe(revisionBefore + 1);
  });

  it("re-expands a changed primary muscle picker into granular enum keys", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([buildExercise()]);

    const { getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ExerciseEditorContainer />),
    );

    // Change the primary muscle from Chest → Back.
    fireEvent.press(getByTestId("exercise-form-primary-Back"));
    await act(async () => {
      fireEvent.press(getByTestId("exercise-editor-save"));
    });

    const [pending] = storage.getPendingMutations();
    const payload = JSON.parse(pending.payload);
    expect(payload.primary_muscles).toEqual(["back", "lats"]);
    // Equipment was untouched → still preserved.
    expect(payload.equipment_required).toEqual(["barbell"]);
  });

  it("re-expands a changed equipment picker", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([buildExercise()]);

    const { getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ExerciseEditorContainer />),
    );

    fireEvent.press(getByTestId("exercise-form-equipment-Dumbbell"));
    await act(async () => {
      fireEvent.press(getByTestId("exercise-editor-save"));
    });

    const [pending] = storage.getPendingMutations();
    const payload = JSON.parse(pending.payload);
    expect(payload.equipment_required).toEqual(["dumbbell"]);
    // Muscles untouched → preserved.
    expect(payload.primary_muscles).toEqual(["chest"]);
  });

  it("re-expands a changed secondary-muscle picker", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([buildExercise()]);

    const { getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ExerciseEditorContainer />),
    );

    // Seeded secondary = ["Arms"] (from "Triceps"); add Core → changed.
    fireEvent.press(getByTestId("exercise-form-secondary-Core"));
    await act(async () => {
      fireEvent.press(getByTestId("exercise-editor-save"));
    });

    const [pending] = storage.getPendingMutations();
    const payload = JSON.parse(pending.payload);
    // Expanded (not the preserved ["triceps"]) — proves the picker change
    // re-expanded coarse → granular.
    expect(payload.secondary_muscles).toEqual([
      "biceps",
      "triceps",
      "forearms",
      "core",
    ]);
  });

  it("surfaces a validation error and enqueues nothing when the name is too short", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([buildExercise()]);

    const { getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ExerciseEditorContainer />),
    );

    // 1 char passes the presenter's non-empty check but fails the domain
    // min-length rule → updateExerciseCommand returns a ValidationError.
    fireEvent.changeText(getByTestId("exercise-form-name"), "A");
    await act(async () => {
      fireEvent.press(getByTestId("exercise-editor-save"));
    });

    expect(alertSpy).toHaveBeenCalledWith("Invalid input", expect.any(String));
    expect(storage.getPendingMutations()).toHaveLength(0);
  });

  it("retries the load from the error state", async () => {
    const api = new InMemoryApiAdapter();
    const getSpy = jest
      .spyOn(api, "getExercise")
      .mockResolvedValue(fail({ kind: "api", code: "server", message: "x" }));
    const storage = new InMemoryStorageAdapter();

    const { getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ExerciseEditorContainer />),
    );

    await waitFor(() =>
      expect(getByTestId("exercise-editor-error")).toBeTruthy(),
    );
    const callsBefore = getSpy.mock.calls.length;
    await act(async () => {
      fireEvent.press(getByTestId("exercise-editor-retry"));
    });
    expect(getSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("shows the read-only notice for a non-owner and enqueues nothing", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([buildExercise({ createdBy: "someone-else" })]);

    const { getByTestId, queryByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ExerciseEditorContainer />),
    );

    expect(getByTestId("exercise-editor-readonly")).toBeTruthy();
    expect(queryByTestId("exercise-editor-save")).toBeNull();
    expect(storage.getPendingMutations()).toHaveLength(0);
  });

  it("renders the not-found state when the route has no id", () => {
    mockUseLocalSearchParams.mockReturnValue({});
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();

    const { getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ExerciseEditorContainer />),
    );
    expect(getByTestId("exercise-editor-empty")).toBeTruthy();
  });

  it("falls back to a generic message when the validation error carries no fields", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    jest
      .spyOn(updateExerciseCommandModule, "updateExerciseCommand")
      .mockReturnValue({
        ok: false,
        error: { kind: "validation", fields: {} },
      });
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([buildExercise()]);

    const { getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ExerciseEditorContainer />),
    );
    fireEvent.changeText(getByTestId("exercise-form-name"), "Renamed");
    await act(async () => {
      fireEvent.press(getByTestId("exercise-editor-save"));
    });
    expect(alertSpy).toHaveBeenCalledWith(
      "Invalid input",
      "Failed to save changes",
    );
  });
});
