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
import type { Workout } from "@/domain/models/workout";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useAssignWorkoutSheet } from "@/state/assign-workout-sheet";
import {
  AssignWorkoutSheet,
  assignWorkoutErrorCopy,
} from "@/ui/presenters/coach/AssignWorkoutSheet";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

const WORKOUT = {
  id: "w-1",
  name: "Push Day",
  createdBy: "test-user",
} as unknown as Workout;

function makeAdapters(): { adapters: Adapters; api: InMemoryApiAdapter } {
  const api = new InMemoryApiAdapter();
  api.workouts = [WORKOUT];
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
  useAssignWorkoutSheet.setState({
    open: false,
    clientId: null,
    onAssigned: null,
  });
});

describe("assignWorkoutErrorCopy", () => {
  it("maps known codes to friendly copy", () => {
    expect(assignWorkoutErrorCopy("invalid_workout")).toMatch(/your own/i);
    expect(assignWorkoutErrorCopy("not_your_client")).toMatch(
      /active clients/i,
    );
    expect(assignWorkoutErrorCopy(undefined)).toMatch(/couldn't assign/i);
  });
});

describe("AssignWorkoutSheet", () => {
  it("is hidden when the store is closed", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <AssignWorkoutSheet />
      </Wrapper>,
    );
    expect(screen.queryByTestId("assign-workout-sheet")).toBeNull();
  });

  it("lists the coach's workouts, assigns the selected one, closes + calls onAssigned", async () => {
    const { adapters, api } = makeAdapters();
    const onAssigned = jest.fn();
    render(
      <Wrapper adapters={adapters}>
        <AssignWorkoutSheet />
      </Wrapper>,
    );
    act(() => {
      useAssignWorkoutSheet.getState().openSheet("client-9", onAssigned);
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-workout-w-1")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("assign-workout-w-1"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-workout-submit"));
    });
    await waitFor(() => expect(onAssigned).toHaveBeenCalledTimes(1));
    expect(api.assignWorkoutCalls[0]).toMatchObject({
      clientId: "client-9",
      input: { workoutId: "w-1", dueDate: null },
    });
    expect(useAssignWorkoutSheet.getState().open).toBe(false);
  });

  it("disables Assign until a workout is selected", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <AssignWorkoutSheet />
      </Wrapper>,
    );
    act(() => {
      useAssignWorkoutSheet.getState().openSheet("client-9");
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-workout-submit")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("assign-workout-submit").props.accessibilityState,
    ).toMatchObject({ disabled: true });
  });

  it("maps a domain failure to inline copy without closing", async () => {
    const { adapters, api } = makeAdapters();
    api.nextProgramError = { code: "invalid_workout", message: "boom" };
    render(
      <Wrapper adapters={adapters}>
        <AssignWorkoutSheet />
      </Wrapper>,
    );
    act(() => {
      useAssignWorkoutSheet.getState().openSheet("client-9");
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-workout-w-1")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("assign-workout-w-1"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-workout-submit"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("assign-workout-error")).toBeTruthy(),
    );
    expect(useAssignWorkoutSheet.getState().open).toBe(true);
  });
});
