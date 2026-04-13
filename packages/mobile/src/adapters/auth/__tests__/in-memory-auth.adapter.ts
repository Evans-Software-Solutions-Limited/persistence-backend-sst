import type {
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
  public shouldFail = false;
  public failError: AuthError = {
    kind: "auth",
    code: "unknown",
    message: "Test auth error",
  };
  private listeners: ((session: AuthSession | null) => void)[] = [];

  private mayFail<T>(value: T): Result<T, AuthError> {
    if (this.shouldFail) return fail(this.failError);
    return ok(value);
  }

  private notify() {
    for (const cb of this.listeners) {
      cb(this.currentSession);
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
    this.notify();
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
    return fail({ kind: "auth", code: "unknown", message: "Not implemented" });
  }

  async signOut(): Promise<Result<void, AuthError>> {
    if (this.shouldFail) return fail(this.failError);
    this.currentSession = null;
    this.notify();
    return ok(undefined);
  }

  async getSession(): Promise<Result<AuthSession | null, AuthError>> {
    return this.mayFail(this.currentSession);
  }

  onAuthStateChange(
    callback: (session: AuthSession | null) => void,
  ): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }

  async resetPassword(_email: string): Promise<Result<void, AuthError>> {
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
