import { act, render, waitFor } from "@testing-library/react-native";
import { TamaguiProvider } from "@tamagui/core";
import type { ReactNode } from "react";
import { StyleSheet } from "react-native";
import config from "../../../../tamagui.config";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { Adapters } from "@/shared/types";
import { usePasswordRecovery } from "@/state/password-recovery";
import { AuthCallbackContainer } from "../AuthCallbackContainer";

// The launch URL comes from expo-linking's useURL hook — control it per test.
let mockUrl: string | null = null;
jest.mock("expo-linking", () => ({
  useURL: () => mockUrl,
}));

// The root-captured URL (warm-start path). Defaults to null so existing tests
// exercise the useURL fallback unchanged.
let mockCapturedUrl: string | null = null;
const mockClearAuthCallbackUrl = jest.fn();
jest.mock("@/ui/hooks/useAuthCallbackUrl", () => ({
  useAuthCallbackUrl: () => mockCapturedUrl,
  clearAuthCallbackUrl: () => mockClearAuthCallbackUrl(),
}));

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

// The loader pulls in animation-heavy components; stub it — this container's
// behaviour is the effect, not the spinner.
jest.mock("@/ui/components", () => ({
  PLogoDrawLoader: () => null,
}));

function createTestAdapters(): {
  adapters: Adapters;
  auth: InMemoryAuthAdapter;
} {
  const auth = new InMemoryAuthAdapter();
  const adapters: Adapters = {
    api: new InMemoryApiAdapter(),
    auth,
    storage: new InMemoryStorageAdapter(),
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
  };
  return { adapters, auth };
}

function TestWrapper({
  children,
  adapters,
}: {
  children: ReactNode;
  adapters: Adapters;
}) {
  return (
    <TamaguiProvider config={config} defaultTheme="dark">
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    </TamaguiProvider>
  );
}

