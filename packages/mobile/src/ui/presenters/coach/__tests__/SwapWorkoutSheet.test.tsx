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
import { useSwapWorkoutSheet } from "@/state/swap-workout-sheet";
import {
  SwapWorkoutSheet,
  swapWorkoutErrorCopy,
} from "@/ui/presenters/coach/SwapWorkoutSheet";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

function makeAdapters(): { adapters: Adapters; api: InMemoryApiAdapter } {
  const api = new InMemoryApiAdapter();
  // Two of the coach's own workouts to pick from.
  api.getWorkouts = async () =>
    ({
      ok: true,
      value: {
        workouts: [
          { id: "w-a", name: "Push A" },
          { id: "w-b", name: "Pull B" },
        ],
        total: 2,
        quota: null,
      },
    }) as any;
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
  useSwapWorkoutSheet.setState({
    open: false,
    clientId: null,
    assignmentId: null,
    currentName: null,
    onSwapped: null,
  });
});

describe("swapWorkoutErrorCopy", () => {
  it.each([
    ["invalid_workout"],
    ["same_workout"],
    ["not_swappable"],
    ["not_found"],
    ["not_your_client"],
    [undefined],
  ] as const)("returns non-empty copy for %s", (code) => {
    expect(swapWorkoutErrorCopy(code).length).toBeGreaterThan(0);
  });
});

describe("SwapWorkoutSheet", () => {
  it("is hidden when the store is closed", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <SwapWorkoutSheet />
      </Wrapper>,
    );
    expect(screen.queryByTestId("swap-workout-sheet")).toBeNull();
  });

  it("picks a replacement, PATCHes, closes, and calls onSwapped", async () => {
    const { adapters, api } = makeAdapters();
    const onSwapped = jest.fn();
    render(
      <Wrapper adapters={adapters}>
        <SwapWorkoutSheet />
      </Wrapper>,
    );
    act(() => {
      useSwapWorkoutSheet
        .getState()
        .openSheet("client-9", "wa-7", "Old Push", onSwapped);
    });
    await waitFor(() =>
      expect(screen.getByTestId("swap-workout-w-a")).toBeTruthy(),
    );
    // Submit disabled until a workout is picked.
    expect(
      screen.getByTestId("swap-workout-submit").props.accessibilityState,
    ).toMatchObject({ disabled: true });

    fireEvent.press(screen.getByTestId("swap-workout-w-b"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("swap-workout-submit"));
    });

    await waitFor(() => expect(onSwapped).toHaveBeenCalledTimes(1));
    expect(api.swapClientWorkoutAssignmentCalls[0]).toEqual({
      clientId: "client-9",
      assignmentId: "wa-7",
      input: { workoutId: "w-b" },
    });
    expect(useSwapWorkoutSheet.getState().open).toBe(false);
  });

  it("surfaces a domain error and keeps the sheet open", async () => {
    const { adapters, api } = makeAdapters();
    api.nextProgramError = { code: "not_swappable", message: "x" };
    render(
      <Wrapper adapters={adapters}>
        <SwapWorkoutSheet />
      </Wrapper>,
    );
    act(() => {
      useSwapWorkoutSheet.getState().openSheet("client-9", "wa-7", "Old Push");
    });
    await waitFor(() =>
      expect(screen.getByTestId("swap-workout-w-a")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("swap-workout-w-a"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("swap-workout-submit"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("swap-workout-error")).toBeTruthy(),
    );
    expect(useSwapWorkoutSheet.getState().open).toBe(true);
  });
});
