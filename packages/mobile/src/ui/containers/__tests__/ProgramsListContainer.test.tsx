import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TamaguiProvider } from "@tamagui/core";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { ReactNode } from "react";
import config from "../../../../tamagui.config";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { ProgramsListContainer } from "@/ui/containers/ProgramsListContainer";
import type { ProgramSummary } from "@/domain/models/program";

const mockFetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: [] }),
}));
(globalThis as Record<string, unknown>).fetch = mockFetch;

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: jest.fn(),
    back: jest.fn(),
  },
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    replace: jest.fn(),
    back: jest.fn(),
  }),
}));
jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

function makeProgram(overrides: Partial<ProgramSummary> = {}): ProgramSummary {
  return {
    id: "p-1",
    name: "Strength Foundations",
    description: null,
    durationWeeks: 12,
    daysPerWeek: 4,
    workoutCount: 8,
    activeClientCount: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

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

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function Wrapper({
  adapters,
  queryClient,
  children,
}: {
  adapters: Adapters;
  queryClient: QueryClient;
  children: ReactNode;
}) {
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
  mockPush.mockReset();
  mockFetch.mockClear();
});

describe("ProgramsListContainer", () => {
  it("renders the live list once the cache-first hook resolves", async () => {
    const { adapters, api } = makeAdapters();
    api.programs = [
      makeProgram({ id: "p-active", name: "Strength Foundations" }),
      makeProgram({ id: "p-draft", name: "Lean Bulk", activeClientCount: 0 }),
    ];
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramsListContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("program-row-p-active")).toBeTruthy(),
    );
    expect(screen.getByText("Programmes")).toBeTruthy();
    // Counts derive from the FULL list, not the filtered (Active) view.
    expect(screen.getByText("1 ACTIVE · 1 DRAFTS")).toBeTruthy();
  });

  it("navigates to the create route from the header +", async () => {
    const { adapters, api } = makeAdapters();
    api.programs = [makeProgram()];
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramsListContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("programs-create-btn")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("programs-create-btn"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/programs/create");
  });

  it("navigates to the edit route on a row press", async () => {
    const { adapters, api } = makeAdapters();
    api.programs = [makeProgram({ id: "p-42" })];
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramsListContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("program-row-p-42")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("program-row-p-42"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/programs/p-42");
  });

  it("renders the empty state when the trainer has no programmes", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <ProgramsListContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("programs-empty")).toBeTruthy(),
    );
  });
});