describe("AuthCallbackContainer", () => {
  beforeEach(() => {
    mockUrl = null;
    mockCapturedUrl = null;
    mockClearAuthCallbackUrl.mockClear();
    mockReplace.mockClear();
    usePasswordRecovery.setState({ pending: false });
  });

  it("keeps the full-screen callback loader on the canonical dark surface", () => {
    const { adapters } = createTestAdapters();

    const view = render(
      <TestWrapper adapters={adapters}>
        <AuthCallbackContainer />
      </TestWrapper>,
    );

    expect(
      StyleSheet.flatten(view.getByTestId("auth-callback-loading").props.style),
    ).toEqual(expect.objectContaining({ backgroundColor: "#0A0B12" }));
  });

  it("establishes a session from the fragment tokens and lets AuthGate route (no explicit nav)", async () => {
    mockUrl =
      "persistencemobile://auth/callback#access_token=abc&refresh_token=def&type=signup";
    const { adapters, auth } = createTestAdapters();

    render(
      <TestWrapper adapters={adapters}>
        <AuthCallbackContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(auth.currentSession).not.toBeNull();
    });
    expect(auth.currentSession?.accessToken).toBe("abc");
    expect(auth.currentSession?.refreshToken).toBe("def");
    // Success path defers navigation to AuthGate.
    expect(mockReplace).not.toHaveBeenCalled();
    // Not a recovery link — no divert flag set.
    expect(usePasswordRecovery.getState().pending).toBe(false);
  });

  it("flags password-recovery before establishing the session so AuthGate diverts", async () => {
    mockUrl =
      "persistencemobile://auth/callback#access_token=abc&refresh_token=def&type=recovery";
    const { adapters, auth } = createTestAdapters();

    render(
      <TestWrapper adapters={adapters}>
        <AuthCallbackContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(auth.currentSession).not.toBeNull();
    });
    // Flag set; navigation is left to AuthGate (→ set-new-password).
    expect(usePasswordRecovery.getState().pending).toBe(true);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("clears the recovery flag and bounces to sign-in if a recovery session fails", async () => {
    mockUrl =
      "persistencemobile://auth/callback#access_token=abc&refresh_token=def&type=recovery";
    const { adapters, auth } = createTestAdapters();
    auth.shouldFail = true;

    render(
      <TestWrapper adapters={adapters}>
        <AuthCallbackContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(auth)/sign-in");
    });
    // Flag undone so it can't divert a later normal sign-in.
    expect(usePasswordRecovery.getState().pending).toBe(false);
  });

  it("bounces to sign-in when the link carries no tokens (error fragment)", async () => {
    mockUrl =
      "persistencemobile://auth/callback#error=access_denied&error_description=Email+link+is+invalid";
    const { adapters, auth } = createTestAdapters();

    render(
      <TestWrapper adapters={adapters}>
        <AuthCallbackContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(auth)/sign-in");
    });
    expect(auth.currentSession).toBeNull();
  });

  it("bounces to sign-in when setting the session fails (expired/used token)", async () => {
    mockUrl =
      "persistencemobile://auth/callback#access_token=abc&refresh_token=def";
    const { adapters, auth } = createTestAdapters();
    auth.shouldFail = true;

    render(
      <TestWrapper adapters={adapters}>
        <AuthCallbackContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(auth)/sign-in");
    });
  });

  it("bounces to sign-in if setSessionFromTokens throws (defensive catch)", async () => {
    mockUrl =
      "persistencemobile://auth/callback#access_token=abc&refresh_token=def";
    const { adapters, auth } = createTestAdapters();
    auth.setSessionFromTokens = jest
      .fn()
      .mockRejectedValue(new Error("network down"));

    render(
      <TestWrapper adapters={adapters}>
        <AuthCallbackContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(auth)/sign-in");
    });
  });

  it("does nothing until the launch URL resolves", () => {
    mockUrl = null;
    const { adapters, auth } = createTestAdapters();

    render(
      <TestWrapper adapters={adapters}>
        <AuthCallbackContainer />
      </TestWrapper>,
    );

    expect(auth.currentSession).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("uses the root-captured URL (warm start) when useURL is still null, and clears it", async () => {
    // Regression for the prod stuck-loading: on a warm start `useURL` misses
    // the event, so the container must consume the root-captured URL instead.
    mockUrl = null;
    mockCapturedUrl =
      "persistencemobile://auth/callback#access_token=warm&refresh_token=warm2&type=signup";
    const { adapters, auth } = createTestAdapters();

    render(
      <TestWrapper adapters={adapters}>
        <AuthCallbackContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(auth.currentSession?.accessToken).toBe("warm");
    });
    // Consumed so a later mount can't reprocess a stale link.
    expect(mockClearAuthCallbackUrl).toHaveBeenCalled();
  });

  it("bounces to sign-in after the timeout when no URL ever resolves (never strands the user)", () => {
    jest.useFakeTimers();
    try {
      mockUrl = null;
      mockCapturedUrl = null;
      const { adapters } = createTestAdapters();

      render(
        <TestWrapper adapters={adapters}>
          <AuthCallbackContainer />
        </TestWrapper>,
      );

      // Nothing yet — the spinner is showing.
      expect(mockReplace).not.toHaveBeenCalled();
      act(() => {
        jest.advanceTimersByTime(12_000);
      });
      expect(mockReplace).toHaveBeenCalledWith("/(auth)/sign-in");
    } finally {
      jest.useRealTimers();
    }
  });

  it("bounces to sign-in when session establishment STALLS past the timeout (offline confirm)", () => {
    jest.useFakeTimers();
    try {
      mockUrl =
        "persistencemobile://auth/callback#access_token=abc&refresh_token=def";
      const { adapters, auth } = createTestAdapters();
      // setSessionFromTokens never resolves — the exact offline hang the plain
      // "handled" guard failed to cover.
      auth.setSessionFromTokens = jest.fn(() => new Promise(() => {}));

      render(
        <TestWrapper adapters={adapters}>
          <AuthCallbackContainer />
        </TestWrapper>,
      );

      // Processing started, but no terminal outcome yet.
      expect(mockReplace).not.toHaveBeenCalled();
      act(() => {
        jest.advanceTimersByTime(12_000);
      });
      expect(mockReplace).toHaveBeenCalledWith("/(auth)/sign-in");
    } finally {
      jest.useRealTimers();
    }
  });
});
