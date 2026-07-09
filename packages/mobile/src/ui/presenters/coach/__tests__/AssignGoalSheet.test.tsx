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
import { useAssignGoalSheet } from "@/state/assign-goal-sheet";
import {
  AssignGoalSheet,
  assignGoalErrorCopy,
} from "@/ui/presenters/coach/AssignGoalSheet";

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
  useAssignGoalSheet.setState({
    open: false,
    clientId: null,
    editGoal: null,
    onSaved: null,
  });
});

describe("assignGoalErrorCopy", () => {
  it("maps known codes to friendly copy", () => {
    expect(assignGoalErrorCopy("not_assigner")).toMatch(/you assigned/i);
    expect(assignGoalErrorCopy("goal_not_found")).toMatch(/no longer exists/i);
    expect(assignGoalErrorCopy("no_fields")).toMatch(/at least one/i);
    expect(assignGoalErrorCopy(undefined)).toMatch(/couldn't save/i);
  });
});

describe("AssignGoalSheet — create mode", () => {
  it("is hidden when the store is closed", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <AssignGoalSheet />
      </Wrapper>,
    );
    expect(screen.queryByTestId("assign-goal-sheet")).toBeNull();
  });

  it("loads the goal-type catalog on open and POSTs the SELECTED type", async () => {
    const { adapters, api } = makeAdapters();
    const onSaved = jest.fn();
    render(
      <Wrapper adapters={adapters}>
        <AssignGoalSheet />
      </Wrapper>,
    );
    act(() => {
      useAssignGoalSheet.getState().openForCreate("client-9", onSaved);
    });
    // The catalog loads and renders as a picker (no raw UUID field).
    await waitFor(() =>
      expect(screen.getByTestId("assign-goal-types-list")).toBeTruthy(),
    );
    expect(api.getGoalTypesCalls).toBe(1);
    expect(screen.queryByTestId("assign-goal-type")).toBeNull();
    // Pick a type from the list.
    fireEvent.press(screen.getByTestId("assign-goal-type-gt-lose-weight"));
    fireEvent.changeText(
      screen.getByTestId("assign-goal-target-date"),
      "2026-09-01",
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-goal-submit"));
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(api.assignClientGoalCalls[0]).toEqual({
      clientId: "client-9",
      input: { goalTypeId: "gt-lose-weight", targetDate: "2026-09-01" },
    });
    expect(useAssignGoalSheet.getState().open).toBe(false);
  });

  it("surfaces a generic error on a failed create + keeps the sheet open", async () => {
    const { adapters, api } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <AssignGoalSheet />
      </Wrapper>,
    );
    act(() => {
      useAssignGoalSheet.getState().openForCreate("client-9");
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-goal-types-list")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("assign-goal-type-gt-strength"));
    // The catalog loaded fine; now make the WRITE fail.
    api.shouldFail = true;
    api.failError = { kind: "api", code: "server", message: "boom" };
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-goal-submit"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-goal-error")).toBeTruthy(),
    );
    expect(useAssignGoalSheet.getState().open).toBe(true);
  });

  it("shows a retry when the goal-type catalog fails to load, then recovers", async () => {
    const { adapters, api } = makeAdapters();
    api.shouldFail = true;
    api.failError = { kind: "api", code: "server", message: "boom" };
    render(
      <Wrapper adapters={adapters}>
        <AssignGoalSheet />
      </Wrapper>,
    );
    act(() => {
      useAssignGoalSheet.getState().openForCreate("client-9");
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-goal-types-error")).toBeTruthy(),
    );
    // Can't submit without a selection.
    expect(
      screen.getByTestId("assign-goal-submit").props.accessibilityState,
    ).toMatchObject({ disabled: true });
    // Recover + retry.
    api.shouldFail = false;
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-goal-types-retry"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-goal-types-list")).toBeTruthy(),
    );
  });

  it("disables submit until a goal type is selected", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <AssignGoalSheet />
      </Wrapper>,
    );
    act(() => {
      useAssignGoalSheet.getState().openForCreate("client-9");
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-goal-types-list")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("assign-goal-submit").props.accessibilityState,
    ).toMatchObject({ disabled: true });
    fireEvent.press(screen.getByTestId("assign-goal-type-gt-strength"));
    await waitFor(() =>
      expect(
        screen.getByTestId("assign-goal-submit").props.accessibilityState,
      ).toMatchObject({ disabled: false }),
    );
  });

  it("disables submit on an invalid target date (never fires the write)", async () => {
    const { adapters, api } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <AssignGoalSheet />
      </Wrapper>,
    );
    act(() => {
      useAssignGoalSheet.getState().openForCreate("client-9");
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-goal-types-list")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("assign-goal-type-gt-strength"));
    fireEvent.changeText(
      screen.getByTestId("assign-goal-target-date"),
      "not-a-date",
    );
    expect(
      screen.getByTestId("assign-goal-submit").props.accessibilityState,
    ).toMatchObject({ disabled: true });
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-goal-submit"));
    });
    expect(api.assignClientGoalCalls).toHaveLength(0);
  });
});

describe("AssignGoalSheet — edit mode", () => {
  it("PUTs the edited goal + shows the title, no goal-type field", async () => {
    const { adapters, api } = makeAdapters();
    const onSaved = jest.fn();
    render(
      <Wrapper adapters={adapters}>
        <AssignGoalSheet />
      </Wrapper>,
    );
    act(() => {
      useAssignGoalSheet
        .getState()
        .openForEdit(
          "client-9",
          { goalId: "goal-1", title: "Add 4kg lean mass", targetDate: null },
          onSaved,
        );
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-goal-title")).toBeTruthy(),
    );
    expect(screen.queryByTestId("assign-goal-type")).toBeNull();
    fireEvent.changeText(
      screen.getByTestId("assign-goal-target-date"),
      "2026-06-30",
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-goal-submit"));
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(api.updateClientGoalCalls[0]).toEqual({
      clientId: "client-9",
      goalId: "goal-1",
      input: { targetDate: "2026-06-30" },
    });
  });

  it("surfaces a 403 not_assigner gracefully + keeps the sheet open", async () => {
    const { adapters, api } = makeAdapters();
    api.nextGoalError = {
      code: "not_assigner",
      message: "You can only edit goals you assigned",
    };
    render(
      <Wrapper adapters={adapters}>
        <AssignGoalSheet />
      </Wrapper>,
    );
    act(() => {
      useAssignGoalSheet.getState().openForEdit("client-9", {
        goalId: "goal-1",
        title: "Squat 1.5x BW",
        targetDate: "2026-08-01",
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-goal-submit")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-goal-submit"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-goal-error")).toBeTruthy(),
    );
    expect(screen.getByTestId("assign-goal-error").children.join("")).toMatch(
      /you assigned/i,
    );
    expect(useAssignGoalSheet.getState().open).toBe(true);
  });
});
