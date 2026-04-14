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
  signOut(): Promise<Result<void, AuthError>>;
  getSession(): Promise<Result<AuthSession | null, AuthError>>;
  onAuthStateChange(
    callback: (session: AuthSession | null) => void,
  ): () => void;
  resetPassword(email: string): Promise<Result<void, AuthError>>;
  refreshSession(): Promise<Result<AuthSession, AuthError>>;
  getAccessToken(): Promise<string | null>;
}
