import { act, fireEvent } from "@testing-library/react-native";
import React from "react";

import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Exercise } from "@/domain/models/exercise";
import { fail, ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { ExerciseDetailContainer } from "@/ui/containers/ExerciseDetailContainer";
import { renderWithTheme } from "../../../../__tests__/test-utils";

const buildExercise = (overrides: Partial<Exercise> = {}): Exercise => ({
  id: "ex-1",
  name: "Bench Press",
  description: "Chest day",
  instructions: null,
  category: "strength",
  difficulty: "intermediate",
  primaryMuscleGroups: ["chest"],
  secondaryMuscleGroups: [],
  equipment: ["barbell"],
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

/** Adapters whose auth reports no session (signed-out / pre-bootstrap). */
function makeNoSessionAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
): Adapters {
  const adapters = makeAdapters(api, storage);
  const auth = {
    ...adapters.auth,
    getSession: jest.fn(async () => ok(null)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(null);
      return () => {};
    }),
  } as unknown as Adapters["auth"];
  return { ...adapters, auth };
}

function withAdapters(adapters: Adapters, ui: React.ReactElement) {
  return <AdapterProvider adapters={adapters}>{ui}</AdapterProvider>;
}

const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();
const mockUseLocalSearchParams = jest.fn(
  () => ({ id: "ex-1" }) as Record<string, string>,
);
jest.mock("expo-router", () => ({
  __esModule: true,
  router: {
    back: (...args: unknown[]) => mockRouterBack(...args),
    push: (...args: unknown[]) => mockRouterPush(...args),
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

describe("ExerciseDetailContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({ id: "ex-1" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders the cached exercise and shows Edit for the owner", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([buildExercise({ createdBy: "user-1" })]);

    const { findByText, getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ExerciseDetailContainer />),
    );
    expect(await findByText("Bench Press")).toBeTruthy();
    expect(getByTestId("exercise-detail-edit")).toBeTruthy();
  });

  it("hides Edit for a system exercise the user doesn't own", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([buildExercise({ createdBy: null })]);

    const { findByText, queryByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ExerciseDetailContainer />),
    );
    await findByText("Bench Press");
    expect(queryByTestId("exercise-detail-edit")).toBeNull();
  });

  it("hides Edit for a custom exercise created by another user", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    // Non-null createdBy that differs from the session user → not the owner.
    storage.cacheExercises([buildExercise({ createdBy: "another-user" })]);

    const { findByText, queryByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ExerciseDetailContainer />),
    );
    await findByText("Bench Press");
    expect(queryByTestId("exercise-detail-edit")).toBeNull();
  });

  it("hides Edit when there is no signed-in session", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([buildExercise({ createdBy: "user-1" })]);

    const { findByText, queryByTestId } = renderWithTheme(
      withAdapters(
        makeNoSessionAdapters(api, storage),
        <ExerciseDetailContainer />,
      ),
    );
    await findByText("Bench Press");
    expect(queryByTestId("exercise-detail-edit")).toBeNull();
  });

  it("Edit pushes the owner-only editor route", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([buildExercise({ createdBy: "user-1" })]);

    const { findByText, getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ExerciseDetailContainer />),
    );
    await findByText("Bench Press");
    fireEvent.press(getByTestId("exercise-detail-edit"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/exercises/ex-1/edit");
  });

  it("renders the not-found state when the route has no id", () => {
    mockUseLocalSearchParams.mockReturnValue({});
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();

    const { getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ExerciseDetailContainer />),
    );
    expect(getByTestId("exercise-detail-empty")).toBeTruthy();
  });

  it("renders the error state (exercise stays null) when the load fails with no cache", async () => {
    const api = new InMemoryApiAdapter();
    const getSpy = jest
      .spyOn(api, "getExercise")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "down" }),
      );
    const storage = new InMemoryStorageAdapter();

    const { findByTestId, getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ExerciseDetailContainer />),
    );
    expect(await findByTestId("exercise-detail-error")).toBeTruthy();

    const callsBefore = getSpy.mock.calls.length;
    await act(async () => {
      fireEvent.press(getByTestId("exercise-detail-retry"));
    });
    expect(getSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("Back calls router.back", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([buildExercise({ createdBy: "user-1" })]);

    const { findByText, getByLabelText } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <ExerciseDetailContainer />),
    );
    await findByText("Bench Press");
    fireEvent.press(getByLabelText("Back"));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });
});
