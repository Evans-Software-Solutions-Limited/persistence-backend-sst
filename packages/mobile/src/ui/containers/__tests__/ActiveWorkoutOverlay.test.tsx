import type { ReactNode } from "react";

// Mock expo-router — control the route segments + capture navigation.
const mockPush = jest.fn();
let mockSegments: string[] = [];
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useSegments: () => mockSegments,
}));

// eslint-disable-next-line import/first
import { renderWithTheme, waitFor } from "../../../../__tests__/test-utils";
// eslint-disable-next-line import/first
import { fireEvent } from "@testing-library/react-native";
// eslint-disable-next-line import/first
import { Alert } from "react-native";
// eslint-disable-next-line import/first
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
// eslint-disable-next-line import/first
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
// eslint-disable-next-line import/first
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
// eslint-disable-next-line import/first
import { StubHealthAdapter } from "@/adapters/health";
// eslint-disable-next-line import/first
import { StubNotificationsAdapter } from "@/adapters/notifications";
// eslint-disable-next-line import/first
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
// eslint-disable-next-line import/first
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
// eslint-disable-next-line import/first
import type { WorkoutSession } from "@/domain/models/session";
// eslint-disable-next-line import/first
import type { Adapters } from "@/shared/types";
// eslint-disable-next-line import/first
import { AdapterProvider } from "@/ui/hooks/useAdapters";
// eslint-disable-next-line import/first
import { useActiveWorkout } from "@/state/active-workout";
// eslint-disable-next-line import/first
import { ActiveWorkoutOverlay } from "../ActiveWorkoutOverlay";

/**
 * <ActiveWorkoutOverlay> tests — Hybrid Option A: bar-only, SQLite-existence +
 * segment-gated visibility, tab-bar-aware positioning, expand + end wiring.
 *
 * Spec: specs/05-active-session/requirements.md STORY-006
 *       tasks.md T-05.2.2 / T-05.2.3 / T-05.2.4
 */

const USER = "u-1";

function makeAdapters() {
  const storage = new InMemoryStorageAdapter();
  const auth = new InMemoryAuthAdapter();
  const adapters: Adapters = {
    api: new InMemoryApiAdapter(),
    auth,
    storage,
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new MockPaymentsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
  };
  return { adapters, storage, auth };
}

function signIn(auth: InMemoryAuthAdapter) {
  auth.currentSession = {
    accessToken: "tok",
    refreshToken: "rtok",
    userId: USER,
    email: "x@y.com",
    expiresAt: Date.now() + 3_600_000,
  };
}

function makeSession(overrides: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: "local-abc",
    userId: USER,
    workoutId: "w-1",
    name: "Upper Body",
    status: "in_progress",
    startedAt: new Date(Date.now() - 65_000).toISOString(),
    completedAt: null,
    exercises: [
      {
        id: "se-1",
        sessionId: "local-abc",
        exerciseId: "ex-1",
        exerciseName: "Bench",
        sortOrder: 0,
        supersetGroup: null,
        isSubstituted: false,
        originalExerciseId: null,
        notes: null,
        sets: [
          {
            id: "set-1",
            sessionExerciseId: "se-1",
            setNumber: 1,
            weightKg: 60,
            reps: 8,
            rpe: null,
            durationSeconds: null,
            distanceMeters: null,
            isCompleted: true,
            completedAt: new Date().toISOString(),
          },
        ],
      },
    ],
    notes: null,
    ...overrides,
  };
}

function renderOverlay(
  adapters: Adapters,
  confirmEnd?: (onConfirm: () => void) => void,
) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
  );
  return renderWithTheme(
    <Wrapper>
      <ActiveWorkoutOverlay confirmEnd={confirmEnd} />
    </Wrapper>,
  );
}

beforeEach(() => {
  useActiveWorkout.setState({ active: null, expanded: false });
  mockPush.mockReset();
  mockSegments = ["(app)", "(tabs)", "train"];
});

it("shows the bar on a tab screen when a session is live, floating above the tab bar", async () => {
  const { adapters, storage, auth } = makeAdapters();
  signIn(auth);
  storage.cacheActiveSession(USER, makeSession());

  const { getByTestId } = renderOverlay(adapters);
  await waitFor(() => {
    expect(getByTestId("active-workout-bar")).toBeTruthy();
  });
  // tabBarHeight(34) + gap = 60 + 34 + 8 + 12 = 114
  const overlay = getByTestId("active-workout-overlay");
  expect(overlay.props.style.bottom).toBe(114);
});

