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
import { usePasswordRecovery } from "@/state/password-recovery";
import { SetNewPasswordPresenter } from "@/ui/presenters/SetNewPasswordPresenter";
import { SetNewPasswordContainer } from "../SetNewPasswordContainer";

jest.mock("@/ui/presenters/SetNewPasswordPresenter");
const MockPresenter = jest.mocked(SetNewPasswordPresenter);

jest.mock("expo-router", () => ({
  useRouter: jest.fn(() => ({ replace: jest.fn() })),
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

MockPresenter.mockImplementation((props) => (
  <View testID="set-new-password-screen">
    <TextInput
      testID="password-input"
      value={props.password}
      onChangeText={props.onPasswordChange}
    />
    <TextInput
      testID="confirm-input"
      value={props.confirmPassword}
      onChangeText={props.onConfirmPasswordChange}
    />
    <Pressable testID="submit" onPress={props.onSubmit} />
    {props.error && <Text testID="error-message">{props.error}</Text>}
    {props.isSuccess && <Text testID="success" />}
  </View>
));

const mockReplace = jest.fn();

async function fillAndSubmit(
  getByTestId: (id: string) => unknown,
  password: string,
  confirm: string,
) {
  fireEvent.changeText(getByTestId("password-input") as never, password);
  fireEvent.changeText(getByTestId("confirm-input") as never, confirm);
  await act(async () => {
    fireEvent.press(getByTestId("submit") as never);
  });
}

describe("SetNewPasswordContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReplace.mockClear();
    usePasswordRecovery.setState({ pending: true });
    mockUseRouter.mockReturnValue({
      replace: mockReplace,
    } as unknown as ReturnType<typeof useRouter>);
  });

  it("updates the password, clears the recovery flag, and enters the app", async () => {
    const { adapters } = createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SetNewPasswordContainer />
      </TestWrapper>,
    );

    await fillAndSubmit(getByTestId, "newpass123", "newpass123");

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/(app)/(tabs)");
    });
    expect(usePasswordRecovery.getState().pending).toBe(false);
  });

  it("errors when the fields are empty", async () => {
    const { adapters } = createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SetNewPasswordContainer />
      </TestWrapper>,
    );

    await fillAndSubmit(getByTestId, "", "");

    await waitFor(() => {
      expect(getByTestId("error-message")).toBeTruthy();
    });
    expect(mockReplace).not.toHaveBeenCalled();
    // Flag untouched — the user is still mid-recovery.
    expect(usePasswordRecovery.getState().pending).toBe(true);
  });

  it("errors when the passwords do not match", async () => {
    const { adapters } = createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SetNewPasswordContainer />
      </TestWrapper>,
    );

    await fillAndSubmit(getByTestId, "newpass123", "different");

    await waitFor(() => {
      expect(getByTestId("error-message")).toBeTruthy();
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("errors when the password is shorter than 6 characters", async () => {
    const { adapters } = createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SetNewPasswordContainer />
      </TestWrapper>,
    );

    await fillAndSubmit(getByTestId, "abc", "abc");

    await waitFor(() => {
      expect(getByTestId("error-message")).toBeTruthy();
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("surfaces an error and stays put when updatePassword fails", async () => {
    const { adapters, auth } = createTestAdapters();
    auth.shouldFail = true;
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <SetNewPasswordContainer />
      </TestWrapper>,
    );

    await fillAndSubmit(getByTestId, "newpass123", "newpass123");

    await waitFor(() => {
      expect(getByTestId("error-message")).toBeTruthy();
    });
    expect(mockReplace).not.toHaveBeenCalled();
    // Flag retained so AuthGate keeps the user on this screen to retry.
    expect(usePasswordRecovery.getState().pending).toBe(true);
  });
});
