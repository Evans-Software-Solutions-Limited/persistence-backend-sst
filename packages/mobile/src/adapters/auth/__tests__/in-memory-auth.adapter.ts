import type {
  AuthChangeEvent,
  AuthPort,
  AuthSession,
  OAuthProvider,
} from "@/domain/ports/auth.port";
import { ok, fail, type Result, type AuthError } from "@/shared/errors";

/**
 * In-memory auth adapter for testing.
 * Simulates auth state without Supabase.
 */
export class InMemoryAuthAdapter implements AuthPort {
  public currentSession: AuthSession | null = null;
  /**
   * The session persisted "on-device" for the offline-first bootstrap
   * fallback. Defaults to tracking `currentSession` (set by the sign-in
   * helpers) but can be seeded independently to simulate "a valid session was
   * stored last time, but getSession() can't refresh it offline".
   */
  public persistedSession: AuthSession | null = null;
  public shouldFail = false;
  public failError: AuthError = {
    kind: "auth",
    code: "unknown",
    message: "Test auth error",
  };
  private listeners: ((
    session: AuthSession | null,
    event: AuthChangeEvent,
  ) => void)[] = [];

  private mayFail<T>(value: T): Result<T, AuthError> {
    if (this.shouldFail) return fail(this.failError);
    return ok(value);
  }

  private notify(event: AuthChangeEvent) {
    for (const cb of this.listeners) {
      cb(this.currentSession, event);
    }
  }

  /**
   * Test helper: emit an auth-state event with an explicit session payload,
   * decoupled from `currentSession`. Used to exercise the offline transient-
   * null handling (Supabase emitting `INITIAL_SESSION`/refresh events with a
   * `null` session while the stored session is still valid).
   */
  emitAuthEvent(session: AuthSession | null, event: AuthChangeEvent): void {
    for (const cb of this.listeners) {
      cb(session, event);
    }
  }

  async signInWithEmail(
    email: string,
    _password: string,
  ): Promise<Result<AuthSession, AuthError>> {
    if (this.shouldFail) return fail(this.failError);
    this.currentSession = {
      accessToken: "test-token",
      refreshToken: "test-refresh",
      userId: "test-user",
      email,
      expiresAt: Date.now() / 1000 + 3600,
    };
    this.persistedSession = this.currentSession;
    this.notify("SIGNED_IN");
    return ok(this.currentSession);
  }

  async signUpWithEmail(
    email: string,
    _password: string,
  ): Promise<Result<AuthSession, AuthError>> {
    return this.signInWithEmail(email, _password);
  }

  async signInWithOAuth(
    _provider: OAuthProvider,
  ): Promise<Result<AuthSession, AuthError>> {
    if (this.shouldFail) return fail(this.failError);
    this.currentSession = {
      accessToken: "oauth-token",
      refreshToken: "oauth-refresh",
      userId: "oauth-user",
      email: "oauth@example.com",
      expiresAt: Date.now() / 1000 + 3600,
    };
    this.persistedSession = this.currentSession;
    this.notify("SIGNED_IN");
    return ok(this.currentSession);
  }

  async signInWithApple(): Promise<Result<AuthSession, AuthError>> {
    if (this.shouldFail) return fail(this.failError);
    this.currentSession = {
      accessToken: "apple-token",
      refreshToken: "apple-refresh",
      userId: "apple-user",
      email: "apple@example.com",
      expiresAt: Date.now() / 1000 + 3600,
    };
    this.persistedSession = this.currentSession;
    this.notify("SIGNED_IN");
    return ok(this.currentSession);
  }

  async setSessionFromTokens(
    accessToken: string,
    refreshToken: string,
  ): Promise<Result<AuthSession, AuthError>> {
    if (this.shouldFail) return fail(this.failError);
    this.currentSession = {
      accessToken,
      refreshToken,
      userId: "callback-user",
      email: "callback@example.com",
      expiresAt: Date.now() / 1000 + 3600,
    };
    this.persistedSession = this.currentSession;
    this.notify("SIGNED_IN");
    return ok(this.currentSession);
  }

  async signOut(): Promise<Result<void, AuthError>> {
    if (this.shouldFail) return fail(this.failError);
    this.currentSession = null;
    this.persistedSession = null;
    this.notify("SIGNED_OUT");
    return ok(undefined);
  }

  async getSession(): Promise<Result<AuthSession | null, AuthError>> {
    return this.mayFail(this.currentSession);
  }

  async getPersistedSession(): Promise<AuthSession | null> {
    // Local read — always succeeds, even when `shouldFail` simulates an
    // offline getSession(). Falls back to `currentSession` when a test hasn't
    // seeded `persistedSession` explicitly.
    return this.persistedSession ?? this.currentSession;
  }

  onAuthStateChange(
    callback: (session: AuthSession | null, event: AuthChangeEvent) => void,
  ): () => void {
    this.listeners.push(callback);
    // Mirror Supabase v2 INITIAL_SESSION behavior — fire immediately with
    // the current session so consumers can bootstrap without getSession().
    let subscribed = true;
    queueMicrotask(() => {
      if (subscribed) callback(this.currentSession, "INITIAL_SESSION");
    });
    return () => {
      subscribed = false;
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }

  async resetPassword(_email: string): Promise<Result<void, AuthError>> {
    return this.mayFail(undefined);
  }

  async updatePassword(_newPassword: string): Promise<Result<void, AuthError>> {
    return this.mayFail(undefined);
  }

  async refreshSession(): Promise<Result<AuthSession, AuthError>> {
    if (!this.currentSession) {
      return fail({
        kind: "auth",
        code: "token_expired",
        message: "No session",
      });
    }
    return this.mayFail(this.currentSession);
  }

  async getAccessToken(): Promise<string | null> {
    return this.currentSession?.accessToken ?? null;
  }
}
