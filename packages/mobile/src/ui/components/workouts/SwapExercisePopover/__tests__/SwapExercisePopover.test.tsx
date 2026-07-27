/**
 * `SwapExercisePopover` after spec-21 T-2.7 — a thin adapter over the shared
 * `<EquipmentAwareSwapSheet>`.
 *
 * ⚠ This suite was REWRITTEN, not extended. The previous 18 tests all described
 * the deleted implementation: a full-screen Modal listing the LOCAL exercise
 * cache, narrowed by a client-side primary-muscle memo, with a select-then-Swap
 * two-step, a muscle-filter chip, a details drill-in and a 100-row display
 * ceiling. None of those exist any more — the list is `GET /exercises/substitutes`,
 * ranked and visibility-scoped server-side. Keeping them green would have needed
 * the old code kept alive behind the new one.
 *
 * What survives as behaviour worth pinning is here: the props CONTRACT with
 * `applyPickerSelection` (a single-element array of picker rows), the
 * no-duplicates rule, the Create route, and the cache-resolution guard — the last
 * being genuinely new, and the one that stops a tap silently doing nothing.
 * Everything about the list itself is tested against the shared sheet in
 * `EquipmentAwareSwapSheet/__tests__`.
 */

import { fireEvent, waitFor } from "@testing-library/react-native";
import React from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Exercise } from "@/domain/models/exercise";
import type { SubstituteCandidate } from "@/domain/models/loadout";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { SwapExercisePopover } from "../SwapExercisePopover";
import { renderWithTheme } from "../../../../../../__tests__/test-utils";

/**
 * Same convention as every other heavy container suite here (ProfileContainer,
 * ExerciseListContainer, SubscriptionSelectionContainer…): these mount the real
 * Tamagui provider, a React Query client and gorhom sheet machinery per case,
 * and run alongside 459 other suites on a contended CI runner, where jest's 5 s
 * default is the wrong budget for this shape. See
 * `LoadoutFlowContainer.test.tsx` for the measurement that prompted it.
 */
jest.setTimeout(20_000);

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

