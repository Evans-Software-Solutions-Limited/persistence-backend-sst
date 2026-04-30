import { act, fireEvent, waitFor } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Workout } from "@/domain/models/workout";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { WorkoutsListContainer } from "@/ui/containers/WorkoutsListContainer";
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

// expo-router pieces — stub so tests don't need a real navigator.
// `mock`-prefixed names are the only out-of-scope refs jest.mock() factories
// are allowed to access.
const mockRouterPush = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({}));
jest.mock("expo-router", () => ({
  __esModule: true,
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

describe("WorkoutsListContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Tests in this file install spies via `jest.spyOn` (e.g. on
    // Alert.alert in the delete-confirmation test). `clearAllMocks` only
    // clears call history; implementations persist into subsequent
    // tests, which contributed to a CI flake where leftover spies +
    // accumulated worker load pushed later tests past the 5s default.
    jest.restoreAllMocks();
  });

  it("renders the cached payload on mount", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const cachedWorkout = buildWorkout({ id: "w-cached", name: "Cached Push" });
    storage.cacheWorkoutsList("test-user", "mine", [cachedWorkout], {
      used: 1,
      limit: 50,
    });
    storage.cacheWorkoutsList("test-user", "assigned", [], null);
    storage.cacheWorkoutsList("test-user", "default", [], null);

    const adapters = makeAdapters(api, storage);
    const { findByText } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );

    // Cached workout renders immediately. Auto-refresh behaviour is
    // covered by useWorkouts.test.tsx — this test just asserts the
    // container's cache-first read pipes into the presenter.
    expect(await findByText("Cached Push")).toBeTruthy();
  });

  it("renders the search-results section when the user types into the search bar", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutsList(
      "test-user",
      "mine",
      [
        buildWorkout({ id: "w-1", name: "Push Day" }),
        buildWorkout({ id: "w-2", name: "Pull Day" }),
      ],
      { used: 2, limit: 50 },
    );
    storage.cacheWorkoutsList("test-user", "assigned", [], null);
    storage.cacheWorkoutsList("test-user", "default", [], null);

    const adapters = makeAdapters(api, storage);
    const { findByTestId, findByText, queryByText } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );

    const searchInput = await findByTestId("workouts-search-input");
    await act(async () => {
      fireEvent.changeText(searchInput, "push");
    });

    // Search-results header appears, only Push Day matches.
    expect(await findByText("Search Results (1)")).toBeTruthy();
    expect(await findByText("Push Day")).toBeTruthy();
    await waitFor(() => expect(queryByText("Pull Day")).toBeNull());
  });

  it("opens and closes the popover when a card is pressed", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutsList(
      "test-user",
      "mine",
      [buildWorkout({ id: "w-1", name: "Push Day" })],
      null,
    );
    storage.cacheWorkoutsList("test-user", "assigned", [], null);
    storage.cacheWorkoutsList("test-user", "default", [], null);

    const adapters = makeAdapters(api, storage);
    const { findByText, queryByTestId, getByTestId } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );

    // Press the card → popover opens.
    const card = await findByText("Push Day");
    fireEvent.press(card);
    await waitFor(() => expect(getByTestId("popover")).toBeTruthy());

    // Close button → popover dismisses.
    const closeButton = getByTestId("close-button");
    fireEvent.press(closeButton);
    await waitFor(() => expect(queryByTestId("popover")).toBeNull());
  });

  it("delete confirmation enqueues a DELETE sync intent and clears the storage cache", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const w = buildWorkout({ id: "w-delete", name: "Delete Me" });
    storage.cacheWorkoutsList("test-user", "mine", [w], null);
    storage.cacheWorkoutsList("test-user", "assigned", [], null);
    storage.cacheWorkoutsList("test-user", "default", [], null);

    // Auto-confirm the destructive Alert button so the deletion path runs.
    jest
      .spyOn(Alert, "alert")
      .mockImplementation((_title, _message, buttons) => {
        const destructive = buttons?.find((b) => b.style === "destructive");
        destructive?.onPress?.();
      });

    const adapters = makeAdapters(api, storage);
    const { findByText } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );

    expect(await findByText("Delete Me")).toBeTruthy();

    await act(async () => {
      fireEvent.press(await findByText("Delete"));
    });

    // Assert on the deterministic side-effects rather than DOM updates,
    // which are subject to refresh-promise scheduling timing in CI:
    // the sync queue holds the DELETE intent, and the storage cache row
    // for the workout has been pruned. Container's refresh-after-delete
    // is exercised by the useWorkouts hook tests separately.
    const pending = storage.getPendingMutations();
    expect(pending).toHaveLength(1);
    expect(pending[0].operation).toBe("delete");
    expect(pending[0].entityId).toBe("w-delete");
    expect(
      storage.getCachedWorkoutsList("test-user", "mine")?.workouts,
    ).toEqual([]);
    expect(storage.getCachedWorkoutDetail("test-user", "w-delete")).toBeNull();
  });

  it("create button routes to the workout-creator modal when under quota", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutsList("test-user", "mine", [], { used: 0, limit: 3 });
    storage.cacheWorkoutsList("test-user", "assigned", [], null);
    storage.cacheWorkoutsList("test-user", "default", [], null);

    const adapters = makeAdapters(api, storage);
    const { findByText } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );

    fireEvent.press(await findByText("Create New Workout"));

    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/workouts/create");
  });

  // Per-test 30s timeout: this test passes in ~200ms locally and in
  // isolation, but in CI's loaded jest worker the multi-step async chain
  // (auth setTimeout → setSnapshot → viewModel memo → at-limit indicator
  // render) occasionally exceeds the 5s default. The timeout doesn't
  // mask logic bugs (any failure surfaces well before 30s); it just
  // gives findByText's polling room when the worker is under load.
  it("at-limit users see the WorkoutLimitIndicator + Upgrade CTA route to the subscription placeholder", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutsList(
      "test-user",
      "mine",
      [buildWorkout({ id: "w-1", name: "Push Day" })],
      { used: 3, limit: 3 },
    );
    storage.cacheWorkoutsList("test-user", "assigned", [], null);
    storage.cacheWorkoutsList("test-user", "default", [], null);

    const adapters = makeAdapters(api, storage);
    const { findByText } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );

    // Wait for the cached payload to render (proves auth bootstrap
    // fired and the quota-bearing snapshot has propagated).
    expect(await findByText("Push Day")).toBeTruthy();

    // Click "Upgrade Now" inside the quota indicator — that's the
    // explicit at-limit path. The QuickActions Create button is
    // `disabled={isAtLimit}` and its press is suppressed by RN, so it
    // doesn't have its own at-limit branch (matches legacy).
    fireEvent.press(await findByText("Upgrade Now"));
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/coming-soon?feature=subscription",
    );
  }, 30_000);

  it("browse-exercises button routes to the Exercises tab", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutsList("test-user", "mine", [], null);
    storage.cacheWorkoutsList("test-user", "assigned", [], null);
    storage.cacheWorkoutsList("test-user", "default", [], null);

    const adapters = makeAdapters(api, storage);
    const { findByText } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );

    fireEvent.press(await findByText("Browse Exercises"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/(tabs)/exercises");
  });

  it("edit button routes to the editor modal; popover Start CTA stubs to active-session", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const w = buildWorkout({ id: "w-1", name: "Push Day" });
    storage.cacheWorkoutsList("test-user", "mine", [w], null);
    storage.cacheWorkoutsList("test-user", "assigned", [], null);
    storage.cacheWorkoutsList("test-user", "default", [], null);

    const adapters = makeAdapters(api, storage);
    const { findByText, getByText } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );

    // Edit CTA on the card → workout-editor modal.
    fireEvent.press(await findByText("Edit"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/workouts/w-1/edit");

    // Open the popover → Start Workout button (M3 placeholder).
    fireEvent.press(await findByText("Push Day"));
    fireEvent.press(getByText("Start Workout"));
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/coming-soon?feature=active-session",
    );
  });

  it("opens the popover automatically when the route param matches a cached workout (deeplink)", async () => {
    // Persistent return — the container reads useLocalSearchParams on
    // every render until the deeplink effect commits.
    mockUseLocalSearchParams.mockReturnValue({ workoutId: "w-deep" });
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const w = buildWorkout({ id: "w-deep", name: "Deeplinked Workout" });
    storage.cacheWorkoutsList("test-user", "mine", [w], null);
    storage.cacheWorkoutsList("test-user", "assigned", [], null);
    storage.cacheWorkoutsList("test-user", "default", [], null);

    const adapters = makeAdapters(api, storage);
    const { findByTestId } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );

    // Popover should auto-open with the deeplinked workout.
    expect(await findByTestId("popover")).toBeTruthy();

    // Reset the persistent mock so it doesn't leak into subsequent tests.
    mockUseLocalSearchParams.mockReturnValue({});
  });

  it("ignores unknown route-param workout ids (no popover opens)", async () => {
    mockUseLocalSearchParams.mockReturnValue({ workoutId: "missing" });
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutsList(
      "test-user",
      "mine",
      [buildWorkout({ id: "w-1", name: "Push Day" })],
      null,
    );
    storage.cacheWorkoutsList("test-user", "assigned", [], null);
    storage.cacheWorkoutsList("test-user", "default", [], null);

    const adapters = makeAdapters(api, storage);
    const { findByText, queryByTestId } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );

    // Wait for the list to render so the deeplink effect has run.
    expect(await findByText("Push Day")).toBeTruthy();
    expect(queryByTestId("popover")).toBeNull();

    mockUseLocalSearchParams.mockReturnValue({});
  });
});
