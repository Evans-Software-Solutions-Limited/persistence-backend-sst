import { renderHook, act, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
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
} {
  const auth = new InMemoryAuthAdapter();
  const adapters: Adapters = {
    api: new InMemoryApiAdapter(),
    auth,
    storage: new InMemoryStorageAdapter(),
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new StubPaymentsAdapter(),
  };
  return { adapters, auth };
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
        await result.current.signIn("test@example.com", "password");
      }),
    ).rejects.toThrow("Test auth error");

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

  it("exposes error when getSession fails on bootstrap", async () => {
    const { adapters, auth } = createTestAdapters();
    auth.shouldFail = true;

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.session).toBeNull();
    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.kind).toBe("auth");
  });
});