it("floats just above the home indicator on a pushed-over (non-tab) screen", async () => {
  mockSegments = ["(app)", "exercises", "[id]", "index"];
  const { adapters, storage, auth } = makeAdapters();
  signIn(auth);
  storage.cacheActiveSession(USER, makeSession());

  const { getByTestId } = renderOverlay(adapters);
  await waitFor(() => {
    expect(getByTestId("active-workout-overlay")).toBeTruthy();
  });
  // insets.bottom (34) + gap (12) = 46
  expect(getByTestId("active-workout-overlay").props.style.bottom).toBe(46);
});

it("hides on the session screen (expanded surface owns the view)", async () => {
  mockSegments = ["(app)", "session", "index"];
  const { adapters, storage, auth } = makeAdapters();
  signIn(auth);
  storage.cacheActiveSession(USER, makeSession());

  const { queryByTestId } = renderOverlay(adapters);
  // Give useAuth a tick to resolve, then assert it stays hidden.
  await waitFor(() => {
    expect(queryByTestId("active-workout-bar")).toBeNull();
  });
});

it("hides in the auth flow", async () => {
  mockSegments = ["(auth)", "sign-in"];
  const { adapters, storage, auth } = makeAdapters();
  signIn(auth);
  storage.cacheActiveSession(USER, makeSession());

  const { queryByTestId } = renderOverlay(adapters);
  await waitFor(() => {
    expect(queryByTestId("active-workout-bar")).toBeNull();
  });
});

it("renders nothing when there's no active session", async () => {
  const { adapters, auth } = makeAdapters();
  signIn(auth); // no cached session
  const { queryByTestId } = renderOverlay(adapters);
  await waitFor(() => {
    expect(queryByTestId("active-workout-bar")).toBeNull();
  });
});

it("tapping the bar pushes the session route to expand", async () => {
  const { adapters, storage, auth } = makeAdapters();
  signIn(auth);
  storage.cacheActiveSession(USER, makeSession());

  const { getByTestId } = renderOverlay(adapters);
  await waitFor(() => {
    expect(getByTestId("active-workout-bar")).toBeTruthy();
  });
  fireEvent.press(getByTestId("active-workout-bar"));
  expect(mockPush).toHaveBeenCalledWith("/(app)/session?sessionId=local-abc");
});

it("long-press → confirm → discards the session (cancel + slice clear)", async () => {
  const { adapters, storage, auth } = makeAdapters();
  signIn(auth);
  storage.cacheActiveSession(USER, makeSession());
  useActiveWorkout.setState({
    active: {
      sessionId: "local-abc",
      workoutId: "w-1",
      name: "Upper Body",
      startedAt: new Date().toISOString(),
    },
    expanded: false,
  });

  // Auto-confirm the end.
  const confirmEnd = jest.fn((onConfirm: () => void) => onConfirm());
  const { getByTestId } = renderOverlay(adapters, confirmEnd);
  await waitFor(() => {
    expect(getByTestId("active-workout-bar")).toBeTruthy();
  });

  fireEvent(getByTestId("active-workout-bar"), "longPress");
  expect(confirmEnd).toHaveBeenCalledTimes(1);
  await waitFor(() => {
    expect(useActiveWorkout.getState().active).toBeNull();
  });
  // cancelSessionCommand finalized the SQLite session → no longer active.
  expect(storage.getActiveSession(USER)).toBeNull();
});

it("uses the default Alert end-confirm when no confirmEnd is injected", async () => {
  const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const { adapters, storage, auth } = makeAdapters();
  signIn(auth);
  storage.cacheActiveSession(USER, makeSession());

  const { getByTestId } = renderOverlay(adapters); // no confirmEnd → default
  await waitFor(() => {
    expect(getByTestId("active-workout-bar")).toBeTruthy();
  });
  fireEvent(getByTestId("active-workout-bar"), "longPress");
  expect(alertSpy).toHaveBeenCalledWith(
    "End workout?",
    expect.stringContaining("won't be saved"),
    expect.any(Array),
  );
  alertSpy.mockRestore();
});

it("falls back to 'Active Workout' when the session has no name", async () => {
  const { adapters, storage, auth } = makeAdapters();
  signIn(auth);
  storage.cacheActiveSession(USER, makeSession({ name: "" }));

  const { getByTestId } = renderOverlay(adapters);
  await waitFor(() => {
    expect(getByTestId("active-workout-bar-title").props.children).toBe(
      "Active Workout",
    );
  });
});
