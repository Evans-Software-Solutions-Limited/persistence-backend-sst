import { act, renderHook, waitFor } from "@testing-library/react-native";
import React, { useState, type ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useResumeSession } from "@/ui/hooks/useResumeSession";

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

function wrap(adapters: Adapters) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

describe("useResumeSession", () => {
  it("returns null when no in-progress session exists", async () => {
    const storage = new InMemoryStorageAdapter();
    const { result } = renderHook(() => useResumeSession(), {
      wrapper: wrap(makeAdapters(storage)),
    });
    await waitFor(() => expect(result.current.session).toBeNull());
  });

  it("returns the active session once auth resolves", async () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", {
      id: "local-1",
      userId: "user-1",
      workoutId: null,
      name: "Push",
      status: "in_progress",
      startedAt: "2026-05-05T10:00:00.000Z",
      completedAt: null,
      notes: null,
      exercises: [],
    });

    const { result } = renderHook(() => useResumeSession(), {
      wrapper: wrap(makeAdapters(storage)),
    });
    await waitFor(() => expect(result.current.session?.id).toBe("local-1"));
  });

  it("dismiss() clears the prompt and stays cleared (no double-prompt on tab switch)", async () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheActiveSession("user-1", {
      id: "local-1",
      userId: "user-1",
      workoutId: null,
      name: "Push",
      status: "in_progress",
      startedAt: "2026-05-05T10:00:00.000Z",
      completedAt: null,
      notes: null,
      exercises: [],
    });

    const { result } = renderHook(() => useResumeSession(), {
      wrapper: wrap(makeAdapters(storage)),
    });
    await waitFor(() => expect(result.current.session?.id).toBe("local-1"));

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.session).toBeNull();
  });

  it("dismiss() persists across effect re-runs caused by storage identity changes", async () => {
    // Regression: a prior version reset `dismissedRef` at the top of
    // every effect run, turning the dismissed-guard into dead code.
    // If the underlying `storage` reference changes on the same
    // userId — e.g. AdapterProvider re-renders with a fresh adapter
    // instance — the effect re-fires and would resurrect the prompt.
    // To genuinely exercise the bug we need a *different* storage
    // identity that still reports an active session for the same
    // user. We achieve this by swapping the in-memory adapter for a
    // second one seeded with the same data.
    const seed = {
      id: "local-1",
      userId: "user-1",
      workoutId: null,
      name: "Push",
      status: "in_progress" as const,
      startedAt: "2026-05-05T10:00:00.000Z",
      completedAt: null,
      notes: null,
      exercises: [],
    };
    const storageA = new InMemoryStorageAdapter();
    storageA.cacheActiveSession("user-1", seed);
    const storageB = new InMemoryStorageAdapter();
    storageB.cacheActiveSession("user-1", seed);

    let triggerSwap: (() => void) | null = null;
    function StatefulWrapper({ children }: { children: ReactNode }) {
      const [storage, setStorage] = useState<InMemoryStorageAdapter>(storageA);
      triggerSwap = () => setStorage(storageB);
      return (
        <AdapterProvider adapters={makeAdapters(storage)}>
          {children}
        </AdapterProvider>
      );
    }

    const { result } = renderHook(() => useResumeSession(), {
      wrapper: StatefulWrapper,
    });
    await waitFor(() => expect(result.current.session?.id).toBe("local-1"));

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.session).toBeNull();

    // Swap `storage` from A → B. Same userId, different storage
    // reference. The hook's effect dep `[storage, userId]` re-fires.
    // The dismissed guard MUST hold — without the previous-userId
    // check the unconditional `dismissedRef.current = false` reset
    // would resurrect the session here.
    act(() => {
      triggerSwap?.();
    });
    await waitFor(() => expect(result.current.session).toBeNull());
    expect(result.current.session).toBeNull();
  });
});
