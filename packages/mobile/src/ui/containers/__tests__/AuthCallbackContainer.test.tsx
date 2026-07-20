import { render, waitFor } from "@testing-library/react-native";
import { TamaguiProvider } from "@tamagui/core";
import type { ReactNode } from "react";
import config from "../../../../tamagui.config";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { Adapters } from "@/shared/types";
import { usePasswordRecovery } from "@/state/password-recovery";
import { AuthCallbackContainer } from "../AuthCallbackContainer";

// The launch URL comes from expo-linking's useURL hook — control it per test.
let mockUrl: string | null = null;
jest.mock("expo-linking", () => ({
  useURL: () => mockUrl,
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
    payments: new MockPaymentsAdapter(),
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
    mockReplace.mockClear();
    usePasswordRecovery.setState({ pending: false });
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
});
