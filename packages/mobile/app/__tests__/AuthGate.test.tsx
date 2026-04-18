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
