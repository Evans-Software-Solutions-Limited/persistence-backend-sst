import { fireEvent, waitFor } from "@testing-library/react-native";
import React from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Workout } from "@/domain/models/workout";
import { fail, ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { WorkoutDetailContainer } from "@/ui/containers/WorkoutDetailContainer";
import { renderWithTheme } from "../../../../__tests__/test-utils";

const buildWorkout = (overrides: Partial<Workout> = {}): Workout => ({
  id: overrides.id ?? "w-1",
  name: overrides.name ?? "Push Day",
  description: overrides.description ?? "Heavy chest session",
  createdBy: "user-1",
  visibility: "private",
  estimatedDurationMinutes: 60,
  exercises: overrides.exercises ?? [
    {
      id: "we-1",
      exerciseId: "ex-bench",
      sortOrder: 1,
      supersetGroup: null,
      targetSets: 4,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetDurationSeconds: null,
      restSeconds: 90,
      notes: null,
      exercise: {
        id: "ex-bench",
        name: "Bench Press",
        category: "strength",
        difficultyLevel: "intermediate",
        videoUrl: null,
        thumbnailUrl: null,
      },
    },
  ],
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

const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();
const mockUseLocalSearchParams = jest.fn(
  () => ({ id: "w-1" }) as Record<string, string>,
);
jest.mock("expo-router", () => ({
  __esModule: true,
  router: {
    back: (...args: unknown[]) => mockRouterBack(...args),
    push: (...args: unknown[]) => mockRouterPush(...args),
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

describe("WorkoutDetailContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({ id: "w-1" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders cached workout name + exercise rows", async () => {
    const api = new InMemoryApiAdapter();
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(buildWorkout()));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", buildWorkout());

    const { findByText } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
    );
    expect(await findByText("Push Day")).toBeTruthy();
    expect(await findByText("Bench Press")).toBeTruthy();
    expect(await findByText("Heavy chest session")).toBeTruthy();
  });

  it("back button calls router.back", async () => {
    const api = new InMemoryApiAdapter();
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(buildWorkout()));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", buildWorkout());

    const { getByTestId, findByText } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
    );
    await findByText("Push Day");
    fireEvent.press(getByTestId("workout-detail-back"));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });

  it("tapping an exercise pushes the exercise detail route", async () => {
    const api = new InMemoryApiAdapter();
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(buildWorkout()));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", buildWorkout());

    const { getByTestId, findByText } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
    );
    await findByText("Bench Press");
    fireEvent.press(getByTestId("workout-detail-exercise-ex-bench"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/exercises/ex-bench");
  });

  it("Start Workout pushes coming-soon with the workout id", async () => {
    const api = new InMemoryApiAdapter();
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(buildWorkout()));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", buildWorkout());

    const { getByTestId, findByText } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
    );
    await findByText("Push Day");
    fireEvent.press(getByTestId("workout-detail-start"));
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/coming-soon?feature=active-session&workoutId=w-1",
    );
  });

  it("renders the loader on cold start when no cached detail", async () => {
    const api = new InMemoryApiAdapter();
    jest
      .spyOn(api, "getWorkout")
      .mockImplementation(() => new Promise(() => {}));
    const storage = new InMemoryStorageAdapter();

    const { getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
    );
    await waitFor(() =>
      expect(getByTestId("workout-detail-loading")).toBeTruthy(),
    );
  });

  it("renders empty placeholder when route param `id` is missing", () => {
    mockUseLocalSearchParams.mockReturnValue({});
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const { queryByText, getByText } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
    );
    // Header falls back to "Workout" when no name is loaded.
    expect(getByText("Workout")).toBeTruthy();
    // No Bench Press content because the workout id never resolved.
    expect(queryByText("Bench Press")).toBeNull();
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
      withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
    );
    expect(await findByTestId("workout-detail-error")).toBeTruthy();
  });
});
