import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { TamaguiProvider } from "@tamagui/core";
import type { ReactNode } from "react";
import { Alert, Linking, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { Adapters } from "@/shared/types";
import { ContactSupportPresenter } from "@/ui/presenters/ContactSupportPresenter";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import config from "../../../../tamagui.config";
import {
  ContactSupportContainer,
  SUPPORT_EMAIL,
} from "../ContactSupportContainer";

jest.setTimeout(15_000);

jest.mock("@/ui/presenters/ContactSupportPresenter");
const MockPresenter = jest.mocked(ContactSupportPresenter);

MockPresenter.mockImplementation((props) => (
  <View testID="contact-support-presenter-stub">
    <Text testID="stub-email">{props.email}</Text>
    <Text testID="stub-subject">{props.subject}</Text>
    <Text testID="stub-message">{props.message}</Text>
    <TextInput
      testID="stub-subject-input"
      value={props.subject}
      onChangeText={(t) => props.onSubjectChange(t)}
    />
    <TextInput
      testID="stub-message-input"
      value={props.message}
      onChangeText={(t) => props.onMessageChange(t)}
    />
    <Pressable testID="stub-send" onPress={() => props.onSend()} />
    <Pressable
      testID="stub-direct-email"
      onPress={() => props.onOpenDirectEmail()}
    />
    <Pressable testID="stub-back" onPress={() => props.onBack()} />
  </View>
));

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
}));

async function createTestAdapters(): Promise<{
  adapters: Adapters;
  auth: InMemoryAuthAdapter;
}> {
  const auth = new InMemoryAuthAdapter();
  await auth.signInWithEmail("brad@example.com", "password");
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
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 44, left: 0, right: 0, bottom: 34 },
      }}
    >
      <TamaguiProvider config={config} defaultTheme="dark">
        <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
      </TamaguiProvider>
    </SafeAreaProvider>
  );
}

describe("ContactSupportContainer", () => {
  let alertSpy: jest.SpyInstance;
  let openURLSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBack.mockReset();
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    openURLSpy = jest
      .spyOn(Linking, "openURL")
      .mockResolvedValue(true as unknown as void);
  });

  afterEach(() => {
    alertSpy.mockRestore();
    openURLSpy.mockRestore();
  });

  it("seeds the readonly email from the auth session", async () => {
    const { adapters } = await createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ContactSupportContainer />
      </TestWrapper>,
    );
    await waitFor(() => {
      expect(getByTestId("stub-email").props.children).toBe("brad@example.com");
    });
  });

  it("warns + does not openURL when subject is empty", async () => {
    const { adapters } = await createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ContactSupportContainer />
      </TestWrapper>,
    );
    await waitFor(() => {
      expect(getByTestId("stub-email").props.children).toBe("brad@example.com");
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("stub-message-input"), "Help me");
    });
    await act(async () => {
      fireEvent.press(getByTestId("stub-send"));
    });
    expect(alertSpy).toHaveBeenCalledWith("Error", "Please fill in all fields");
    expect(openURLSpy).not.toHaveBeenCalled();
  });

  it("warns + does not openURL when message is empty", async () => {
    const { adapters } = await createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ContactSupportContainer />
      </TestWrapper>,
    );
    await waitFor(() => {
      expect(getByTestId("stub-email").props.children).toBe("brad@example.com");
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("stub-subject-input"), "Hi");
    });
    await act(async () => {
      fireEvent.press(getByTestId("stub-send"));
    });
    expect(alertSpy).toHaveBeenCalledWith("Error", "Please fill in all fields");
    expect(openURLSpy).not.toHaveBeenCalled();
  });

  it("opens mailto with encoded subject + body when both fields are filled", async () => {
    const { adapters } = await createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ContactSupportContainer />
      </TestWrapper>,
    );
    await waitFor(() => {
      expect(getByTestId("stub-email").props.children).toBe("brad@example.com");
    });
    await act(async () => {
      fireEvent.changeText(
        getByTestId("stub-subject-input"),
        "App crash on iPad",
      );
    });
    await act(async () => {
      fireEvent.changeText(
        getByTestId("stub-message-input"),
        "It crashes on launch",
      );
    });
    await act(async () => {
      fireEvent.press(getByTestId("stub-send"));
    });
    expect(openURLSpy).toHaveBeenCalledTimes(1);
    const url = openURLSpy.mock.calls[0][0] as string;
    expect(url).toContain(`mailto:${SUPPORT_EMAIL}`);
    expect(url).toContain(`subject=${encodeURIComponent("App crash on iPad")}`);
    const expectedBody = encodeURIComponent(
      "From: brad@example.com\n\nIt crashes on launch",
    );
    expect(url).toContain(`body=${expectedBody}`);
  });

  it("falls back to an Alert when openURL rejects", async () => {
    const { adapters } = await createTestAdapters();
    openURLSpy.mockRejectedValueOnce(new Error("no email client"));
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ContactSupportContainer />
      </TestWrapper>,
    );
    await waitFor(() => {
      expect(getByTestId("stub-email").props.children).toBe("brad@example.com");
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("stub-subject-input"), "Hi");
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("stub-message-input"), "Body");
    });
    await act(async () => {
      fireEvent.press(getByTestId("stub-send"));
    });
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "Error",
        `Could not open email client. Please send an email to ${SUPPORT_EMAIL}`,
      );
    });
  });

  it("opens a bare mailto when the direct-email link fires", async () => {
    const { adapters } = await createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ContactSupportContainer />
      </TestWrapper>,
    );
    await waitFor(() => {
      expect(getByTestId("stub-email").props.children).toBe("brad@example.com");
    });
    await act(async () => {
      fireEvent.press(getByTestId("stub-direct-email"));
    });
    expect(openURLSpy).toHaveBeenCalledWith(`mailto:${SUPPORT_EMAIL}`);
  });

  it("routes back when onBack fires", async () => {
    const { adapters } = await createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ContactSupportContainer />
      </TestWrapper>,
    );
    await waitFor(() => {
      expect(getByTestId("stub-email").props.children).toBe("brad@example.com");
    });
    await act(async () => {
      fireEvent.press(getByTestId("stub-back"));
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
