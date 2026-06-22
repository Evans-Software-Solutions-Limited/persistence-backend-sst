import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createClient,
  processLock,
  type SupabaseClient,
} from "@supabase/supabase-js";
import * as AppleAuthentication from "expo-apple-authentication";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
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
 * Per-provider OAuth query params forwarded to the upstream provider via
 * Supabase's `signInWithOAuth({ options: { queryParams } })`. Forces the
 * provider's account picker on every sign-in so that signing out and
 * back in lets the user choose a different account — without these
 * hints, the system browser's provider-side cookie was silently
 * re-authenticating the previously-signed-in account.
 *
 * - Google: `prompt=select_account` is the canonical hint.
 * - Facebook: `auth_type=reauthenticate` re-asks for credentials.
 * - Apple: no equivalent hint — Sign in with Apple handles account
 *   selection natively, so no params needed.
 */
const QUERY_PARAMS_BY_PROVIDER: Record<
  OAuthProvider,
  Record<string, string> | undefined
> = {
  google: { prompt: "select_account" },
  facebook: { auth_type: "reauthenticate" },
  apple: undefined,
};

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
      console.error(
        "[SupabaseAuthAdapter] Missing config — URL:",
        supabaseUrl ? "set" : "MISSING",
        "Key:",
        supabaseAnonKey ? "set" : "MISSING",
      );
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
        lock: processLock,
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
    provider: OAuthProvider,
  ): Promise<Result<AuthSession, AuthError>> {
    try {
      // Linking.createURL handles both Expo Go (exp://) and production (persistencemobile://)
      const redirectUrl = Linking.createURL("auth/callback");

      // `prompt=select_account` (Google) / `auth_type=reauthenticate`
      // (Facebook) tells the provider to show the account picker on
      // every sign-in instead of silently re-using the cached login.
      // Without this, after Supabase sign-out the system browser's
      // provider-side cookie was still valid → the next OAuth start
      // logged the user back into the same account with no picker.
      const queryParams = QUERY_PARAMS_BY_PROVIDER[provider];

      const { data, error } = await this.client.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
          queryParams,
        },
      });

      if (error || !data.url) {
        return fail({
          kind: "auth",
          code: "unknown",
          message: error?.message ?? "Failed to start OAuth flow",
        });
      }

      // `preferEphemeralSession: true` runs the auth web view in an
      // isolated cookie jar. Belt-and-braces with `prompt=select_account`
      // — even if the provider ignores the prompt hint, an ephemeral
      // session means no cached cookies to silently re-auth against.
      // iOS only; Android `WebBrowser.openAuthSessionAsync` ignores it.
      const result = await WebBrowser.openAuthSessionAsync(
        data.url,
        redirectUrl,
        { preferEphemeralSession: true },
      );

      if (result.type !== "success") {
        return fail({
          kind: "auth",
          code: "unknown",
          message: "OAuth sign-in was cancelled",
        });
      }

      // Supabase returns tokens in the URL hash fragment OR as query params
      const url = result.url;
      const params = this.extractOAuthParams(url);

      if (!params.accessToken || !params.refreshToken) {
        return fail({
          kind: "auth",
          code: "unknown",
          message: "No tokens received from OAuth provider",
        });
      }

      const { data: sessionData, error: sessionError } =
        await this.client.auth.setSession({
          access_token: params.accessToken,
          refresh_token: params.refreshToken,
        });

      if (sessionError || !sessionData.session) {
        return fail({
          kind: "auth",
          code: "unknown",
          message: sessionError?.message ?? "Failed to set session",
        });
      }

      return ok(this.mapSession(sessionData.session));
    } catch (err) {
      return fail({
        kind: "auth",
        code: "unknown",
        message: err instanceof Error ? err.message : "OAuth failed",
      });
    }
  }

  async signInWithApple(): Promise<Result<AuthSession, AuthError>> {
    try {
      // Native Apple sheet (Face ID / Hide My Email). FULL_NAME + EMAIL
      // are only returned on the *first* authorization for this app.
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        return fail({
          kind: "auth",
          code: "unknown",
          message: "No identity token returned from Apple",
        });
      }

      // Exchange the Apple identity token for a Supabase session. Requires
      // the Apple provider enabled in Supabase with this app's bundle ID
      // registered under "Client IDs" (see auth-apple Supabase docs).
      const { data, error } = await this.client.auth.signInWithIdToken({
        provider: "apple",
        token: credential.identityToken,
      });

      if (error || !data.session) {
        return fail({
          kind: "auth",
          code: "unknown",
          message: error?.message ?? "Failed to sign in with Apple",
        });
      }

      // Apple only sends the full name on the first sign-in and it is NOT
      // in the identity token's claims, so Supabase can't populate it for
      // us. Persist it to user metadata when present (best-effort — never
      // fail the sign-in if the metadata write fails).
      if (credential.fullName) {
        const { givenName, middleName, familyName } = credential.fullName;
        const fullName = [givenName, middleName, familyName]
          .filter(Boolean)
          .join(" ")
          .trim();
        if (fullName) {
          try {
            await this.client.auth.updateUser({
              data: {
                full_name: fullName,
                given_name: givenName ?? undefined,
                family_name: familyName ?? undefined,
              },
            });
          } catch {
            // Best-effort metadata write; the user is already signed in.
          }
        }
      }

      return ok(this.mapSession(data.session));
    } catch (err) {
      // User dismissed the native sheet — not a real failure. Surface a
      // distinct code so callers can treat it as a silent no-op.
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code?: string }).code === "ERR_REQUEST_CANCELED"
      ) {
        return fail({
          kind: "auth",
          code: "cancelled",
          message: "Sign in with Apple was cancelled",
        });
      }
      return fail({
        kind: "auth",
        code: "unknown",
        message:
          err instanceof Error ? err.message : "Sign in with Apple failed",
      });
    }
  }

  /**
   * Extract access_token and refresh_token from the OAuth redirect URL.
   * Supabase may place them in the hash fragment (#) or query string (?).
   */
  private extractOAuthParams(url: string): {
    accessToken: string | null;
    refreshToken: string | null;
  } {
    // Try hash fragment first (most common with Supabase)
    if (url.includes("#")) {
      const hash = url.split("#")[1];
      const params = new URLSearchParams(hash);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (accessToken && refreshToken) {
        return { accessToken, refreshToken };
      }
    }

    // Fall back to query params
    const queryStart = url.indexOf("?");
    if (queryStart !== -1) {
      const params = new URLSearchParams(url.substring(queryStart + 1));
      return {
        accessToken: params.get("access_token"),
        refreshToken: params.get("refresh_token"),
      };
    }

    return { accessToken: null, refreshToken: null };
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
