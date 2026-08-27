import { renderHook, act, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { useAuth } from "../useAuth";
import { AdapterProvider } from "../useAdapters";
import { useUserMode } from "@/state/user-mode";
import { useTrainSegment } from "@/ui/hooks/useTrainSegment";
import { useCoachLibrarySegment } from "@/ui/hooks/useCoachLibrarySegment";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
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
    netInfo: new InMemoryNetInfoAdapter(),
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

  it("resets the user-mode slice on sign-out (no cross-account bleed)", async () => {
    const { adapters } = createTestAdapters();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.signIn("trainer@example.com", "password");
    });
    // Simulate trainer A having switched into coach mode.
    act(() => {
      useUserMode.setState({
        mode: "coach",
        isTrainerEligible: true,
        isEligibilityKnown: true,
      });
      useTrainSegment.setState({ segment: "Exercises", pendingCreate: true });
      useCoachLibrarySegment.setState({ segment: "Exercises" });
    });

    await act(async () => {
      await result.current.signOut();
    });

    // The next account on this device must start as a fresh athlete — the
    // device-global persisted mode key must not bleed across accounts.
    const s = useUserMode.getState();
    expect(s.mode).toBe("athlete");
    expect(s.isTrainerEligible).toBe(false);
    expect(s.isEligibilityKnown).toBe(false);
    // Same for the Train segment + the one-shot pendingCreate flag.
    expect(useTrainSegment.getState().segment).toBe("Training");
    expect(useTrainSegment.getState().pendingCreate).toBe(false);
    // Same for the Coach Library segment (STORY-004 slice).
    expect(useCoachLibrarySegment.getState().segment).toBe("Programmes");
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

  it("still tears down local state when the remote sign-out revoke fails (offline escape hatch)", async () => {
    // The Home-error "Sign out" escape hatch must work when the device is
    // offline (the common cause of a stuck app). Even though the remote revoke
    // errors and signOut re-throws, local state MUST be cleared so AuthGate
    // redirects to sign-in instead of re-stranding the user.
    const { adapters, auth, storage } = createTestAdapters();
    const clearAllSpy = jest.spyOn(storage, "clearAll");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.signIn("test@example.com", "password");
    });

    auth.shouldFail = true;

    await act(async () => {
      await result.current.signOut().catch(() => {});
    });

    expect(clearAllSpy).toHaveBeenCalled();
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

  it("signs in with native Apple", async () => {
    const { adapters } = createTestAdapters();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.signInWithApple();
    });

    expect(result.current.session).not.toBeNull();
    expect(result.current.session?.email).toBe("apple@example.com");
    expect(result.current.error).toBeNull();
  });

  it("throws and sets error when native Apple sign-in fails", async () => {
    const { adapters, auth } = createTestAdapters();
    auth.shouldFail = true;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    let thrownError: unknown = null;
    await act(async () => {
      try {
        await result.current.signInWithApple();
      } catch (err) {
        thrownError = err;
      }
    });

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toBe("Test auth error");
    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.kind).toBe("auth");
  });

  it("treats native Apple cancellation as a silent no-op", async () => {
    const { adapters, auth } = createTestAdapters();
    auth.shouldFail = true;
    auth.failError = {
      kind: "auth",
      code: "cancelled",
      message: "Sign in with Apple was cancelled",
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Cancellation must not throw and must not surface an error banner.
    let thrownError: unknown = null;
    await act(async () => {
      try {
        await result.current.signInWithApple();
      } catch (err) {
        thrownError = err;
      }
    });

    expect(thrownError).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.session).toBeNull();
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

  // `email_may_already_exist` is a HINT, not a failure: it must resolve (so it
  // can never gate registration) while telling the screen to show "sign in
  // instead" copy rather than "check your email", which would be a dead end.
  it.each([
    ["email_confirmation_required", false],
    ["email_may_already_exist", true],
  ] as const)(
    "signUp resolves for %s with mayAlreadyExist=%s",
    async (code, expected) => {
      const { adapters, auth } = createTestAdapters();
      jest.spyOn(auth, "signUpWithEmail").mockResolvedValue({
        ok: false,
        error: { kind: "auth", code, message: "nope" },
      });

      const wrapper = ({ children }: { children: ReactNode }) => (
        <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
      );
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let outcome: {
        confirmationRequired: boolean;
        mayAlreadyExist: boolean;
      } | null = null;
      await act(async () => {
        outcome = await result.current.signUp("x@example.com", "password");
      });

      expect(outcome).toEqual({
        confirmationRequired: true,
        mayAlreadyExist: expected,
      });
      // Neither is surfaced as a red error banner.
      expect(result.current.error).toBeNull();
    },
  );

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

  it("updates the password successfully", async () => {
    const { adapters } = createTestAdapters();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.updatePassword("newpass123");
    });

    expect(result.current.error).toBeNull();
  });

  it("throws and sets error when updatePassword fails", async () => {
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
        await result.current.updatePassword("newpass123");
      } catch (err) {
        thrownError = err;
      }
    });

    expect(thrownError).toBeInstanceOf(Error);
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

  // Offline-first session persistence -----------------------------------------
  // The bug: using the app abroad on flaky signal, an expired access token
  // couldn't be refreshed, getSession() failed/hung, and the user was bounced
  // to the signed-out screen despite a valid stored session. These prove the
  // stored session keeps the user signed in offline.

  it("keeps the user signed in from the persisted session when getSession fails offline", async () => {
    const { adapters, auth } = createTestAdapters();
    // A valid session was stored last launch...
    const stored = {
      accessToken: "stored-token",
      refreshToken: "stored-refresh",
      userId: "abroad-user",
      email: "abroad@example.com",
      expiresAt: Date.now() / 1000 - 60, // access token already expired
    };
    auth.persistedSession = stored;
    auth.currentSession = null;
    // ...but the device is offline, so the network-backed getSession() fails
    // trying to refresh the expired token.
    auth.shouldFail = true;

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Stays signed in from the stored session instead of bouncing to sign-in.
    expect(result.current.session).not.toBeNull();
    expect(result.current.session?.userId).toBe("abroad-user");
    expect(result.current.isAuthenticated).toBe(true);
  });

  it("bootstraps instantly from the persisted session without waiting on getSession()", async () => {
    const { adapters, auth } = createTestAdapters();
    auth.persistedSession = {
      accessToken: "stored-token",
      refreshToken: "stored-refresh",
      userId: "cached-user",
      email: "cached@example.com",
      expiresAt: Date.now() / 1000 - 60,
    };
    auth.currentSession = null;
    // getSession() never resolves (network hung); the persisted read must
    // still resolve the bootstrap.
    auth.getSession = () => new Promise(() => {});

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.session?.userId).toBe("cached-user");
  });

  it("adopts the refreshed session once getSession() reconciles after an offline bootstrap", async () => {
    const { adapters, auth } = createTestAdapters();
    auth.persistedSession = {
      accessToken: "stale-token",
      refreshToken: "stored-refresh",
      userId: "reconcile-user",
      email: "reconcile@example.com",
      expiresAt: Date.now() / 1000 - 60,
    };
    // getSession() succeeds with a freshly-refreshed access token.
    auth.currentSession = {
      accessToken: "fresh-token",
      refreshToken: "fresh-refresh",
      userId: "reconcile-user",
      email: "reconcile@example.com",
      expiresAt: Date.now() / 1000 + 3600,
    };

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.session?.accessToken).toBe("fresh-token");
    });
  });

  it("does not bounce to sign-in when getSession fails BEFORE the slower on-device read lands (race regression, IB 🟠)", async () => {
    // The two bootstrap reads race. If the offline getSession() failure lands
    // before the (slower) AsyncStorage read, the signed-out conclusion must
    // still wait for the on-device session — otherwise the user is bounced to
    // sign-in, the exact bug this PR fixes. The in-memory getPersistedSession
    // normally resolves in the same microtask as getSession, so delay it here
    // to force the losing timing.
    const { adapters, auth } = createTestAdapters();
    const stored = {
      accessToken: "stored-token",
      refreshToken: "stored-refresh",
      userId: "race-user",
      email: "race@example.com",
      expiresAt: Date.now() / 1000 - 60,
    };
    auth.persistedSession = stored;
    auth.currentSession = null;
    auth.shouldFail = true; // getSession() rejects immediately (offline)
    auth.getPersistedSession = () =>
      new Promise((resolve) => setTimeout(() => resolve(stored), 50));

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.session?.userId).toBe("race-user");
    expect(result.current.isAuthenticated).toBe(true);
  });

  it("ignores a transient null auth event (offline INITIAL_SESSION) but honours SIGNED_OUT", async () => {
    const { adapters, auth } = createTestAdapters();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Establish a live session.
    await act(async () => {
      await result.current.signIn("live@example.com", "password");
    });
    expect(result.current.session).not.toBeNull();

    // Supabase emits INITIAL_SESSION/refresh events carrying null while
    // offline — this must NOT log the user out.
    await act(async () => {
      auth.emitAuthEvent(null, "INITIAL_SESSION");
    });
    expect(result.current.session).not.toBeNull();
    expect(result.current.session?.email).toBe("live@example.com");

    // A genuine SIGNED_OUT still clears the session.
    await act(async () => {
      auth.emitAuthEvent(null, "SIGNED_OUT");
    });
    expect(result.current.session).toBeNull();
  });

  it("still resolves the bootstrap when the persisted-session read rejects", async () => {
    const { adapters, auth } = createTestAdapters();
    auth.getPersistedSession = () =>
      Promise.reject(new Error("storage blew up"));

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    // getSession() (no session) still resolves it to signed-out.
    expect(result.current.session).toBeNull();
  });

  it("resolves the bootstrap from the persisted session when getSession rejects", async () => {
    const { adapters, auth } = createTestAdapters();
    auth.persistedSession = {
      accessToken: "stored-token",
      refreshToken: "stored-refresh",
      userId: "rejecting-user",
      email: "rejecting@example.com",
      expiresAt: Date.now() / 1000 - 60,
    };
    auth.currentSession = null;
    // getSession() throws outright rather than returning a failed Result.
    auth.getSession = () => Promise.reject(new Error("network down"));

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.session?.userId).toBe("rejecting-user");
  });

  it("bootstraps from the onAuthStateChange event when there is no persisted session and getSession hangs", async () => {
    jest.useFakeTimers();
    const { adapters, auth } = createTestAdapters();
    auth.persistedSession = null;
    auth.currentSession = null;
    auth.getSession = () => new Promise(() => {});

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    // A session arrives via the auth-state listener before the timeout fires.
    await act(async () => {
      auth.emitAuthEvent(
        {
          accessToken: "listener-token",
          refreshToken: "listener-refresh",
          userId: "listener-user",
          email: "listener@example.com",
          expiresAt: Date.now() / 1000 + 3600,
        },
        "SIGNED_IN",
      );
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.session?.userId).toBe("listener-user");

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

  it("deletes the account: clears the session + device-global local state", async () => {
    const { adapters, storage } = createTestAdapters();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    storage.setLastSyncedAt("workout", "2026-01-01T00:00:00Z");

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.signIn("trainer@example.com", "password");
    });
    act(() => {
      useUserMode.setState({
        mode: "coach",
        isTrainerEligible: true,
        isEligibilityKnown: true,
      });
      useTrainSegment.setState({ segment: "Exercises", pendingCreate: true });
      useCoachLibrarySegment.setState({ segment: "Workouts" });
    });
    expect(result.current.session).not.toBeNull();

    let deleteResult: { purgeAfter: string } | undefined;
    await act(async () => {
      deleteResult = await result.current.deleteAccount();
    });

    // Cluster 2b: the backend soft-deletes and returns a grace-period
    // purgeAfter date instead of purging immediately.
    expect(deleteResult?.purgeAfter).toEqual(expect.any(String));

    // Session torn down (AuthGate routes to sign-in on this), and the
    // device-global slices + storage cache reset — same as sign-out.
    expect(result.current.session).toBeNull();
    expect(result.current.error).toBeNull();
    expect(useUserMode.getState().mode).toBe("athlete");
    expect(useTrainSegment.getState().segment).toBe("Training");
    expect(useCoachLibrarySegment.getState().segment).toBe("Programmes");
    expect(storage.getLastSyncedAt("workout")).toBeNull();
  });

  it("throws + sets error + keeps the session when the backend delete fails", async () => {
    const { adapters, auth } = createTestAdapters();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.signIn("test@example.com", "password");
    });
    expect(result.current.session).not.toBeNull();

    (adapters.api as InMemoryApiAdapter).shouldFail = true;

    let thrownError: unknown = null;
    await act(async () => {
      try {
        await result.current.deleteAccount();
      } catch (err) {
        thrownError = err;
      }
    });

    expect(thrownError).toBeInstanceOf(Error);
    expect(result.current.error?.kind).toBe("auth");
    // Failure leaves the user signed in so they can retry.
    expect(result.current.session).not.toBeNull();
    // auth adapter is referenced to keep the destructure parallel to sign-out
    // tests; the in-memory auth was never asked to sign out on the failure path.
    expect(auth.currentSession).not.toBeNull();
  });
});
