import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TamaguiProvider } from "@tamagui/core";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { ReactNode } from "react";
import config from "../../../../../tamagui.config";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useSendBriefSheet } from "@/state/send-brief-sheet";
import { SendBriefSheet } from "@/ui/presenters/coach/SendBriefSheet";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

function makeAdapters(): { adapters: Adapters; api: InMemoryApiAdapter } {
  const api = new InMemoryApiAdapter();
  const auth = new InMemoryAuthAdapter();
  auth.currentSession = {
    accessToken: "tok",
    refreshToken: "rtok",
    userId: "u-1",
    email: "x@y.com",
    expiresAt: Date.now() + 3_600_000,
  };
  const adapters: Adapters = {
    api,
    auth,
    storage: new InMemoryStorageAdapter(),
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new MockPaymentsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
  };
  return { adapters, api };
}

function Wrapper({
  adapters,
  children,
}: {
  adapters: Adapters;
  children: ReactNode;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 44, left: 0, right: 0, bottom: 34 },
      }}
    >
      <TamaguiProvider config={config} defaultTheme="dark">
        <QueryClientProvider client={queryClient}>
          <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
        </QueryClientProvider>
      </TamaguiProvider>
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  useSendBriefSheet.setState({
    open: false,
    clientId: null,
    clientName: null,
  });
});

describe("SendBriefSheet", () => {
  it("is hidden when the store is closed", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <SendBriefSheet />
      </Wrapper>,
    );
    expect(screen.queryByTestId("send-brief-sheet")).toBeNull();
  });

  it("POSTs the trimmed brief and closes on success", async () => {
    const { adapters, api } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <SendBriefSheet />
      </Wrapper>,
    );
    act(() => {
      useSendBriefSheet.getState().openSheet("client-9", "Marcus");
    });
    await waitFor(() =>
      expect(screen.getByTestId("send-brief-message")).toBeTruthy(),
    );
    // The client's name frames the composer.
    expect(screen.getByText("Brief for Marcus")).toBeTruthy();
    fireEvent.changeText(
      screen.getByTestId("send-brief-message"),
      "  New block starts Monday — check your Training page  ",
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("send-brief-submit"));
    });
    await waitFor(() => expect(useSendBriefSheet.getState().open).toBe(false));
    expect(api.sendClientBriefCalls[0]).toEqual({
      clientId: "client-9",
      input: { message: "New block starts Monday — check your Training page" }, // trimmed
    });
  });

  it("disables send until the message is non-empty (whitespace stays disabled)", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <SendBriefSheet />
      </Wrapper>,
    );
    act(() => {
      useSendBriefSheet.getState().openSheet("client-9");
    });
    await waitFor(() =>
      expect(screen.getByTestId("send-brief-submit")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("send-brief-submit").props.accessibilityState,
    ).toMatchObject({ disabled: true });
    fireEvent.changeText(screen.getByTestId("send-brief-message"), "   ");
    expect(
      screen.getByTestId("send-brief-submit").props.accessibilityState,
    ).toMatchObject({ disabled: true });
    fireEvent.changeText(screen.getByTestId("send-brief-message"), "hi");
    expect(
      screen.getByTestId("send-brief-submit").props.accessibilityState,
    ).toMatchObject({ disabled: false });
  });

  it("shows a live character count", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <SendBriefSheet />
      </Wrapper>,
    );
    act(() => {
      useSendBriefSheet.getState().openSheet("client-9");
    });
    await waitFor(() =>
      expect(screen.getByTestId("send-brief-count")).toBeTruthy(),
    );
    expect(screen.getByTestId("send-brief-count").props.children).toBe("0/500");
    fireEvent.changeText(screen.getByTestId("send-brief-message"), "hello");
    expect(screen.getByTestId("send-brief-count").props.children).toBe("5/500");
  });

  it("surfaces an error on a failed send + keeps the sheet open", async () => {
    const { adapters, api } = makeAdapters();
    api.shouldFail = true;
    api.failError = { kind: "api", code: "server", message: "boom" };
    render(
      <Wrapper adapters={adapters}>
        <SendBriefSheet />
      </Wrapper>,
    );
    act(() => {
      useSendBriefSheet.getState().openSheet("client-9");
    });
    await waitFor(() =>
      expect(screen.getByTestId("send-brief-message")).toBeTruthy(),
    );
    fireEvent.changeText(screen.getByTestId("send-brief-message"), "brief");
    await act(async () => {
      fireEvent.press(screen.getByTestId("send-brief-submit"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("send-brief-error")).toBeTruthy(),
    );
    expect(useSendBriefSheet.getState().open).toBe(true);
  });

  it("resets stale state when reopened", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <SendBriefSheet />
      </Wrapper>,
    );
    act(() => {
      useSendBriefSheet.getState().openSheet("client-9");
    });
    await waitFor(() =>
      expect(screen.getByTestId("send-brief-message")).toBeTruthy(),
    );
    fireEvent.changeText(screen.getByTestId("send-brief-message"), "draft");
    act(() => {
      useSendBriefSheet.getState().closeSheet();
    });
    act(() => {
      useSendBriefSheet.getState().openSheet("client-10");
    });
    await waitFor(() =>
      expect(screen.getByTestId("send-brief-message").props.value).toBe(""),
    );
  });
});
