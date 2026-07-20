import type { Result, AuthError } from "@/shared/errors";

export type OAuthProvider = "google" | "apple" | "facebook";

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  expiresAt: number;
};

export interface AuthPort {
  signInWithEmail(
    email: string,
    password: string,
  ): Promise<Result<AuthSession, AuthError>>;
  signUpWithEmail(
    email: string,
    password: string,
  ): Promise<Result<AuthSession, AuthError>>;
  signInWithOAuth(
    provider: OAuthProvider,
  ): Promise<Result<AuthSession, AuthError>>;
  /**
   * Native Sign in with Apple (iOS). Uses Apple's Authentication Services
   * to obtain an identity token, then exchanges it with Supabase via
   * `signInWithIdToken`. This is the App Store–compliant path — Apple
   * requires native Sign in with Apple when other social logins are
   * offered, and it gives the native sheet (Face ID, Hide My Email)
   * rather than a browser pop-up.
   *
   * Only meaningful on iOS; non-iOS callers should fall back to
   * `signInWithOAuth("apple")`. Returns an `AuthError` with code
   * `"cancelled"` when the user dismisses the sheet.
   */
  signInWithApple(): Promise<Result<AuthSession, AuthError>>;
  signOut(): Promise<Result<void, AuthError>>;
  /**
   * Establish a session from tokens handed back by an auth redirect
   * (email-confirmation / password-recovery / OAuth implicit flow). Used by
   * the `auth/callback` deep-link screen when the app is cold-opened from a
   * Supabase confirmation link on-device. Persists the session and fires
   * `onAuthStateChange`, so callers let the auth gate route into the app
   * rather than navigating on success themselves.
   */
  setSessionFromTokens(
    accessToken: string,
    refreshToken: string,
  ): Promise<Result<AuthSession, AuthError>>;
  getSession(): Promise<Result<AuthSession | null, AuthError>>;
  onAuthStateChange(
    callback: (session: AuthSession | null) => void,
  ): () => void;
  resetPassword(email: string): Promise<Result<void, AuthError>>;
  /**
   * Change the signed-in user's password. Requires a live session — used by
   * the set-new-password screen after a recovery link establishes one (via
   * `setSessionFromTokens`). Distinct from `resetPassword`, which only sends
   * the recovery email.
   */
  updatePassword(newPassword: string): Promise<Result<void, AuthError>>;
  refreshSession(): Promise<Result<AuthSession, AuthError>>;
  getAccessToken(): Promise<string | null>;
}
