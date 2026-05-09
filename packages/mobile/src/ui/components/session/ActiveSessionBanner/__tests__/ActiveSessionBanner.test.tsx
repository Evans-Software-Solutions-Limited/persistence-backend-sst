import { fireEvent } from "@testing-library/react-native";
import React from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { WorkoutSession } from "@/domain/models/session";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { ActiveSessionBanner } from "../ActiveSessionBanner";
import { renderWithTheme } from "../../../../../../__tests__/test-utils";

const mockRouterPush = jest.fn();
let mockSegments: string[] = ["(app)", "(tabs)", "workouts"];
jest.mock("expo-router", () => ({
  __esModule: true,
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
  },
  useSegments: () => mockSegments,
}));

function makeAdapters(storage: InMemoryStorageAdapter): Adapters {
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
    api: new InMemoryApiAdapter(),
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
  };
}

const buildSession = (
  overrides: Partial<WorkoutSession> = {},
): WorkoutSession => ({
  id: "local-1",
  userId: "user-1",
  workoutId: null,
  name: "Push Day",
  status: "in_progress",
  startedAt: "2026-05-05T10:00:00.000Z",
  completedAt: null,
  notes: null,
  exercises: [],
  ...overrides,
});

describe("ActiveSessionBanner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSegments = ["(app)", "(tabs)", "workouts"];
  });

  it("renders nothing when no in-progress session exists", async () => {
    const storage = new InMemoryStorageAdapter();
    const { queryByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage)}>
        <ActiveSessionBanner />
      </AdapterProvider>,
    );
    expect(queryByTestId("active-session-banner")).toBeNull();
  });

  it("renders the session name when one exists and we're not on the session screen", async () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", buildSession({ name: "Push Day" }));

    const { findByTestId, getByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage)}>
        <ActiveSessionBanner
          clock={() => Date.parse("2026-05-05T10:00:30.000Z")}
        />
      </AdapterProvider>,
    );

    expect(await findByTestId("active-session-banner")).toBeTruthy();
    expect(getByTestId("active-session-banner-title").props.children).toBe(
      "Push Day",
    );
  });

  it("hides while on the active-session screen (avoids stacking)", async () => {
    mockSegments = ["(app)", "session"];
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", buildSession());

    const { queryByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage)}>
        <ActiveSessionBanner />
      </AdapterProvider>,
    );
    expect(queryByTestId("active-session-banner")).toBeNull();
  });

  it("tap pushes /(app)/session?sessionId=<id>", async () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", buildSession({ id: "local-abc" }));

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage)}>
        <ActiveSessionBanner />
      </AdapterProvider>,
    );
    fireEvent.press(await findByTestId("active-session-banner"));
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/(app)/session?sessionId=local-abc",
    );
  });

  it("falls back to 'Active Workout' when session.name is empty", async () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", buildSession({ name: "" }));

    const { findByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage)}>
        <ActiveSessionBanner />
      </AdapterProvider>,
    );
    const titleEl = await findByTestId("active-session-banner-title");
    expect(titleEl.props.children).toBe("Active Workout");
  });
});
