/**
 * Supabase auth adapter tests.
 *
 * These test the SupabaseAuthAdapter against a mocked Supabase client.
 * They verify that each AuthPort method correctly delegates to the
 * Supabase SDK and maps responses into our Result<T, AuthError> types.
 */

// --- Native module mocks (must be before any imports that touch them) ---
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    multiGet: jest.fn(),
    multiSet: jest.fn(),
    multiRemove: jest.fn(),
    clear: jest.fn(),
  },
}));

// --- Supabase client mock ---
const mockSignInWithPassword = jest.fn();
const mockSignUp = jest.fn();
const mockSignInWithOAuth = jest.fn();
const mockSignOut = jest.fn();
const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn();
const mockResetPasswordForEmail = jest.fn();
const mockRefreshSession = jest.fn();
const mockSetSession = jest.fn();
const mockSignInWithIdToken = jest.fn();
const mockUpdateUser = jest.fn();
const mockStartAutoRefresh = jest.fn();
const mockStopAutoRefresh = jest.fn();

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      signUp: mockSignUp,
      signInWithOAuth: mockSignInWithOAuth,
      signInWithIdToken: mockSignInWithIdToken,
      updateUser: mockUpdateUser,
      signOut: mockSignOut,
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      resetPasswordForEmail: mockResetPasswordForEmail,
      refreshSession: mockRefreshSession,
      setSession: mockSetSession,
      startAutoRefresh: mockStartAutoRefresh,
      stopAutoRefresh: mockStopAutoRefresh,
    },
  }),
  processLock: jest.fn(),
}));

jest.mock("expo-apple-authentication", () => ({
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

jest.mock("expo-constants", () => ({
  expoConfig: {
    extra: {
      supabaseUrl: "https://test.supabase.co",
      supabaseAnonKey: "test-anon-key",
    },
  },
}));

jest.mock("expo-linking", () => ({
  createURL: jest.fn((path: string) => `persistencemobile://${path}`),
}));

jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: jest.fn(),
}));

// eslint-disable-next-line import/first
import * as WebBrowser from "expo-web-browser";
// eslint-disable-next-line import/first
import * as AppleAuthentication from "expo-apple-authentication";
// eslint-disable-next-line import/first
import { SupabaseAuthAdapter } from "../supabase.adapter";

const MOCK_SUPABASE_SESSION = {
  access_token: "access-123",
  refresh_token: "refresh-456",
  user: { id: "user-789", email: "test@example.com" },
  expires_at: 1700000000,
};

const EXPECTED_AUTH_SESSION = {
  accessToken: "access-123",
  refreshToken: "refresh-456",
  userId: "user-789",
  email: "test@example.com",
  expiresAt: 1700000000,
};

