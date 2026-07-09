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
import { useCoachNoteSheet } from "@/state/coach-note-sheet";
import { CoachNoteSheet } from "@/ui/presenters/coach/CoachNoteSheet";

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
  useCoachNoteSheet.setState({
    open: false,
    clientId: null,
    editNote: null,
    onSaved: null,
  });
});

describe("CoachNoteSheet — create mode", () => {
  it("is hidden when the store is closed", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <CoachNoteSheet />
      </Wrapper>,
    );
    expect(screen.queryByTestId("coach-note-sheet")).toBeNull();
  });

  it("POSTs a new note, closes, calls onSaved — no delete button in create", async () => {
    const { adapters, api } = makeAdapters();
    const onSaved = jest.fn();
    render(
      <Wrapper adapters={adapters}>
        <CoachNoteSheet />
      </Wrapper>,
    );
    act(() => {
      useCoachNoteSheet.getState().openForCreate("client-9", onSaved);
    });
    await waitFor(() =>
      expect(screen.getByTestId("coach-note-content")).toBeTruthy(),
    );
    expect(screen.queryByTestId("coach-note-delete")).toBeNull();
    fireEvent.changeText(
      screen.getByTestId("coach-note-content"),
      "  Knee felt off Tuesday  ",
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("coach-note-submit"));
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(api.createClientNoteCalls[0]).toEqual({
      clientId: "client-9",
      input: { content: "Knee felt off Tuesday" }, // trimmed
    });
    expect(useCoachNoteSheet.getState().open).toBe(false);
  });

  it("disables submit until content is non-empty", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <CoachNoteSheet />
      </Wrapper>,
    );
    act(() => {
      useCoachNoteSheet.getState().openForCreate("client-9");
    });
    await waitFor(() =>
      expect(screen.getByTestId("coach-note-submit")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("coach-note-submit").props.accessibilityState,
    ).toMatchObject({ disabled: true });
    fireEvent.changeText(screen.getByTestId("coach-note-content"), "   ");
    expect(
      screen.getByTestId("coach-note-submit").props.accessibilityState,
    ).toMatchObject({ disabled: true }); // whitespace-only stays disabled
  });

  it("surfaces an error on a failed create + keeps the sheet open", async () => {
    const { adapters, api } = makeAdapters();
    api.shouldFail = true;
    api.failError = { kind: "api", code: "server", message: "boom" };
    render(
      <Wrapper adapters={adapters}>
        <CoachNoteSheet />
      </Wrapper>,
    );
    act(() => {
      useCoachNoteSheet.getState().openForCreate("client-9");
    });
    await waitFor(() =>
      expect(screen.getByTestId("coach-note-content")).toBeTruthy(),
    );
    fireEvent.changeText(screen.getByTestId("coach-note-content"), "note");
    await act(async () => {
      fireEvent.press(screen.getByTestId("coach-note-submit"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("coach-note-error")).toBeTruthy(),
    );
    expect(useCoachNoteSheet.getState().open).toBe(true);
  });
});

describe("CoachNoteSheet — edit mode", () => {
  it("prefills content, PUTs the edit, closes, calls onSaved", async () => {
    const { adapters, api } = makeAdapters();
    const onSaved = jest.fn();
    render(
      <Wrapper adapters={adapters}>
        <CoachNoteSheet />
      </Wrapper>,
    );
    act(() => {
      useCoachNoteSheet
        .getState()
        .openForEdit(
          "client-9",
          { noteId: "note-1", content: "Original" },
          onSaved,
        );
    });
    await waitFor(() =>
      expect(screen.getByTestId("coach-note-content").props.value).toBe(
        "Original",
      ),
    );
    fireEvent.changeText(screen.getByTestId("coach-note-content"), "Updated");
    await act(async () => {
      fireEvent.press(screen.getByTestId("coach-note-submit"));
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(api.updateClientNoteCalls[0]).toEqual({
      clientId: "client-9",
      noteId: "note-1",
      input: { content: "Updated" },
    });
  });

  it("deletes the note, closes, calls onSaved", async () => {
    const { adapters, api } = makeAdapters();
    const onSaved = jest.fn();
    render(
      <Wrapper adapters={adapters}>
        <CoachNoteSheet />
      </Wrapper>,
    );
    act(() => {
      useCoachNoteSheet
        .getState()
        .openForEdit("client-9", { noteId: "note-1", content: "x" }, onSaved);
    });
    await waitFor(() =>
      expect(screen.getByTestId("coach-note-delete")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("coach-note-delete"));
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(api.deleteClientNoteCalls[0]).toEqual({
      clientId: "client-9",
      noteId: "note-1",
    });
    expect(useCoachNoteSheet.getState().open).toBe(false);
  });
});
