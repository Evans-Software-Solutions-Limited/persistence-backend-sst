import { fireEvent, waitFor } from "@testing-library/react-native";
import React from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { ResumePromptContainer } from "@/ui/containers/ResumePromptContainer";
import { renderWithTheme } from "../../../../__tests__/test-utils";

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

const seed = (storage: InMemoryStorageAdapter) =>
  storage.cacheActiveSession("user-1", {
    id: "local-abc",
    userId: "user-1",
    workoutId: null,
    name: "Push Day",
    status: "in_progress",
    startedAt: "2026-05-05T10:00:00.000Z",
    completedAt: null,
    notes: null,
    exercises: [],
  });

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
  },
}));

describe("ResumePromptContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders nothing when no in-progress session exists", async () => {
    const storage = new InMemoryStorageAdapter();
    const { queryByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage)}>
        <ResumePromptContainer />
      </AdapterProvider>,
    );
    // Wait a tick for auth to resolve.
    await waitFor(() => expect(queryByTestId("resume-prompt")).toBeNull());
  });

  it("Continue routes to /(app)/session?sessionId=<id> and dismisses", async () => {
    const storage = new InMemoryStorageAdapter();
    seed(storage);

    const { findByTestId, queryByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage)}>
        <ResumePromptContainer />
      </AdapterProvider>,
    );

    fireEvent.press(await findByTestId("resume-prompt-continue"));
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/(app)/session?sessionId=local-abc",
    );
    // Prompt dismissed.
    await waitFor(() => expect(queryByTestId("resume-prompt")).toBeNull());
  });

  it("Discard fires cancelSessionCommand (queues recordSession with cancelled status) and dismisses", async () => {
    const storage = new InMemoryStorageAdapter();
    seed(storage);

    const { findByTestId, queryByTestId } = renderWithTheme(
      <AdapterProvider adapters={makeAdapters(storage)}>
        <ResumePromptContainer />
      </AdapterProvider>,
    );

    fireEvent.press(await findByTestId("resume-prompt-discard"));

    // One queued intent — bulk-record cancellation.
    const queue = storage.getPendingMutations();
    expect(queue).toHaveLength(1);
    const payload = JSON.parse(queue[0].payload);
    expect(payload.status).toBe("cancelled");

    await waitFor(() => expect(queryByTestId("resume-prompt")).toBeNull());
  });
});
