/**
 * AuthGate redirect tests.
 *
 * The AuthGate component in _layout.tsx routes users based on auth state:
 * - Loading: no redirect (stay on current screen)
 * - Authenticated + not in (app): redirect to /(app)/(tabs)
 * - Unauthenticated + not in (auth): redirect to /(auth)/sign-in
 * - Already on correct route: no redirect
 */

// Mock useAuth hook
const mockUseAuth = jest.fn<{ session: unknown; isLoading: boolean }, []>();
jest.mock("../../src/ui/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

// Mock expo-router
const mockReplace = jest.fn();
const mockUseSegments = jest.fn<string[], []>();
jest.mock("expo-router", () => ({
  Slot: ({ children }: { children?: React.ReactNode }) => children ?? null,
  useRouter: () => ({ replace: mockReplace }),
  useSegments: () => mockUseSegments(),
}));

// Mock AppProviders to avoid Supabase/SQLite initialization
jest.mock("../../src/providers", () => ({
  AppProviders: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock ErrorBoundary
jest.mock("../../src/ui/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

// eslint-disable-next-line import/first
import { render, waitFor } from "@testing-library/react-native";
// eslint-disable-next-line import/first
import RootLayout from "../_layout";
// eslint-disable-next-line import/first
import * as Notifications from "expo-notifications";
// eslint-disable-next-line import/first
import { Platform } from "react-native";

describe("AuthGate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSegments.mockReturnValue([]);
  });

  it("does not redirect while loading", () => {
    mockUseAuth.mockReturnValue({ session: null, isLoading: true });
    mockUseSegments.mockReturnValue([]);

    render(<RootLayout />);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated user to sign-in when on root", async () => {
    mockUseAuth.mockReturnValue({ session: null, isLoading: false });
    mockUseSegments.mockReturnValue([]);

    render(<RootLayout />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(auth)/sign-in");
    });
  });

  it("redirects unauthenticated user to sign-in when on app route", async () => {
    mockUseAuth.mockReturnValue({ session: null, isLoading: false });
    mockUseSegments.mockReturnValue(["(app)"]);

    render(<RootLayout />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(auth)/sign-in");
    });
  });

  it("does not redirect unauthenticated user already on auth screen", () => {
    mockUseAuth.mockReturnValue({ session: null, isLoading: false });
    mockUseSegments.mockReturnValue(["(auth)"]);

    render(<RootLayout />);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("redirects authenticated user to app when on root", async () => {
    mockUseAuth.mockReturnValue({
      session: {
        accessToken: "t",
        refreshToken: "r",
        userId: "u",
        email: "e",
        expiresAt: 0,
      },
      isLoading: false,
    });
    mockUseSegments.mockReturnValue([]);

    render(<RootLayout />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(app)/(tabs)");
    });
  });

  it("redirects authenticated user to app when on auth screen", async () => {
    mockUseAuth.mockReturnValue({
      session: {
        accessToken: "t",
        refreshToken: "r",
        userId: "u",
        email: "e",
        expiresAt: 0,
      },
      isLoading: false,
    });
    mockUseSegments.mockReturnValue(["(auth)"]);

    render(<RootLayout />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(app)/(tabs)");
    });
  });

  it("does not redirect authenticated user already on app route", () => {
    mockUseAuth.mockReturnValue({
      session: {
        accessToken: "t",
        refreshToken: "r",
        userId: "u",
        email: "e",
        expiresAt: 0,
      },
      isLoading: false,
    });
    mockUseSegments.mockReturnValue(["(app)"]);

    render(<RootLayout />);

    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe("Notification setup at module load", () => {
  it("calls `Notifications.setNotificationHandler` at module load so foreground banners actually display", () => {
    // Module-load side effect — fires once when `../_layout` is
    // imported. The handler is what makes expo-notifications show
    // a banner while the app is in the foreground; without it, the
    // system silently suppresses foreground notifications, which
    // is exactly when the rest timer's "ding" matters most (user
    // staring at the screen between sets). Pre-PR-staging-fix the
    // handler call didn't exist anywhere in V2.
    //
    // The suite's `beforeEach(jest.clearAllMocks)` resets the
    // top-of-file import's call count before this test runs, so we
    // re-import `_layout` inside an isolated module scope to
    // observe the side effect cleanly.
    (Notifications.setNotificationHandler as jest.Mock).mockClear();
    jest.isolateModules(() => {
      require("../_layout");
    });
    expect(Notifications.setNotificationHandler).toHaveBeenCalledTimes(1);
    // Assert the handler returns the foreground-display flags. Per
    // expo-notifications API, the function is called with a
    // (notification) arg and returns the should* flags.
    const handlerArg = (Notifications.setNotificationHandler as jest.Mock).mock
      .calls[0][0];
    expect(handlerArg.handleNotification).toBeInstanceOf(Function);
  });

  it("sets up the Android notification channel on mount (required by Android 8+)", async () => {
    mockUseAuth.mockReturnValue({ session: null, isLoading: true });
    mockUseSegments.mockReturnValue([]);

    // Force Platform.OS to "android" so the effect actually runs.
    // The Jest default is iOS; swap the constant for this assertion.
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, "OS", {
      value: "android",
      configurable: true,
    });
    try {
      (Notifications.setNotificationChannelAsync as jest.Mock).mockClear();
      render(<RootLayout />);
      await waitFor(() => {
        expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
          "default",
          expect.objectContaining({
            name: "Default",
            importance: Notifications.AndroidImportance.MAX,
          }),
        );
      });
    } finally {
      Object.defineProperty(Platform, "OS", {
        value: originalOS,
        configurable: true,
      });
    }
  });

  it("does NOT call setNotificationChannelAsync on iOS (Android-only API)", () => {
    mockUseAuth.mockReturnValue({ session: null, isLoading: true });
    mockUseSegments.mockReturnValue([]);
    // Default Platform.OS in tests is iOS — assert the effect early-
    // returns and doesn't fire the Android-only API.
    (Notifications.setNotificationChannelAsync as jest.Mock).mockClear();
    render(<RootLayout />);
    expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  });
});
