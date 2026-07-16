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
    // Fire the auth-state callback synchronously at registration
    // time. The legacy mock deferred this via `setTimeout(... , 0)`
    // to mimic Supabase's INITIAL_SESSION event, but the resulting
    // unwrapped `setSession` setState (fired from a macrotask after
    // render commit) raced with `findByTestId` polling under CI load
    // and intermittently pushed the test past its 5 s outer timeout.
    // Synchronous firing collapses the bootstrap into a single
    // render commit — no macrotask race, no unwrapped-act warning,
    // same observable behaviour for the consumer.
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

function seedCache(storage: InMemoryStorageAdapter, exercises: Exercise[]) {
  storage.cacheExercises(exercises);
  // Stamp `lastSyncedAt` so `getExercisesQuery(...).isStale` returns
  // false on mount and the popover's `useEffect`-driven background
  // `refreshExerciseCache` is a no-op for these tests. Without this,
  // every test races against an unresolved refresh promise inside
  // React Testing Library's `act()` window — locally that races
  // benignly, but on CI runners the test occasionally times out
  // before the data render commits (PR-3 CI flake on the third test
  // in this file). Tests that DO want to exercise the stale-refresh
  // path can `storage.setLastSyncedAt("exercises", olderIso)` after
  // seeding to override.
  storage.setLastSyncedAt("exercises", new Date().toISOString());
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

  /**
   * Per-test timeout bumped from the default 5 s to 15 s. This case
   * hit a CI-only 5 s timeout consistently across PR-3's CI runs
   * even after two unrelated flake hypotheses (`seedCache`
   * `lastSyncedAt` stamping; auth-mock `setTimeout` removal) — both
   * fixes stayed in because they were real concurrency improvements,
   * but neither was the actual cause. The third test in this suite
   * is the first to assert on a data-driven testID; under GHA-runner
   * load (slower CPU + cold caches) the React-Native test-renderer
   * commit + synchronous auth bootstrap + seedCache memo chain land
   * just close enough to 5 s that `findByTestId` intermittently
   * overshoots. Tests 4-15 do the same data-driven queries and
   * pass — the suite must be warm by then. Locally this test runs
   * in ~150 ms; the 15 s ceiling gives ~100× headroom while still
   * being short enough to flag a real regression.
   */
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
  }, 15000);

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

  it("resets search + selection after a successful Swap (next open starts fresh — bugbot regression)", async () => {
    // The component stays mounted when `visible` flips to false (parent
    // sets pickerMode=null), so without resetting on the swap-success
    // path the user's previous search query persists into the next
    // open and silently filters out exercises they expect to see.
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [
      buildExercise({ id: "ex-1", name: "Bench Press" }),
      buildExercise({ id: "ex-2", name: "Row" }),
    ]);
    const Wrapper = ({ visible }: { visible: boolean }) => (
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover
          visible={visible}
          onClose={jest.fn()}
          onSwap={jest.fn()}
        />
      </AdapterProvider>
    );
    const { findByTestId, rerender } = renderWithTheme(
      <Wrapper visible={true} />,
    );
    // Type a search query, pick a row, fire Swap.
    const search = await findByTestId("swap-picker-search");
    fireEvent.changeText(search, "bench");
    fireEvent.press(await findByTestId("exercise-row-ex-1"));
    fireEvent.press(await findByTestId("swap-picker-swap"));

    // Parent flips visibility off, then back on (a new pickerMode).
    rerender(<Wrapper visible={false} />);
    rerender(<Wrapper visible={true} />);

    // Search field should be empty on re-open, NOT carrying "bench".
    const searchAfter = await findByTestId("swap-picker-search");
    expect(searchAfter.props.value).toBe("");
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

  it("Create button closes the picker and routes to the real /exercises/create", async () => {
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
    fireEvent.press(await findByTestId("swap-picker-create"));
    expect(onClose).toHaveBeenCalled();
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/exercises/create");
  });

  it("disables every exercise in `existingExerciseIds` (Brad's no-duplicates rule — covers the source row + all other in-session rows)", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [
      buildExercise({ id: "ex-source", name: "Bench Press" }),
      buildExercise({ id: "ex-already-in", name: "Row" }),
      buildExercise({ id: "ex-free", name: "Pulldown" }),
    ]);
    const onSwap = jest.fn();

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover
          visible={true}
          onClose={jest.fn()}
          onSwap={onSwap}
          // Container passes ALL non-substituted in-session exercise
          // IDs (the source IS in the session, so it's covered).
          existingExerciseIds={["ex-source", "ex-already-in"]}
        />
      </AdapterProvider>,
    );
    // Both disabled rows are no-ops on press.
    fireEvent.press(await findByTestId("exercise-row-ex-source"));
    fireEvent.press(await findByTestId("exercise-row-ex-already-in"));
    fireEvent.press(await findByTestId("swap-picker-swap"));
    expect(onSwap).not.toHaveBeenCalled();
    // The free row is interactive.
    fireEvent.press(await findByTestId("exercise-row-ex-free"));
    fireEvent.press(await findByTestId("swap-picker-swap"));
    expect(onSwap).toHaveBeenCalledTimes(1);
    expect(onSwap.mock.calls[0][0][0].id).toBe("ex-free");
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

  it("exposes accessible names for the icon-only close, clear-search, and back-to-list controls", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = new InMemoryApiAdapter();
    seedCache(storage, [buildExercise({ id: "ex-1", name: "Bench Press" })]);

    const { findByLabelText, findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover
          visible={true}
          onClose={jest.fn()}
          onSwap={jest.fn()}
        />
      </AdapterProvider>,
    );
    expect(await findByLabelText("Close")).toBeTruthy();
    const search = await findByTestId("swap-picker-search");
    fireEvent.changeText(search, "bench");
    expect(await findByLabelText("Clear search")).toBeTruthy();
    fireEvent.press(await findByTestId("exercise-info-button-ex-1"));
    expect(await findByLabelText("Back to list")).toBeTruthy();
  });
});
