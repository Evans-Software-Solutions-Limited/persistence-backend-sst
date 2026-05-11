import { fireEvent } from "@testing-library/react-native";
import React from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Exercise } from "@/domain/models/exercise";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { SwapExercisePopover } from "../SwapExercisePopover";
import { renderWithTheme } from "../../../../../../__tests__/test-utils";

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: jest.fn(), back: jest.fn() },
  useRouter: () => ({ push: mockRouterPush, back: jest.fn() }),
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

describe("SwapExercisePopover", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouterPush.mockClear();
  });

  it("renders the modal with the legacy chrome — title + close + Create + Swap", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [buildExercise()]);

    const { findByTestId, findByText } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover
          visible={true}
          onClose={jest.fn()}
          onSwap={jest.fn()}
        />
      </AdapterProvider>,
    );
    expect(await findByTestId("swap-picker-modal")).toBeTruthy();
    expect(await findByTestId("swap-picker-close")).toBeTruthy();
    expect(await findByTestId("swap-picker-create")).toBeTruthy();
    expect(await findByTestId("swap-picker-swap")).toBeTruthy();
    expect(await findByTestId("swap-picker-search")).toBeTruthy();
    // Title is the literal legacy SwapExercisePopover string.
    expect(await findByText("Swap Exercise")).toBeTruthy();
  });

  it("Swap button is disabled until exactly one row is selected (single-select semantic)", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [
      buildExercise({ id: "ex-1", name: "Bench Press" }),
      buildExercise({ id: "ex-2", name: "Row" }),
    ]);
    const onSwap = jest.fn();

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover
          visible={true}
          onClose={jest.fn()}
          onSwap={onSwap}
        />
      </AdapterProvider>,
    );
    fireEvent.press(await findByTestId("swap-picker-swap"));
    expect(onSwap).not.toHaveBeenCalled();
  });

  it("Swap fires onSwap with EXACTLY ONE row (single-element array — matches dispatcher's `rows` loop shape)", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [
      buildExercise({ id: "ex-1", name: "Bench Press" }),
      buildExercise({ id: "ex-2", name: "Row" }),
    ]);
    const onSwap = jest.fn();

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover
          visible={true}
          onClose={jest.fn()}
          onSwap={onSwap}
        />
      </AdapterProvider>,
    );
    fireEvent.press(await findByTestId("exercise-row-ex-1"));
    fireEvent.press(await findByTestId("swap-picker-swap"));
    expect(onSwap).toHaveBeenCalledTimes(1);
    const rows = onSwap.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("ex-1");
    expect(rows[0].name).toBe("Bench Press");
  });

  it("tapping a different row replaces the selection (single-select, not additive)", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [
      buildExercise({ id: "ex-1", name: "Bench Press" }),
      buildExercise({ id: "ex-2", name: "Row" }),
    ]);
    const onSwap = jest.fn();

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover
          visible={true}
          onClose={jest.fn()}
          onSwap={onSwap}
        />
      </AdapterProvider>,
    );
    fireEvent.press(await findByTestId("exercise-row-ex-1"));
    fireEvent.press(await findByTestId("exercise-row-ex-2"));
    fireEvent.press(await findByTestId("swap-picker-swap"));
    const rows = onSwap.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("ex-2");
  });

  it("tapping the currently-selected row clears the selection (deselect)", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [buildExercise({ id: "ex-1", name: "Bench Press" })]);
    const onSwap = jest.fn();

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover
          visible={true}
          onClose={jest.fn()}
          onSwap={onSwap}
        />
      </AdapterProvider>,
    );
    fireEvent.press(await findByTestId("exercise-row-ex-1"));
    fireEvent.press(await findByTestId("exercise-row-ex-1"));
    fireEvent.press(await findByTestId("swap-picker-swap"));
    expect(onSwap).not.toHaveBeenCalled();
  });

  it("close button calls onClose and resets internal selection", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [buildExercise({ id: "ex-1", name: "Bench Press" })]);
    const onClose = jest.fn();

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover
          visible={true}
          onClose={onClose}
          onSwap={jest.fn()}
        />
      </AdapterProvider>,
    );
    fireEvent.press(await findByTestId("swap-picker-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when visible=false (Modal short-circuits in test tree)", () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [buildExercise()]);

    const { queryByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover
          visible={false}
          onClose={jest.fn()}
          onSwap={jest.fn()}
        />
      </AdapterProvider>,
    );
    expect(queryByTestId("swap-picker-modal")).toBeNull();
  });

  it("Create button routes to the coming-soon stub (legacy parity — Create CTA isn't a swap action)", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [buildExercise({ id: "ex-1", name: "Bench Press" })]);

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover
          visible={true}
          onClose={jest.fn()}
          onSwap={jest.fn()}
        />
      </AdapterProvider>,
    );
    fireEvent.press(await findByTestId("swap-picker-create"));
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/coming-soon?feature=exercise-creator",
    );
  });

  it("disables the source exercise (currentExerciseId) so the user can't no-op-swap to itself", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [
      buildExercise({ id: "ex-source", name: "Bench Press" }),
      buildExercise({ id: "ex-other", name: "Row" }),
    ]);
    const onSwap = jest.fn();

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover
          visible={true}
          onClose={jest.fn()}
          onSwap={onSwap}
          currentExerciseId="ex-source"
        />
      </AdapterProvider>,
    );
    // Tapping the source row should NOT toggle selection — the row is
    // disabled, so the touchable is a no-op. Following Swap remains
    // disabled-and-no-op too.
    fireEvent.press(await findByTestId("exercise-row-ex-source"));
    fireEvent.press(await findByTestId("swap-picker-swap"));
    expect(onSwap).not.toHaveBeenCalled();
    // The other (non-source) row stays interactive.
    fireEvent.press(await findByTestId("exercise-row-ex-other"));
    fireEvent.press(await findByTestId("swap-picker-swap"));
    expect(onSwap).toHaveBeenCalledTimes(1);
    expect(onSwap.mock.calls[0][0][0].id).toBe("ex-other");
  });

  it("renders the muscle-filter chip when filterMuscleGroupLabels is non-empty (Story-004 visible-filter chrome)", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [buildExercise({ id: "ex-1", name: "Bench Press" })]);

    const { findByTestId, findByText } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover
          visible={true}
          onClose={jest.fn()}
          onSwap={jest.fn()}
          filterMuscleGroupLabels={["Chest", "Triceps"]}
        />
      </AdapterProvider>,
    );
    expect(await findByTestId("swap-picker-modal")).toBeTruthy();
    expect(await findByTestId("swap-picker-muscle-filter")).toBeTruthy();
    // The labels are rendered as a comma-separated emphasised span
    // inside the chip — assert via findByText so we don't have to
    // serialise the React-Native props tree (which has circular
    // Provider refs).
    expect(await findByText("Chest, Triceps")).toBeTruthy();
  });

  it("hides the muscle-filter chip when filterMuscleGroupLabels is empty (no chrome unless filtered)", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [buildExercise({ id: "ex-1", name: "Bench Press" })]);

    const { findByTestId, queryByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover
          visible={true}
          onClose={jest.fn()}
          onSwap={jest.fn()}
          filterMuscleGroupLabels={[]}
        />
      </AdapterProvider>,
    );
    await findByTestId("swap-picker-modal");
    expect(queryByTestId("swap-picker-muscle-filter")).toBeNull();
  });

  it("filterByPrimaryMuscleGroups narrows the list to entries whose primaryMuscleGroups overlap (Story-004 AC)", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [
      buildExercise({
        id: "ex-bench",
        name: "Bench Press",
        primaryMuscleGroups: ["chest"],
      }),
      buildExercise({
        id: "ex-row",
        name: "Row",
        primaryMuscleGroups: ["back"],
      }),
      buildExercise({
        id: "ex-incline",
        name: "Incline Press",
        primaryMuscleGroups: ["chest", "shoulders"],
      }),
    ]);

    const { findByTestId, queryByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover
          visible={true}
          onClose={jest.fn()}
          onSwap={jest.fn()}
          filterByPrimaryMuscleGroups={["chest"]}
        />
      </AdapterProvider>,
    );
    // Chest-overlapping rows survive…
    expect(await findByTestId("exercise-row-ex-bench")).toBeTruthy();
    expect(await findByTestId("exercise-row-ex-incline")).toBeTruthy();
    // …back-only row is filtered out.
    expect(queryByTestId("exercise-row-ex-row")).toBeNull();
  });

  it("info icon drills into the details view; back button returns to the list", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [buildExercise({ id: "ex-1", name: "Bench Press" })]);
    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover
          visible={true}
          onClose={jest.fn()}
          onSwap={jest.fn()}
        />
      </AdapterProvider>,
    );
    fireEvent.press(await findByTestId("exercise-info-button-ex-1"));
    const backButton = await findByTestId("swap-picker-details-back");
    expect(backButton).toBeTruthy();
    fireEvent.press(backButton);
    expect(await findByTestId("swap-picker-search")).toBeTruthy();
  });

  it("clear-search button empties the query field", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [buildExercise({ id: "ex-1", name: "Bench Press" })]);
    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover
          visible={true}
          onClose={jest.fn()}
          onSwap={jest.fn()}
        />
      </AdapterProvider>,
    );
    const search = await findByTestId("swap-picker-search");
    fireEvent.changeText(search, "bench");
    expect(search.props.value).toBe("bench");
    fireEvent.press(await findByTestId("swap-picker-clear-search"));
    expect(search.props.value).toBe("");
  });

  it("respects the 100-row display ceiling when the library is larger", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    const many = Array.from({ length: 105 }, (_, i) =>
      buildExercise({ id: `ex-${i}`, name: `Exercise ${i}` }),
    );
    seedCache(storage, many);
    const { findByTestId, queryByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover
          visible={true}
          onClose={jest.fn()}
          onSwap={jest.fn()}
        />
      </AdapterProvider>,
    );
    expect(await findByTestId("exercise-row-ex-0")).toBeTruthy();
    expect(await findByTestId("exercise-row-ex-99")).toBeTruthy();
    expect(queryByTestId("exercise-row-ex-100")).toBeNull();
  });
});
