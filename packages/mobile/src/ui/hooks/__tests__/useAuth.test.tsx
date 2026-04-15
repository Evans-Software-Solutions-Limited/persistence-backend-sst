import { renderHook, act, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import type { AuthSession } from "@/domain/ports/auth.port";
import { useAuth } from "../useAuth";
import { AdapterProvider } from "../useAdapters";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { StubPaymentsAdapter } from "@/adapters/payments";
import type { Adapters } from "@/shared/types";

function createTestAdapters(): {
  adapters: Adapters;
  auth: InMemoryAuthAdapter;
  storage: InMemoryStorageAdapter;
} {
  const auth = new InMemoryAuthAdapter();
  const storage = new InMemoryStorageAdapter();
  const adapters: Adapters = {
    api: new InMemoryApiAdapter(),
    auth,
    storage,
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new StubPaymentsAdapter(),
  };
  return { adapters, auth, storage };
}

describe("useAuth", () => {
  it("starts with loading state and resolves to no session", async () => {
    const { adapters } = createTestAdapters();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.session).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("signs in and exposes session", async () => {
    const { adapters } = createTestAdapters();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.signIn("test@example.com", "password");
    });

    expect(result.current.session).not.toBeNull();
    expect(result.current.session?.email).toBe("test@example.com");
    expect(result.current.error).toBeNull();
  });

  it("signs out and clears session", async () => {
    const { adapters } = createTestAdapters();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.signIn("test@example.com", "password");
    });
    expect(result.current.session).not.toBeNull();

    await act(async () => {
      await result.current.signOut();
    });
    expect(result.current.session).toBeNull();
  });

  it("throws and sets error when sign-in fails", async () => {
    const { adapters, auth } = createTestAdapters();

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    auth.shouldFail = true;

    let thrownError: unknown = null;
    await act(async () => {
      try {
        await result.current.signIn("test@example.com", "password");
      } catch (err) {
        thrownError = err;
      }
    });

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toBe("Test auth error");
    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.kind).toBe("auth");
  });

  it("throws when sign-out fails", async () => {
    const { adapters, auth } = createTestAdapters();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Sign in first, then make signOut fail
    await act(async () => {
      await result.current.signIn("test@example.com", "password");
    });

    auth.shouldFail = true;

    await expect(
      act(async () => {
        await result.current.signOut();
      }),
    ).rejects.toThrow("Test auth error");
  });

  it("signs in with OAuth provider", async () => {
    const { adapters } = createTestAdapters();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.signInWithOAuth("google");
    });

    expect(result.current.session).not.toBeNull();
    expect(result.current.session?.email).toBe("oauth@example.com");
    expect(result.current.error).toBeNull();
  });

  it("throws when signInWithOAuth fails", async () => {
    const { adapters, auth } = createTestAdapters();
    auth.shouldFail = true;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await expect(
      act(async () => {
        await result.current.signInWithOAuth("google");
      }),
    ).rejects.toThrow("Test auth error");
  });

  it("isAuthenticated is true after sign-in, false after sign-out", async () => {
    const { adapters } = createTestAdapters();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);

    await act(async () => {
      await result.current.signIn("test@example.com", "password");
    });

    expect(result.current.isAuthenticated).toBe(true);

    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.isAuthenticated).toBe(false);
  });

  it("signs up and exposes session", async () => {
    const { adapters } = createTestAdapters();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.signUp("new@example.com", "password");
    });

    expect(result.current.session).not.toBeNull();
    expect(result.current.session?.email).toBe("new@example.com");
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("throws and sets error when sign-up fails", async () => {
    const { adapters, auth } = createTestAdapters();

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    auth.shouldFail = true;

    let thrownError: unknown = null;
    await act(async () => {
      try {
        await result.current.signUp("new@example.com", "password");
      } catch (err) {
        thrownError = err;
      }
    });

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toBe("Test auth error");
    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.kind).toBe("auth");
  });

  it("resets password successfully", async () => {
    const { adapters } = createTestAdapters();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.resetPassword("test@example.com");
    });

    expect(result.current.error).toBeNull();
  });

  it("throws and sets error when resetPassword fails", async () => {
    const { adapters, auth } = createTestAdapters();

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    auth.shouldFail = true;

    let thrownError: unknown = null;
    await act(async () => {
      try {
        await result.current.resetPassword("test@example.com");
      } catch (err) {
        thrownError = err;
      }
    });

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toBe("Test auth error");
    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.kind).toBe("auth");
  });

  it("resolves loading even when getSession fails on bootstrap", async () => {
    const { adapters, auth } = createTestAdapters();
    auth.shouldFail = true;

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Bootstrap always finishes — session is null, app is usable
    expect(result.current.session).toBeNull();
  });

  it("bootstraps with existing session from onAuthStateChange", async () => {
    const { adapters, auth } = createTestAdapters();
    // Pre-set a session before mounting the hook
    auth.currentSession = {
      accessToken: "existing-token",
      refreshToken: "existing-refresh",
      userId: "existing-user",
      email: "existing@example.com",
      expiresAt: Date.now() / 1000 + 3600,
    };

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.session).not.toBeNull();
    expect(result.current.session?.email).toBe("existing@example.com");
    expect(result.current.isAuthenticated).toBe(true);
  });

  it("hard timeout resolves loading when getSession hangs", async () => {
    jest.useFakeTimers();

    const { adapters, auth } = createTestAdapters();
    // Make getSession hang forever (never resolves)
    auth.getSession = () => new Promise(() => {});
    // Suppress initial onAuthStateChange event too
    auth.onAuthStateChange = () => () => {};

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.isLoading).toBe(true);

    // Advance past the 3s hard timeout
    await act(async () => {
      jest.advanceTimersByTime(3100);
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.session).toBeNull();

    jest.useRealTimers();
  });

  it("clears storage cache on sign-out", async () => {
    const { adapters, auth, storage } = createTestAdapters();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    // Seed some cached data
    storage.enqueueMutation({
      entityType: "workout",
      operation: "create",
      payload: { name: "Test" },
      endpoint: "/workouts",
      method: "POST",
    });
    storage.setLastSyncedAt("workout", "2026-01-01T00:00:00Z");

    expect(storage.getPendingMutations()).toHaveLength(1);
    expect(storage.getLastSyncedAt("workout")).toBeTruthy();

    // Sign in first
    auth.currentSession = {
      accessToken: "tok",
      refreshToken: "ref",
      userId: "u1",
      email: "e@e.com",
      expiresAt: 0,
    };

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Sign out
    await act(async () => {
      await result.current.signOut();
    });

    // Cached data should be cleared
    expect(storage.getPendingMutations()).toHaveLength(0);
    expect(storage.getLastSyncedAt("workout")).toBeNull();
  });
});
