import { render, fireEvent, waitFor, act } from "@testing-library/react-native";
import { TamaguiProvider } from "@tamagui/core";
import type { ReactNode } from "react";
import { View, Text, Pressable, TextInput } from "react-native";
import config from "../../../../tamagui.config";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { StubPaymentsAdapter } from "@/adapters/payments";
import type { Adapters } from "@/shared/types";
import { SignUpPresenter } from "@/ui/presenters/SignUpPresenter";
import { SignUpContainer } from "../SignUpContainer";

jest.mock("@/ui/presenters/SignUpPresenter");
const MockSignUpPresenter = jest.mocked(SignUpPresenter);

jest.mock("expo-router", () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
}));
import { useRouter } from "expo-router";
const mockUseRouter = jest.mocked(useRouter);

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

MockSignUpPresenter.mockImplementation((props) => (
  <View testID="sign-up-screen">
    <TextInput
      testID="email-input"
      value={props.email}
      onChangeText={props.onEmailChange}
    />
    <TextInput
      testID="password-input"
      value={props.password}
      onChangeText={props.onPasswordChange}
    />
    <TextInput
      testID="confirm-password-input"
      value={props.confirmPassword}
      onChangeText={props.onConfirmPasswordChange}
    />
    <Pressable testID="sign-up" onPress={props.onSubmit} />
    <Pressable testID="google-oauth" onPress={() => props.onOAuth("google")} />
    <Pressable testID="sign-in-link" onPress={props.onSignIn} />
    {props.error && <Text testID="error-message">{props.error}</Text>}
    {props.confirmationSent && <Text testID="confirmation-message" />}
  </View>
));

describe("SignUpContainer", () => {
  const mockPush = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockPush.mockClear();
    mockUseRouter.mockReturnValue({
      push: mockPush,
    } as unknown as ReturnType<typeof useRouter>);
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
      expect(getByTestId("email-input")).toBeTruthy();
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
      expect(getByTestId("email-input")).toBeTruthy();
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

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SignUpContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("email-input")).toBeTruthy();
    });

    fireEvent.changeText(getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(getByTestId("password-input"), "password123");
    fireEvent.changeText(getByTestId("confirm-password-input"), "password123");

    auth.shouldFail = true;

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
      expect(getByTestId("email-input")).toBeTruthy();
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

  it("shows confirmation message when email confirmation required", async () => {
    const { adapters, auth } = createTestAdapters();
    // Simulate Supabase requiring email confirmation
    auth.signUpWithEmail = async () => ({
      ok: false as const,
      error: {
        kind: "auth" as const,
        code: "email_confirmation_required" as const,
        message: "Check your email for confirmation",
      },
    });

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SignUpContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("email-input")).toBeTruthy();
    });

    fireEvent.changeText(getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(getByTestId("password-input"), "password123");
    fireEvent.changeText(getByTestId("confirm-password-input"), "password123");

    await act(async () => {
      fireEvent.press(getByTestId("sign-up"));
    });

    await waitFor(() => {
      expect(getByTestId("confirmation-message")).toBeTruthy();
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
