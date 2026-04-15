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
import { SignUpContainer } from "../SignUpContainer";

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

describe("SignUpContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders sign-up screen", async () => {
    const { adapters } = createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SignUpContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("sign-up-screen")).toBeTruthy();
    });
  });

  it("shows validation error when fields are empty", async () => {
    const { adapters } = createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SignUpContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("sign-up")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByTestId("sign-up"));
    });

    await waitFor(() => {
      expect(getByTestId("error-message")).toBeTruthy();
    });
  });

  it("shows error when passwords do not match", async () => {
    const { adapters } = createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SignUpContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("email")).toBeTruthy();
    });

    fireEvent.changeText(getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(getByTestId("password-input"), "password123");
    fireEvent.changeText(
      getByTestId("confirm-password-input"),
      "differentpass",
    );

    await act(async () => {
      fireEvent.press(getByTestId("sign-up"));
    });

    await waitFor(() => {
      expect(getByTestId("error-message")).toBeTruthy();
    });
  });

  it("shows error when password is too short", async () => {
    const { adapters } = createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SignUpContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("email")).toBeTruthy();
    });

    fireEvent.changeText(getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(getByTestId("password-input"), "12345");
    fireEvent.changeText(getByTestId("confirm-password-input"), "12345");

    await act(async () => {
      fireEvent.press(getByTestId("sign-up"));
    });

    await waitFor(() => {
      expect(getByTestId("error-message")).toBeTruthy();
    });
  });

  it("shows error when sign-up fails", async () => {
    const { adapters, auth } = createTestAdapters();
    auth.shouldFail = true;

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SignUpContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("email")).toBeTruthy();
    });

    fireEvent.changeText(getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(getByTestId("password-input"), "password123");
    fireEvent.changeText(getByTestId("confirm-password-input"), "password123");

    await act(async () => {
      fireEvent.press(getByTestId("sign-up"));
    });

    await waitFor(() => {
      expect(getByTestId("error-message")).toBeTruthy();
    });
  });

  it("shows fallback error when sign-up throws non-Error", async () => {
    const { adapters, auth } = createTestAdapters();
    auth.signUpWithEmail = async () => {
      throw "unexpected";
    };

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SignUpContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("email")).toBeTruthy();
    });

    fireEvent.changeText(getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(getByTestId("password-input"), "password123");
    fireEvent.changeText(getByTestId("confirm-password-input"), "password123");

    await act(async () => {
      fireEvent.press(getByTestId("sign-up"));
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
        <SignUpContainer />
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

  it("shows error when OAuth fails", async () => {
    const { adapters, auth } = createTestAdapters();
    auth.shouldFail = true;

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SignUpContainer />
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

  it("navigates to sign-in on link press", async () => {
    const { adapters } = createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SignUpContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("sign-in-link")).toBeTruthy();
    });

    fireEvent.press(getByTestId("sign-in-link"));
    expect(mockPush).toHaveBeenCalledWith("/(auth)/sign-in");
  });
});
