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
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { Adapters } from "@/shared/types";
import { SignInPresenter } from "@/ui/presenters/SignInPresenter";
import { SignInContainer } from "../SignInContainer";

// Mock the presenter so container tests only test logic, not UI rendering
jest.mock("@/ui/presenters/SignInPresenter");
const MockSignInPresenter = jest.mocked(SignInPresenter);

// Mock expo-router
jest.mock("expo-router", () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
}));
// eslint-disable-next-line import/first
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

// Stub presenter that exposes props via testIDs for interaction
MockSignInPresenter.mockImplementation((props) => (
  <View testID="sign-in-screen">
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
    <Pressable testID="sign-in" onPress={props.onSubmit} />
    <Pressable testID="google-oauth" onPress={() => props.onOAuth("google")} />
    <Pressable testID="apple-oauth" onPress={() => props.onOAuth("apple")} />
    <Pressable testID="forgot-password-link" onPress={props.onForgotPassword} />
    <Pressable testID="sign-up-link" onPress={props.onSignUp} />
    {props.error && <Text testID="error-message">{props.error}</Text>}
  </View>
));

describe("SignInContainer", () => {
  const mockPush = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockPush.mockClear();
    mockUseRouter.mockReturnValue({
      push: mockPush,
    } as unknown as ReturnType<typeof useRouter>);
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

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SignInContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("email-input")).toBeTruthy();
    });

    fireEvent.changeText(getByTestId("email-input"), "test@example.com");
    fireEvent.changeText(getByTestId("password-input"), "password");

    auth.shouldFail = true;

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
    auth.signInWithEmail = async () => {
      throw "unexpected";
    };

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SignInContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("email-input")).toBeTruthy();
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

  it("routes Apple through the native flow on iOS, not web OAuth", async () => {
    const { adapters, auth } = createTestAdapters();
    const appleSpy = jest.spyOn(auth, "signInWithApple");
    const oauthSpy = jest.spyOn(auth, "signInWithOAuth");

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SignInContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("apple-oauth")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByTestId("apple-oauth"));
    });

    // Platform.OS defaults to "ios" under the RN test preset.
    expect(appleSpy).toHaveBeenCalledTimes(1);
    expect(oauthSpy).not.toHaveBeenCalled();
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
