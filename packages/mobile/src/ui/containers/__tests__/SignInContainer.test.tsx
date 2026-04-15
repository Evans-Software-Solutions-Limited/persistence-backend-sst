import { render, fireEvent, waitFor, act } from "@testing-library/react-native";
import { TamaguiProvider } from "@tamagui/core";
import type { ReactNode } from "react";
import config from "../../../../tamagui.config";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { StubPaymentsAdapter } from "@/adapters/payments";
import type { Adapters } from "@/shared/types";
import { SignInContainer } from "../SignInContainer";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
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
    payments: new StubPaymentsAdapter(),
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

describe("SignInContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders sign-in screen", async () => {
    const { adapters } = createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SignInContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("sign-in-screen")).toBeTruthy();
    });
  });

  it("shows validation error when fields are empty", async () => {
    const { adapters } = createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SignInContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("sign-in")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByTestId("sign-in"));
    });

    await waitFor(() => {
      expect(getByTestId("error-message")).toBeTruthy();
    });
  });

  it("shows error when sign-in fails", async () => {
    const { adapters, auth } = createTestAdapters();
    auth.shouldFail = true;

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SignInContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("email")).toBeTruthy();
    });

    fireEvent.changeText(getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(getByTestId("password-input"), "password");

    await act(async () => {
      fireEvent.press(getByTestId("sign-in"));
    });

    await waitFor(() => {
      expect(getByTestId("error-message")).toBeTruthy();
    });
  });

  it("shows error when OAuth fails", async () => {
    const { adapters, auth } = createTestAdapters();
    auth.shouldFail = true;

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SignInContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("google-oauth")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByTestId("google-oauth"));
    });

    await waitFor(() => {
      expect(getByTestId("error-message")).toBeTruthy();
    });
  });

  it("shows fallback error when sign-in throws non-Error", async () => {
    const { adapters, auth } = createTestAdapters();
    // Override signInWithEmail to throw a string (non-Error)
    auth.signInWithEmail = async () => {
      throw "unexpected";
    };

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SignInContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("email")).toBeTruthy();
    });

    fireEvent.changeText(getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(getByTestId("password-input"), "password");

    await act(async () => {
      fireEvent.press(getByTestId("sign-in"));
    });

    await waitFor(() => {
      expect(getByTestId("error-message")).toBeTruthy();
    });
  });

  it("shows fallback error when OAuth throws non-Error", async () => {
    const { adapters, auth } = createTestAdapters();
    auth.signInWithOAuth = async () => {
      throw "unexpected";
    };

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SignInContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("google-oauth")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByTestId("google-oauth"));
    });

    await waitFor(() => {
      expect(getByTestId("error-message")).toBeTruthy();
    });
  });

  it("navigates to forgot-password on link press", async () => {
    const { adapters } = createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SignInContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("forgot-password-link")).toBeTruthy();
    });

    fireEvent.press(getByTestId("forgot-password-link"));
    expect(mockPush).toHaveBeenCalledWith("/(auth)/forgot-password");
  });

  it("navigates to sign-up on link press", async () => {
    const { adapters } = createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SignInContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("sign-up-link")).toBeTruthy();
    });

    fireEvent.press(getByTestId("sign-up-link"));
    expect(mockPush).toHaveBeenCalledWith("/(auth)/sign-up");
  });
});