describe("SupabaseAuthAdapter", () => {
  let adapter: SupabaseAuthAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: onAuthStateChange returns a subscription
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    });
    adapter = new SupabaseAuthAdapter();
  });

  afterEach(() => {
    adapter.destroy();
  });

  // -- signInWithEmail --

  describe("signInWithEmail", () => {
    it("returns mapped session on success", async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { session: MOCK_SUPABASE_SESSION },
        error: null,
      });

      const result = await adapter.signInWithEmail("test@example.com", "pass");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(EXPECTED_AUTH_SESSION);
      }
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: "test@example.com",
        password: "pass",
      });
    });

    it("returns invalid_credentials error on failure", async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: { session: null },
        error: { message: "Invalid login credentials" },
      });

      const result = await adapter.signInWithEmail("bad@email.com", "wrong");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("auth");
        expect(result.error.code).toBe("invalid_credentials");
        expect(result.error.message).toBe("Invalid login credentials");
      }
    });
  });

  // -- signUpWithEmail --

  describe("signUpWithEmail", () => {
    it("returns session when auto-confirmed", async () => {
      mockSignUp.mockResolvedValue({
        data: { session: MOCK_SUPABASE_SESSION },
        error: null,
      });

      const result = await adapter.signUpWithEmail("new@user.com", "pass123");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.userId).toBe("user-789");
      }
    });

    it("returns email_confirmation_required when no session returned", async () => {
      mockSignUp.mockResolvedValue({
        data: { session: null, user: { id: "pending-user" } },
        error: null,
      });

      const result = await adapter.signUpWithEmail("new@user.com", "pass123");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("email_confirmation_required");
      }
    });

    it("returns email_taken when user already registered", async () => {
      mockSignUp.mockResolvedValue({
        data: {},
        error: { message: "User already registered" },
      });

      const result = await adapter.signUpWithEmail("taken@user.com", "pass");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("email_taken");
      }
    });

    it("returns unknown error for other failures", async () => {
      mockSignUp.mockResolvedValue({
        data: {},
        error: { message: "Rate limit exceeded" },
      });

      const result = await adapter.signUpWithEmail("user@test.com", "pass");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("unknown");
      }
    });
  });

  // -- signInWithOAuth --

  describe("signInWithOAuth", () => {
    it("returns session after successful OAuth flow with hash params", async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: { url: "https://supabase.co/auth/v1/authorize?provider=google" },
        error: null,
      });

      (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
        type: "success",
        url: "persistencemobile://auth/callback#access_token=oauth-access&refresh_token=oauth-refresh",
      });

      mockSetSession.mockResolvedValue({
        data: {
          session: {
            ...MOCK_SUPABASE_SESSION,
            access_token: "oauth-access",
            refresh_token: "oauth-refresh",
          },
        },
        error: null,
      });

      const result = await adapter.signInWithOAuth("google");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.accessToken).toBe("oauth-access");
      }
      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: "oauth-access",
        refresh_token: "oauth-refresh",
      });
    });

    it("extracts tokens from query params as fallback", async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: { url: "https://supabase.co/auth" },
        error: null,
      });

      (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
        type: "success",
        url: "persistencemobile://auth/callback?access_token=query-access&refresh_token=query-refresh",
      });

      mockSetSession.mockResolvedValue({
        data: {
          session: {
            ...MOCK_SUPABASE_SESSION,
            access_token: "query-access",
            refresh_token: "query-refresh",
          },
        },
        error: null,
      });

      const result = await adapter.signInWithOAuth("google");

      expect(result.ok).toBe(true);
      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: "query-access",
        refresh_token: "query-refresh",
      });
    });

    it("returns error when user cancels OAuth", async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: { url: "https://supabase.co/auth" },
        error: null,
      });

      (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
        type: "cancel",
      });

      const result = await adapter.signInWithOAuth("google");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("cancelled");
      }
    });

    it("returns error when no tokens in redirect URL", async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: { url: "https://supabase.co/auth" },
        error: null,
      });

      (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
        type: "success",
        url: "persistencemobile://auth/callback",
      });

      const result = await adapter.signInWithOAuth("apple");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("No tokens");
      }
    });

    it("returns error when OAuth initiation fails", async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: { url: null },
        error: { message: "Provider not enabled" },
      });

      const result = await adapter.signInWithOAuth("facebook");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("Provider not enabled");
      }
    });

    it("forwards prompt=select_account to Google so the account picker shows on every sign-in", async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: { url: "https://supabase.co/auth" },
        error: null,
      });
      (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
        type: "cancel",
      });

      await adapter.signInWithOAuth("google");

      expect(mockSignInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "google",
          options: expect.objectContaining({
            queryParams: { prompt: "select_account" },
          }),
        }),
      );
    });

    it("forwards auth_type=reauthenticate to Facebook for the same reason", async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: { url: "https://supabase.co/auth" },
        error: null,
      });
      (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
        type: "cancel",
      });

      await adapter.signInWithOAuth("facebook");

      expect(mockSignInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "facebook",
          options: expect.objectContaining({
            queryParams: { auth_type: "reauthenticate" },
          }),
        }),
      );
    });

    it("omits queryParams for Apple (provider has no equivalent hint)", async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: { url: "https://supabase.co/auth" },
        error: null,
      });
      (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
        type: "cancel",
      });

      await adapter.signInWithOAuth("apple");

      expect(mockSignInWithOAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "apple",
          options: expect.objectContaining({ queryParams: undefined }),
        }),
      );
    });

    it("opens the auth web view with preferEphemeralSession=true so the system browser's provider cookie can't silently re-auth", async () => {
      mockSignInWithOAuth.mockResolvedValue({
        data: { url: "https://supabase.co/auth" },
        error: null,
      });
      (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
        type: "cancel",
      });

      await adapter.signInWithOAuth("google");

      expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
        "https://supabase.co/auth",
        expect.any(String),
        { preferEphemeralSession: true },
      );
    });
  });

  // -- signInWithApple (native) --

  describe("signInWithApple", () => {
    const signInAsync = AppleAuthentication.signInAsync as jest.Mock;

    it("exchanges the Apple identity token for a Supabase session", async () => {
      signInAsync.mockResolvedValue({
        identityToken: "apple-id-token",
        fullName: null,
      });
      mockSignInWithIdToken.mockResolvedValue({
        data: { session: MOCK_SUPABASE_SESSION },
        error: null,
      });

      const result = await adapter.signInWithApple();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(EXPECTED_AUTH_SESSION);
      }
      expect(mockSignInWithIdToken).toHaveBeenCalledWith({
        provider: "apple",
        token: "apple-id-token",
      });
      // No name returned → no metadata write.
      expect(mockUpdateUser).not.toHaveBeenCalled();
    });

    it("persists the full name to user metadata on first sign-in", async () => {
      signInAsync.mockResolvedValue({
        identityToken: "apple-id-token",
        fullName: {
          givenName: "Ada",
          middleName: null,
          familyName: "Lovelace",
        },
      });
      mockSignInWithIdToken.mockResolvedValue({
        data: { session: MOCK_SUPABASE_SESSION },
        error: null,
      });
      mockUpdateUser.mockResolvedValue({ data: {}, error: null });

      const result = await adapter.signInWithApple();

      expect(result.ok).toBe(true);
      expect(mockUpdateUser).toHaveBeenCalledWith({
        data: {
          full_name: "Ada Lovelace",
          given_name: "Ada",
          family_name: "Lovelace",
        },
      });
    });

    it("still signs in when the metadata write fails", async () => {
      signInAsync.mockResolvedValue({
        identityToken: "apple-id-token",
        fullName: { givenName: "Ada", middleName: null, familyName: null },
      });
      mockSignInWithIdToken.mockResolvedValue({
        data: { session: MOCK_SUPABASE_SESSION },
        error: null,
      });
      mockUpdateUser.mockRejectedValue(new Error("metadata write failed"));

      const result = await adapter.signInWithApple();

      expect(result.ok).toBe(true);
    });

    it("returns an error when Apple provides no identity token", async () => {
      signInAsync.mockResolvedValue({ identityToken: null, fullName: null });

      const result = await adapter.signInWithApple();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("No identity token");
      }
      expect(mockSignInWithIdToken).not.toHaveBeenCalled();
    });

    it("returns an error when the token exchange fails", async () => {
      signInAsync.mockResolvedValue({
        identityToken: "apple-id-token",
        fullName: null,
      });
      mockSignInWithIdToken.mockResolvedValue({
        data: { session: null },
        error: { message: "Apple provider not enabled" },
      });

      const result = await adapter.signInWithApple();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("Apple provider not enabled");
      }
    });

    it("maps a user cancellation to the 'cancelled' code (silent no-op)", async () => {
      signInAsync.mockRejectedValue({ code: "ERR_REQUEST_CANCELED" });

      const result = await adapter.signInWithApple();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("cancelled");
      }
    });

    it("returns an unknown error for other native failures", async () => {
      signInAsync.mockRejectedValue(new Error("Apple services unavailable"));

      const result = await adapter.signInWithApple();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("unknown");
        expect(result.error.message).toBe("Apple services unavailable");
      }
    });
  });

  // -- signOut --

  describe("signOut", () => {
    it("returns ok on successful sign-out", async () => {
      mockSignOut.mockResolvedValue({ error: null });

      const result = await adapter.signOut();

      expect(result.ok).toBe(true);
    });

    it("returns error when sign-out fails", async () => {
      mockSignOut.mockResolvedValue({ error: { message: "Network error" } });

      const result = await adapter.signOut();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("Network error");
      }
    });
  });

  // -- getSession --

  describe("getSession", () => {
    it("returns mapped session when one exists", async () => {
      mockGetSession.mockResolvedValue({
        data: { session: MOCK_SUPABASE_SESSION },
        error: null,
      });

      const result = await adapter.getSession();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(EXPECTED_AUTH_SESSION);
      }
    });

    it("returns null when no session exists", async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const result = await adapter.getSession();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it("returns error on failure", async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: { message: "Token expired" },
      });

      const result = await adapter.getSession();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("token_expired");
      }
    });
  });

  // -- onAuthStateChange --

  describe("onAuthStateChange", () => {
    it("subscribes and returns unsubscribe function", () => {
      const mockUnsubscribe = jest.fn();
      mockOnAuthStateChange.mockReturnValue({
        data: { subscription: { unsubscribe: mockUnsubscribe } },
      });

      // Need a fresh adapter since constructor already called onAuthStateChange
      const freshAdapter = new SupabaseAuthAdapter();
      const callback = jest.fn();
      const unsub = freshAdapter.onAuthStateChange(callback);

      expect(typeof unsub).toBe("function");
      unsub();
      expect(mockUnsubscribe).toHaveBeenCalled();

      freshAdapter.destroy();
    });
  });

  // -- resetPassword --

  describe("resetPassword", () => {
    it("returns ok on success", async () => {
      mockResetPasswordForEmail.mockResolvedValue({ error: null });

      const result = await adapter.resetPassword("test@example.com");

      expect(result.ok).toBe(true);
      expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
        "test@example.com",
      );
    });

    it("returns error on failure", async () => {
      mockResetPasswordForEmail.mockResolvedValue({
        error: { message: "Rate limited" },
      });

      const result = await adapter.resetPassword("test@example.com");

      expect(result.ok).toBe(false);
    });
  });

  // -- refreshSession --

  describe("refreshSession", () => {
    it("returns refreshed session on success", async () => {
      mockRefreshSession.mockResolvedValue({
        data: { session: MOCK_SUPABASE_SESSION },
        error: null,
      });

      const result = await adapter.refreshSession();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.accessToken).toBe("access-123");
      }
    });

    it("returns token_expired when no session", async () => {
      mockRefreshSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const result = await adapter.refreshSession();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("token_expired");
      }
    });
  });

  // -- getAccessToken --

  describe("getAccessToken", () => {
    it("returns token when session exists", async () => {
      mockGetSession.mockResolvedValue({
        data: { session: MOCK_SUPABASE_SESSION },
        error: null,
      });

      const token = await adapter.getAccessToken();

      expect(token).toBe("access-123");
    });

    it("returns null when no session", async () => {
      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      const token = await adapter.getAccessToken();

      expect(token).toBeNull();
    });
  });

  // -- destroy --

  describe("destroy", () => {
    it("can be called multiple times safely", () => {
      adapter.destroy();
      adapter.destroy(); // should not throw
    });
  });
});
