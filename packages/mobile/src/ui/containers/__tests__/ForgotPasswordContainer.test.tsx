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
import { ForgotPasswordContainer } from "../ForgotPasswordContainer";

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

describe("ForgotPasswordContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders forgot-password screen", async () => {
    const { adapters } = createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ForgotPasswordContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("forgot-password-screen")).toBeTruthy();
    });
  });

  it("shows validation error when email is empty", async () => {
    const { adapters } = createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ForgotPasswordContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("submit")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByTestId("submit"));
    });

    await waitFor(() => {
      expect(getByTestId("error-message")).toBeTruthy();
    });
  });

  it("shows success state after successful reset", async () => {
    const { adapters } = createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ForgotPasswordContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("email")).toBeTruthy();
    });

    fireEvent.changeText(getByTestId("email-input"), "test@example.com");

    await act(async () => {
      fireEvent.press(getByTestId("submit"));
    });

    await waitFor(() => {
      expect(getByTestId("success-message")).toBeTruthy();
    });
  });

  it("shows error when reset fails", async () => {
    const { adapters, auth } = createTestAdapters();
    auth.shouldFail = true;

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ForgotPasswordContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("email")).toBeTruthy();
    });

    fireEvent.changeText(getByTestId("email-input"), "test@example.com");

    await act(async () => {
      fireEvent.press(getByTestId("submit"));
    });

    await waitFor(() => {
      expect(getByTestId("error-message")).toBeTruthy();
    });
  });

  it("shows fallback error when reset throws non-Error", async () => {
    const { adapters, auth } = createTestAdapters();
    auth.resetPassword = async () => {
      throw "unexpected";
    };

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ForgotPasswordContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("email")).toBeTruthy();
    });

    fireEvent.changeText(getByTestId("email-input"), "test@example.com");

    await act(async () => {
      fireEvent.press(getByTestId("submit"));
    });

    await waitFor(() => {
      expect(getByTestId("error-message")).toBeTruthy();
    });
  });

  it("navigates to sign-in on back link press", async () => {
    const { adapters } = createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ForgotPasswordContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("back-to-sign-in-link")).toBeTruthy();
    });

    fireEvent.press(getByTestId("back-to-sign-in-link"));
    expect(mockPush).toHaveBeenCalledWith("/(auth)/sign-in");
  });
});
