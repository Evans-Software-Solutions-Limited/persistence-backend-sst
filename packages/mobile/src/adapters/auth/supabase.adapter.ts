import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Constants from "expo-constants";
import { AppState } from "react-native";
import type {
  AuthPort,
  AuthSession,
  OAuthProvider,
} from "@/domain/ports/auth.port";
import { ok, fail, type Result, type AuthError } from "@/shared/errors";

const supabaseUrl =
  Constants.expoConfig?.extra?.supabaseUrl ??
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  "";

const supabaseAnonKey =
  Constants.expoConfig?.extra?.supabaseAnonKey ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  "";

/**
 * Supabase auth adapter implementing AuthPort.
 *
 * Used ONLY for authentication (session/token management).
 * All business data flows through the SST API adapter, not Supabase directly.
 */
export class SupabaseAuthAdapter implements AuthPort {
  private client: SupabaseClient;
  private appStateSubscription: ReturnType<
    typeof AppState.addEventListener
  > | null = null;

  constructor() {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        "Missing Supabase configuration: EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY must be set",
      );
    }

    this.client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });

    // Keep the session alive when the app is foregrounded
    this.appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        this.client.auth.startAutoRefresh();
      } else {
        this.client.auth.stopAutoRefresh();
      }
    });
  }

  /**
   * Clean up the AppState listener. Call when the adapter is being discarded
   * (e.g. in a useEffect cleanup or on hot reload).
   */
  destroy(): void {
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
  }

  async signInWithEmail(
    email: string,
    password: string,
  ): Promise<Result<AuthSession, AuthError>> {
    const { data, error } = await this.client.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      return fail({
        kind: "auth",
        code: "invalid_credentials",
        message: error.message,
      });
    }
    return ok(this.mapSession(data.session));
  }

  async signUpWithEmail(
    email: string,
    password: string,
  ): Promise<Result<AuthSession, AuthError>> {
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) {
      const code = error.message.includes("already registered")
        ? "email_taken"
        : "unknown";
      return fail({ kind: "auth", code, message: error.message });
    }
    if (!data.session) {
      // Email confirmation required — distinct code so callers can show
      // a "check your email" message rather than a generic error banner
      return fail({
        kind: "auth",
        code: "email_confirmation_required",
        message: "Check your email for confirmation",
      });
    }
    return ok(this.mapSession(data.session));
  }

  async signInWithOAuth(
    _provider: OAuthProvider,
  ): Promise<Result<AuthSession, AuthError>> {
    // OAuth implementation deferred to milestone 02
    return fail({
      kind: "auth",
      code: "unknown",
      message: "OAuth not yet implemented",
    });
  }

  async signOut(): Promise<Result<void, AuthError>> {
    const { error } = await this.client.auth.signOut();
    if (error) {
      return fail({ kind: "auth", code: "unknown", message: error.message });
    }
    return ok(undefined);
  }

  async getSession(): Promise<Result<AuthSession | null, AuthError>> {
    const {
      data: { session },
      error,
    } = await this.client.auth.getSession();
    if (error) {
      return fail({
        kind: "auth",
        code: "token_expired",
        message: error.message,
      });
    }
    return ok(session ? this.mapSession(session) : null);
  }

  onAuthStateChange(
    callback: (session: AuthSession | null) => void,
  ): () => void {
    const {
      data: { subscription },
    } = this.client.auth.onAuthStateChange((_event, session) => {
      callback(session ? this.mapSession(session) : null);
    });
    return () => subscription.unsubscribe();
  }

  async resetPassword(email: string): Promise<Result<void, AuthError>> {
    const { error } = await this.client.auth.resetPasswordForEmail(email);
    if (error) {
      return fail({ kind: "auth", code: "unknown", message: error.message });
    }
    return ok(undefined);
  }

  async refreshSession(): Promise<Result<AuthSession, AuthError>> {
    const { data, error } = await this.client.auth.refreshSession();
    if (error || !data.session) {
      return fail({
        kind: "auth",
        code: "token_expired",
        message: error?.message ?? "No session",
      });
    }
    return ok(this.mapSession(data.session));
  }

  async getAccessToken(): Promise<string | null> {
    const {
      data: { session },
    } = await this.client.auth.getSession();
    return session?.access_token ?? null;
  }

  private mapSession(session: {
    access_token: string;
    refresh_token: string;
    user: { id: string; email?: string };
    expires_at?: number;
  }): AuthSession {
    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      userId: session.user.id,
      email: session.user.email ?? "",
      expiresAt: session.expires_at ?? 0,
    };
  }
}
