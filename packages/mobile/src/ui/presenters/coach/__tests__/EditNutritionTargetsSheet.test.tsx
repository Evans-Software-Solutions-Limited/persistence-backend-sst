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
import { useEditNutritionTargetsSheet } from "@/state/edit-nutrition-targets-sheet";
import {
  EditNutritionTargetsSheet,
  parseTargetField,
} from "@/ui/presenters/coach/EditNutritionTargetsSheet";

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
  useEditNutritionTargetsSheet.setState({
    open: false,
    clientId: null,
    initial: null,
    onSaved: null,
  });
});

describe("parseTargetField", () => {
  it("parses whole numbers, rejects blank/negative/decimals", () => {
    expect(parseTargetField("2400")).toBe(2400);
    expect(parseTargetField("0")).toBe(0);
    expect(parseTargetField("")).toBeNull();
    expect(parseTargetField("  ")).toBeNull();
    expect(parseTargetField("-5")).toBeNull();
    expect(parseTargetField("18.5")).toBeNull();
    expect(parseTargetField("abc")).toBeNull();
  });
});

describe("EditNutritionTargetsSheet", () => {
  it("is hidden when the store is closed", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <EditNutritionTargetsSheet />
      </Wrapper>,
    );
    expect(screen.queryByTestId("edit-nutrition-targets-sheet")).toBeNull();
  });

  it("seeds calories from the initial + writes on save, closing + calling onSaved", async () => {
    const { adapters, api } = makeAdapters();
    const onSaved = jest.fn();
    render(
      <Wrapper adapters={adapters}>
        <EditNutritionTargetsSheet />
      </Wrapper>,
    );
    act(() => {
      useEditNutritionTargetsSheet.getState().openSheet(
        "client-9",
        {
          dailyKcal: 2400,
          proteinG: null,
          carbsG: null,
          fatG: null,
          waterCups: null,
        },
        onSaved,
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId("edit-target-dailyKcal")).toBeTruthy(),
    );
    // Seeded calories.
    expect(screen.getByTestId("edit-target-dailyKcal").props.value).toBe(
      "2400",
    );
    // Fill the remaining required fields.
    fireEvent.changeText(screen.getByTestId("edit-target-proteinG"), "180");
    fireEvent.changeText(screen.getByTestId("edit-target-carbsG"), "250");
    fireEvent.changeText(screen.getByTestId("edit-target-fatG"), "70");
    fireEvent.changeText(screen.getByTestId("edit-target-waterCups"), "8");
    await act(async () => {
      fireEvent.press(screen.getByTestId("edit-nutrition-targets-submit"));
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(api.setClientNutritionTargetCalls[0]).toEqual({
      clientId: "client-9",
      input: {
        dailyKcal: 2400,
        proteinG: 180,
        carbsG: 250,
        fatG: 70,
        waterCups: 8,
      },
    });
    expect(useEditNutritionTargetsSheet.getState().open).toBe(false);
  });

  it("keeps Save disabled until every field is a valid whole number", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <EditNutritionTargetsSheet />
      </Wrapper>,
    );
    act(() => {
      useEditNutritionTargetsSheet.getState().openSheet("client-9", null);
    });
    await waitFor(() =>
      expect(screen.getByTestId("edit-nutrition-targets-submit")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("edit-nutrition-targets-submit").props
        .accessibilityState,
    ).toMatchObject({ disabled: true });
  });

  it("surfaces an error on a failed write + keeps the sheet open", async () => {
    const { adapters, api } = makeAdapters();
    api.shouldFail = true;
    api.failError = { kind: "api", code: "server", message: "boom" };
    render(
      <Wrapper adapters={adapters}>
        <EditNutritionTargetsSheet />
      </Wrapper>,
    );
    act(() => {
      useEditNutritionTargetsSheet.getState().openSheet("client-9", {
        dailyKcal: 2000,
        proteinG: 150,
        carbsG: 200,
        fatG: 60,
        waterCups: 6,
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("edit-nutrition-targets-submit")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("edit-nutrition-targets-submit"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("edit-nutrition-targets-error")).toBeTruthy(),
    );
    expect(useEditNutritionTargetsSheet.getState().open).toBe(true);
  });
});