const buildCandidate = (
  overrides: Partial<SubstituteCandidate> = {},
): SubstituteCandidate => ({
  id: "ex-incline",
  name: "Incline Press",
  category: "strength",
  difficultyLevel: "intermediate",
  thumbnailUrl: null,
  equipmentRequired: [],
  matchedOn: ["primary_muscles"],
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
    // Fired synchronously at registration rather than through a macrotask: a
    // deferred setState raced RTL's polling under CI load (PR-3 flake).
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

function renderPopover(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
  props: Omit<
    Partial<React.ComponentProps<typeof SwapExercisePopover>>,
    "onSwap" | "onClose"
  > = {},
) {
  const onSwap = jest.fn();
  const onClose = jest.fn();
  const utils = renderWithTheme(
    <AdapterProvider adapters={makeAdapters(storage, api)}>
      <SwapExercisePopover
        visible
        onClose={onClose}
        onSwap={onSwap}
        forExerciseId="ex-bench"
        exerciseName="Bench Press"
        {...props}
      />
    </AdapterProvider>,
  );
  return { ...utils, onSwap, onClose };
}

describe("SwapExercisePopover (T-2.7 adapter)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouterPush.mockClear();
  });

  it("lists candidates from GET /exercises/substitutes, not the local cache", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    // Deliberately cached but NOT returned by the endpoint. The old picker read
    // the cache directly and would have listed this; the new one must not, or the
    // visibility scoping the endpoint exists to enforce is bypassed.
    storage.cacheExercises([
      buildExercise({ id: "ex-cached-only", name: "Cached Only" }),
    ]);
    api.substitutes = {
      best: [],
      others: [buildCandidate()],
      meta: { truncated: false },
    };

    const { findByTestId, queryByTestId } = renderPopover(api, storage);

    expect(await findByTestId("swap-others-ex-incline")).toBeTruthy();
    expect(queryByTestId("swap-others-ex-cached-only")).toBeNull();
  });

  it("sends NO equipment context — an in-session swap doesn't know the room", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const spy = jest.spyOn(api, "getExerciseSubstitutes");
    api.substitutes = {
      best: [],
      others: [buildCandidate()],
      meta: { truncated: false },
    };

    const { findByTestId } = renderPopover(api, storage);
    await findByTestId("swap-others-ex-incline");

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ forExerciseId: "ex-bench" }),
    );
    // Absent, not `[]`. `[]` would be a containment request against nothing —
    // the same outcome by accident rather than by contract.
    expect(spy.mock.calls[0]?.[0]).not.toHaveProperty("equipment");
  });

  it("fires onSwap with EXACTLY ONE picker row (the dispatcher's `rows` loop shape)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([
      buildExercise({ id: "ex-incline", name: "Incline Press" }),
    ]);
    api.substitutes = {
      best: [],
      others: [buildCandidate()],
      meta: { truncated: false },
    };

    const { findByTestId, onSwap } = renderPopover(api, storage);
    fireEvent.press(await findByTestId("swap-others-ex-incline"));

    await waitFor(() => expect(onSwap).toHaveBeenCalledTimes(1));
    const rows = onSwap.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    // Snake-case picker-row shape, not the camelCase candidate — this is what
    // `AddExerciseList` / `resolvePickerExercise` consume.
    expect(rows[0]).toEqual(expect.objectContaining({ id: "ex-incline" }));
  });

  it("refreshes the exercise cache once, then retries, when the pick isn't cached", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.substitutes = {
      best: [],
      others: [buildCandidate()],
      meta: { truncated: false },
    };
    // The refresh is what makes the server-visible exercise resolvable.
    const refresh = jest
      .spyOn(api, "getExercises")
      .mockImplementation(async () => {
        storage.cacheExercises([
          buildExercise({ id: "ex-incline", name: "Incline Press" }),
        ]);
        return ok({
          data: [buildExercise({ id: "ex-incline", name: "Incline Press" })],
          hasMore: false,
          cursor: null,
        });
      });

    const { findByTestId, onSwap } = renderPopover(api, storage);
    fireEvent.press(await findByTestId("swap-others-ex-incline"));

    await waitFor(() => expect(onSwap).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalled();
  });

  it("shows an in-sheet message — and does NOT fire onSwap — when the retry still misses", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.substitutes = {
      best: [],
      others: [buildCandidate()],
      meta: { truncated: false },
    };
    jest
      .spyOn(api, "getExercises")
      .mockResolvedValue(ok({ data: [], hasMore: false, cursor: null }));

    const { findByTestId, onSwap } = renderPopover(api, storage);
    fireEvent.press(await findByTestId("swap-others-ex-incline"));

    expect(await findByTestId("swap-sheet-unavailable")).toBeTruthy();
    // The silent no-op this guard exists to prevent.
    expect(onSwap).not.toHaveBeenCalled();
  });

  it("disables every exercise already in the session (no-duplicates rule)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([
      buildExercise({ id: "ex-incline", name: "Incline Press" }),
    ]);
    api.substitutes = {
      best: [],
      others: [buildCandidate()],
      meta: { truncated: false },
    };

    const { findByTestId, onSwap } = renderPopover(api, storage, {
      existingExerciseIds: ["ex-incline"],
    });

    const row = await findByTestId("swap-others-ex-incline");
    expect(row.props.accessibilityState.disabled).toBe(true);
    fireEvent.press(row);
    expect(onSwap).not.toHaveBeenCalled();
  });

  it("Create closes the picker first, then routes to the real creator", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.substitutes = {
      best: [],
      others: [buildCandidate()],
      meta: { truncated: false },
    };

    const { findByTestId, onClose } = renderPopover(api, storage);
    fireEvent.press(await findByTestId("swap-sheet-create"));

    // Order matters: routing with the sheet still open stacks a full-screen
    // creator behind an open bottom sheet.
    expect(onClose).toHaveBeenCalled();
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/exercises/create");
  });

  it("clears a previous row's resolve error when the sheet reopens", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.substitutes = {
      best: [],
      others: [buildCandidate()],
      meta: { truncated: false },
    };
    jest
      .spyOn(api, "getExercises")
      .mockResolvedValue(ok({ data: [], hasMore: false, cursor: null }));

    const onSwap = jest.fn();
    const { findByTestId, queryByTestId, rerender } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover
          visible
          onClose={jest.fn()}
          onSwap={onSwap}
          forExerciseId="ex-bench"
        />
      </AdapterProvider>,
    );
    fireEvent.press(await findByTestId("swap-others-ex-incline"));
    await findByTestId("swap-sheet-unavailable");

    // ⚠ This component NEVER unmounts — the active-session screen renders it
    // unconditionally and drives it by prop — so a sticky error would sit above
    // a perfectly good list on the next swap, naming an exercise the user never
    // touched.
    const close = (
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover
          visible={false}
          onClose={jest.fn()}
          onSwap={onSwap}
          forExerciseId="ex-bench"
        />
      </AdapterProvider>
    );
    rerender(close);
    rerender(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover
          visible
          onClose={jest.fn()}
          onSwap={onSwap}
          forExerciseId="ex-other"
        />
      </AdapterProvider>,
    );

    await waitFor(() =>
      expect(queryByTestId("swap-sheet-unavailable")).toBeNull(),
    );
  });

  it("renders with only its required props (defaults applied)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.substitutes = {
      best: [],
      others: [buildCandidate()],
      meta: { truncated: false },
    };
    // No `forExerciseId`, `exerciseName` or `existingExerciseIds` — the call site
    // legitimately omits them when the source row has fallen out of the session.
    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage, api)}>
        <SwapExercisePopover visible onClose={jest.fn()} onSwap={jest.fn()} />
      </AdapterProvider>,
    );
    // Nothing to rank against → the empty state, not a full library dump.
    expect(await findByTestId("swap-sheet-empty")).toBeTruthy();
  });

  it("renders nothing before it has ever been opened", () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const { queryByTestId } = renderPopover(api, storage, { visible: false });
    expect(queryByTestId("swap-picker-sheet")).toBeNull();
  });
});
