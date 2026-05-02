import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AppState } from "react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useSyncWorker } from "@/ui/hooks/useSyncWorker";

const mockFetch = jest.fn();
(globalThis as Record<string, unknown>).fetch = mockFetch;

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

function makeAdapters(
  storage: InMemoryStorageAdapter,
  auth: InMemoryAuthAdapter,
  session: AuthSession | null,
): Adapters {
  const wrappedAuth = {
    ...auth,
    onAuthStateChange: (cb: (s: AuthSession | null) => void) => {
      setTimeout(() => cb(session), 0);
      return () => {};
    },
    getSession: jest.fn(async () => ok(session)),
    getAccessToken: jest.fn(async () => "test-token"),
  } as unknown as Adapters["auth"];
  return {
    api: new InMemoryApiAdapter(),
    auth: wrappedAuth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
  };
}

function wrap(adapters: Adapters) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

const session: AuthSession = {
  accessToken: "t",
  refreshToken: "r",
  userId: "user-1",
  email: "u@example.com",
  expiresAt: Date.now() + 60_000,
};

describe("useSyncWorker", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does NOT flush when there is no session", () => {
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w1",
      operation: "create",
      payload: { name: "Push Day" },
      endpoint: "/workouts",
      method: "POST",
    });
    const auth = new InMemoryAuthAdapter();
    const adapters = makeAdapters(storage, auth, null);

    renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("flushes the queue once on mount when authenticated", async () => {
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w1",
      operation: "create",
      payload: { name: "Push Day" },
      endpoint: "/workouts",
      method: "POST",
    });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    const auth = new InMemoryAuthAdapter();
    const adapters = makeAdapters(storage, auth, session);

    renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.test/workouts",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("re-flushes when AppState transitions to active", async () => {
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const auth = new InMemoryAuthAdapter();
    const adapters = makeAdapters(storage, auth, session);

    // Capture the AppState listener so we can trigger it.
    let activeListener: ((s: string) => void) | null = null;
    const addEventSpy = jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((event, cb) => {
        if (event === "change") {
          activeListener = cb as (s: string) => void;
        }
        return { remove: jest.fn() } as unknown as ReturnType<
          typeof AppState.addEventListener
        >;
      });

    renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });

    // Mount-flush completes (queue empty here, so 0 fetches).
    await waitFor(() => expect(addEventSpy).toHaveBeenCalled());
    expect(mockFetch).toHaveBeenCalledTimes(0);

    // Enqueue then simulate foreground.
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w2",
      operation: "create",
      payload: { name: "Pull Day" },
      endpoint: "/workouts",
      method: "POST",
    });
    activeListener!("active");

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  });

  it("does not double-flush when triggered concurrently", async () => {
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w1",
      operation: "create",
      payload: { name: "Push Day" },
      endpoint: "/workouts",
      method: "POST",
    });
    // Hold the first fetch open so the second mount fires while it's
    // still in flight.
    let resolveFirst: (() => void) | null = null;
    mockFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = () => resolve({ ok: true, json: async () => ({}) });
        }),
    );
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    const auth = new InMemoryAuthAdapter();
    const adapters = makeAdapters(storage, auth, session);

    let activeListener: ((s: string) => void) | null = null;
    jest.spyOn(AppState, "addEventListener").mockImplementation((event, cb) => {
      if (event === "change") activeListener = cb as (s: string) => void;
      return { remove: jest.fn() } as unknown as ReturnType<
        typeof AppState.addEventListener
      >;
    });

    renderHook(() => useSyncWorker(), { wrapper: wrap(adapters) });

    // Trigger a foreground transition before the mount-flush settles.
    await waitFor(() => expect(activeListener).not.toBeNull());
    activeListener!("active");

    // Resolve the first flush so reentrancy clears.
    resolveFirst!();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  });
});
