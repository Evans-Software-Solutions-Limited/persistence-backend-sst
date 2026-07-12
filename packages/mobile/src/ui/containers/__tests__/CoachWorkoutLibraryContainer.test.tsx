import { fireEvent, waitFor } from "@testing-library/react-native";
import React from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Workout } from "@/domain/models/workout";
import { fail, ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { useUserMode } from "@/state/user-mode";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { CoachWorkoutLibraryContainer } from "@/ui/containers/CoachWorkoutLibraryContainer";
import { renderWithTheme } from "../../../../__tests__/test-utils";

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
    push: (...args: unknown[]) => mockPush(...args),
    back: (...args: unknown[]) => mockBack(...args),
  },
  // Invoke the focus callback once on mount. A jest.mock factory is hoisted
  // above imports, so `require` is the only way to reach React here.
  useFocusEffect: (cb: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useEffect } = require("react");
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
      cb();
    }, []);
  },
}));

const buildWorkout = (overrides: Partial<Workout> = {}): Workout => ({
  id: overrides.id ?? "w-1",
  name: overrides.name ?? "Push Day",
  description: null,
  createdBy: "user-1",
  visibility: "private",
  estimatedDurationMinutes: 45,
  showInOwnerLibrary: overrides.showInOwnerLibrary ?? true,
  exercises: overrides.exercises ?? [],
  createdAt: "2026-04-28T00:00:00Z",
  updatedAt: "2026-04-28T00:00:00Z",
  ...overrides,
});

function makeAdapters(api: InMemoryApiAdapter): Adapters {
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: "user-1",
    email: "u@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  return {
    api,
    auth,
    storage: new InMemoryStorageAdapter(),
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
    netInfo: {} as Adapters["netInfo"],
  };
}

function withAdapters(adapters: Adapters, ui: React.ReactElement) {
  return <AdapterProvider adapters={adapters}>{ui}</AdapterProvider>;
}

describe("CoachWorkoutLibraryContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useUserMode.setState({ mode: "coach", isTrainerEligible: true });
  });

  it("redirects a non-coach to the tabs index", async () => {
    useUserMode.setState({ mode: "athlete", isTrainerEligible: false });
    const api = new InMemoryApiAdapter();
    renderWithTheme(
      withAdapters(makeAdapters(api), <CoachWorkoutLibraryContainer />),
    );
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/(app)/(tabs)"),
    );
  });

  it("lists the coach's authored workouts UNFILTERED (owner-visible or not)", async () => {
    const api = new InMemoryApiAdapter();
    jest.spyOn(api, "getWorkouts").mockResolvedValue(
      ok({
        workouts: [
          buildWorkout({
            id: "w-1",
            name: "Personal",
            showInOwnerLibrary: true,
          }),
          buildWorkout({
            id: "w-2",
            name: "Client Only",
            showInOwnerLibrary: false,
          }),
        ],
        total: 2,
        quota: null,
      }),
    );
    const { findByText, getByText } = renderWithTheme(
      withAdapters(makeAdapters(api), <CoachWorkoutLibraryContainer />),
    );
    expect(await findByText("Personal")).toBeTruthy();
    expect(getByText("Client Only")).toBeTruthy();
    // Fetches mine WITHOUT ownerLibraryOnly (coach sees everything they made).
    expect(api.getWorkouts).toHaveBeenCalledWith({ type: "mine" });
  });

  it("Create workout CTA pushes the creator in coach context", async () => {
    const api = new InMemoryApiAdapter();
    jest
      .spyOn(api, "getWorkouts")
      .mockResolvedValue(ok({ workouts: [], total: 0, quota: null }));
    const { findByTestId, getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api), <CoachWorkoutLibraryContainer />),
    );
    fireEvent.press(await findByTestId("coach-library-create"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/workouts/create?ctx=coach");
    // Empty state renders when there are no workouts.
    expect(getByTestId("coach-library-empty")).toBeTruthy();
  });

  it("tapping a row edits it in coach context", async () => {
    const api = new InMemoryApiAdapter();
    jest
      .spyOn(api, "getWorkouts")
      .mockResolvedValue(
        ok({ workouts: [buildWorkout({ id: "w-9" })], total: 1, quota: null }),
      );
    const { findByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api), <CoachWorkoutLibraryContainer />),
    );
    fireEvent.press(await findByTestId("coach-library-row-w-9"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/workouts/w-9/edit?ctx=coach");
  });

  it("shows the error state (default copy) and retries on tap", async () => {
    const api = new InMemoryApiAdapter();
    const spy = jest
      .spyOn(api, "getWorkouts")
      .mockResolvedValue(fail({ kind: "api", code: "server", message: "" }));
    const { findByTestId, getByText } = renderWithTheme(
      withAdapters(makeAdapters(api), <CoachWorkoutLibraryContainer />),
    );
    const retry = await findByTestId("coach-library-retry");
    // Empty message → default copy.
    expect(getByText("Something went wrong")).toBeTruthy();
    // Retry drives a fresh (refresh) load.
    fireEvent.press(retry);
    await waitFor(() =>
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });
});
