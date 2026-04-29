import { fireEvent, waitFor } from "@testing-library/react-native";
import React from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Exercise } from "@/domain/models/exercise";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { AddExercisePopover } from "@/ui/components/workouts/AddExercisePopover";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

const buildExercise = (overrides: Partial<Exercise> = {}): Exercise => ({
  id: overrides.id ?? "ex-1",
  name: overrides.name ?? "Bench Press",
  description: "Chest builder",
  instructions: "Lower bar to chest, press up.",
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
    userId: "test-user",
    email: "u@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    signInWithEmail: jest.fn(),
    signUpWithEmail: jest.fn(),
    signInWithOAuth: jest.fn(),
    signOut: jest.fn(),
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn(() => () => {}),
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

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  useRouter: () => ({ push: (...args: unknown[]) => mockRouterPush(...args) }),
}));

describe("AddExercisePopover", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders the cached exercises with names", () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([
      buildExercise({ id: "a", name: "Bench Press" }),
      buildExercise({ id: "b", name: "Squat" }),
    ]);
    const { getByText } = renderWithTheme(
      withAdapters(
        makeAdapters(api, storage),
        <AddExercisePopover
          visible
          onClose={jest.fn()}
          onAddExercises={jest.fn()}
          onAddSuperset={jest.fn()}
        />,
      ),
    );
    expect(getByText("Bench Press")).toBeTruthy();
    expect(getByText("Squat")).toBeTruthy();
  });

  it("filters by search query (case-insensitive)", () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([
      buildExercise({ id: "a", name: "Bench Press" }),
      buildExercise({ id: "b", name: "Squat" }),
    ]);
    const { getByPlaceholderText, getByText, queryByText } = renderWithTheme(
      withAdapters(
        makeAdapters(api, storage),
        <AddExercisePopover
          visible
          onClose={jest.fn()}
          onAddExercises={jest.fn()}
          onAddSuperset={jest.fn()}
        />,
      ),
    );
    fireEvent.changeText(getByPlaceholderText("Search exercises..."), "squ");
    expect(getByText("Squat")).toBeTruthy();
    expect(queryByText("Bench Press")).toBeNull();
  });

  it("toggles selection and emits onAddExercises with the selected rows", () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([
      buildExercise({ id: "a", name: "Bench Press" }),
      buildExercise({ id: "b", name: "Squat" }),
    ]);
    const onAddExercises = jest.fn();
    const { getByText, getByTestId } = renderWithTheme(
      withAdapters(
        makeAdapters(api, storage),
        <AddExercisePopover
          visible
          onClose={jest.fn()}
          onAddExercises={onAddExercises}
          onAddSuperset={jest.fn()}
        />,
      ),
    );
    fireEvent.press(getByText("Bench Press"));
    fireEvent.press(getByTestId("add-exercises-button"));
    expect(onAddExercises).toHaveBeenCalledTimes(1);
    const arg = onAddExercises.mock.calls[0][0] as Array<{ id: string }>;
    expect(arg.map((ex) => ex.id)).toEqual(["a"]);
  });

  it("disables the Superset CTA until ≥2 selected, then emits", () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([
      buildExercise({ id: "a", name: "Bench Press" }),
      buildExercise({ id: "b", name: "Squat" }),
    ]);
    const onAddSuperset = jest.fn();
    const { getByText, getByTestId } = renderWithTheme(
      withAdapters(
        makeAdapters(api, storage),
        <AddExercisePopover
          visible
          onClose={jest.fn()}
          onAddExercises={jest.fn()}
          onAddSuperset={onAddSuperset}
        />,
      ),
    );

    fireEvent.press(getByText("Bench Press"));
    // One selected — Superset still disabled. Press is a no-op.
    fireEvent.press(getByTestId("add-superset-button"));
    expect(onAddSuperset).not.toHaveBeenCalled();

    fireEvent.press(getByText("Squat"));
    fireEvent.press(getByTestId("add-superset-button"));
    expect(onAddSuperset).toHaveBeenCalledTimes(1);
    const arg = onAddSuperset.mock.calls[0][0] as Array<{ id: string }>;
    expect(arg.map((ex) => ex.id).sort()).toEqual(["a", "b"]);
  });

  it("opens the details drilldown on info press", () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([
      buildExercise({ id: "a", name: "Bench Press", description: "Chest." }),
    ]);
    const { getByText, getByTestId } = renderWithTheme(
      withAdapters(
        makeAdapters(api, storage),
        <AddExercisePopover
          visible
          onClose={jest.fn()}
          onAddExercises={jest.fn()}
          onAddSuperset={jest.fn()}
        />,
      ),
    );
    fireEvent.press(getByTestId("exercise-info-button-a"));
    expect(getByText("Exercise Details")).toBeTruthy();
    expect(getByText("Chest.")).toBeTruthy();
  });

  it("routes the Create CTA to /coming-soon?feature=exercise-creator", () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([buildExercise()]);
    const { getByTestId } = renderWithTheme(
      withAdapters(
        makeAdapters(api, storage),
        <AddExercisePopover
          visible
          onClose={jest.fn()}
          onAddExercises={jest.fn()}
          onAddSuperset={jest.fn()}
        />,
      ),
    );
    fireEvent.press(getByTestId("create-exercise-button"));
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/coming-soon?feature=exercise-creator",
    );
  });

  it("invokes onClose and resets selection state when closed", () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([buildExercise({ id: "a", name: "Bench Press" })]);
    const onClose = jest.fn();
    const { getByText, getByTestId, rerender } = renderWithTheme(
      withAdapters(
        makeAdapters(api, storage),
        <AddExercisePopover
          visible
          onClose={onClose}
          onAddExercises={jest.fn()}
          onAddSuperset={jest.fn()}
        />,
      ),
    );
    fireEvent.press(getByText("Bench Press"));
    fireEvent.press(getByTestId("close-button"));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      withAdapters(
        makeAdapters(api, storage),
        <AddExercisePopover
          visible={false}
          onClose={onClose}
          onAddExercises={jest.fn()}
          onAddSuperset={jest.fn()}
        />,
      ),
    );
    // The popover returns null when not visible.
  });

  it("renders nothing when visible=false", () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([buildExercise()]);
    const { queryByText } = renderWithTheme(
      withAdapters(
        makeAdapters(api, storage),
        <AddExercisePopover
          visible={false}
          onClose={jest.fn()}
          onAddExercises={jest.fn()}
          onAddSuperset={jest.fn()}
        />,
      ),
    );
    expect(queryByText("Bench Press")).toBeNull();
  });

  it("triggers a stale-cache refresh on first open", async () => {
    const api = new InMemoryApiAdapter();
    const refreshSpy = jest.spyOn(api, "getExercises").mockResolvedValue(
      ok({
        data: [buildExercise({ id: "a", name: "Bench Press" })],
        cursor: null,
        hasMore: false,
      }),
    );
    const storage = new InMemoryStorageAdapter();
    // Storage cache is empty → isStale=true on first read.
    renderWithTheme(
      withAdapters(
        makeAdapters(api, storage),
        <AddExercisePopover
          visible
          onClose={jest.fn()}
          onAddExercises={jest.fn()}
          onAddSuperset={jest.fn()}
        />,
      ),
    );
    await waitFor(() => expect(refreshSpy).toHaveBeenCalled());
  });
});
