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
  getSession(): Promise<Result<AuthSession | null, AuthError>>;
  onAuthStateChange(
    callback: (session: AuthSession | null) => void,
  ): () => void;
  resetPassword(email: string): Promise<Result<void, AuthError>>;
  refreshSession(): Promise<Result<AuthSession, AuthError>>;
  getAccessToken(): Promise<string | null>;
}
