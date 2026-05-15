import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { PROFILE_PAGE_FIXTURE } from "@/adapters/api/__tests__/fixtures/profile-page.fixture";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useProfilePage } from "@/ui/hooks/useProfilePage";

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
  };
}

function wrap(adapters: Adapters) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  }
  return Wrapper;
}

describe("useProfilePage", () => {
  it("renders null + auto-refreshes when cache is empty", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.profilePage = PROFILE_PAGE_FIXTURE;
    const adapters = makeAdapters(api, storage);

    const { result } = renderHook(() => useProfilePage(), {
      wrapper: wrap(adapters),
    });

    expect(result.current.payload).toBeNull();
    expect(result.current.isStale).toBe(true);

    await waitFor(() => {
      expect(result.current.payload).toEqual(PROFILE_PAGE_FIXTURE);
    });
    expect(result.current.isStale).toBe(false);
    expect(result.current.syncedAt).not.toBeNull();
  });

  it("exposes cached payload on mount when already fresh", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheProfilePage("user-1", PROFILE_PAGE_FIXTURE);
    api.profilePage = PROFILE_PAGE_FIXTURE;
    const adapters = makeAdapters(api, storage);

    const { result } = renderHook(() => useProfilePage(), {
      wrapper: wrap(adapters),
    });
    await waitFor(() => {
      expect(result.current.payload).not.toBeNull();
    });
    expect(result.current.isStale).toBe(false);
  });

  it("surfaces an ApiError when refresh fails", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.profilePage = PROFILE_PAGE_FIXTURE;
    api.shouldFail = true;
    api.failError = { kind: "api", code: "server", message: "boom" };
    const adapters = makeAdapters(api, storage);

    const { result } = renderHook(() => useProfilePage(), {
      wrapper: wrap(adapters),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.error?.message).toBe("boom");
    // Cache untouched on failure.
    expect(storage.getCachedProfilePage("user-1")).toBeNull();
  });

  it("dedupes concurrent same-user refresh() calls", async () => {
    const api = new InMemoryApiAdapter();
    api.profilePage = PROFILE_PAGE_FIXTURE;
    const storage = new InMemoryStorageAdapter();
    storage.cacheProfilePage("user-1", PROFILE_PAGE_FIXTURE);
    const adapters = makeAdapters(api, storage);
    const spy = jest.spyOn(api, "getProfilePage");

    const { result } = renderHook(() => useProfilePage(), {
      wrapper: wrap(adapters),
    });
    await waitFor(() => {
      expect(result.current.payload).not.toBeNull();
    });
    spy.mockClear();

    await act(async () => {
      await Promise.all([
        result.current.refresh(),
        result.current.refresh(),
        result.current.refresh(),
      ]);
    });

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
