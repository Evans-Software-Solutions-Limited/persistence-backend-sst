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
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
}));

describe("WorkoutsListContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it("delete confirmation calls deleteWorkoutCommand and removes the card", async () => {
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
    const { findByText, queryByText } = renderWithTheme(
      withAdapters(adapters, <WorkoutsListContainer />),
    );

    expect(await findByText("Delete Me")).toBeTruthy();

    fireEvent.press(await findByText("Delete"));

    await waitFor(() => expect(queryByText("Delete Me")).toBeNull());
    // Sync queue should hold a DELETE intent for the workout.
    const pending = storage.getPendingMutations();
    expect(pending).toHaveLength(1);
    expect(pending[0].operation).toBe("delete");
    expect(pending[0].entityId).toBe("w-delete");
  });
});
