import { act, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import type { HomePresenterProps } from "@/ui/presenters/HomePresenter";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { HomeContainer } from "../HomeContainer";

// jest hoists jest.mock factories above imports — captured refs must be
// `mock*`-prefixed to satisfy the hoist guard.
const mockPush = jest.fn();
// Probe presenter: captures the latest props the container passes down + the
// render count. Returns null (we assert on props, not output).
const mockProbe: { last: HomePresenterProps | null } = { last: null };

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));
jest.mock("@/ui/presenters/HomePresenter", () => ({
  HomePresenter: (props: HomePresenterProps) => {
    mockProbe.last = props;
    return null;
  },
}));

const mockFetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: {} }),
}));
(globalThis as Record<string, unknown>).fetch = mockFetch;

const USER = "user-1";

function makeAdapters(): {
  adapters: Adapters;
  api: InMemoryApiAdapter;
  storage: InMemoryStorageAdapter;
} {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: USER,
    email: "alex@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  return {
    api,
    storage,
    adapters: {
      api,
      auth,
      storage,
      health: {} as Adapters["health"],
      notifications: {} as Adapters["notifications"],
      payments: {} as Adapters["payments"],
      netInfo: {} as Adapters["netInfo"],
    },
  };
}

function Wrapper({
  adapters,
  children,
}: {
  adapters: Adapters;
  children: ReactNode;
}) {
  return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
}

describe("HomeContainer (V2)", () => {
  beforeEach(() => {
    mockProbe.last = null;
    mockPush.mockClear();
  });

  it("renders the presenter and populates the home payload from the API", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <HomeContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.home).not.toBeNull());
    expect(mockProbe.last?.user.initials).toBe("A"); // from alex@example.com
    expect(mockProbe.last?.weekDates).toHaveLength(7);
    expect(mockProbe.last?.showCoachPeek).toBe(false); // default athlete mode
  });

  it("routes to the You tab via onOpenTab", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <HomeContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    act(() => mockProbe.last?.onOpenTab("you"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/(tabs)/you");
  });

  it("opens the notifications list via the header bell", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <HomeContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    act(() => mockProbe.last?.onOpenNotifications());
    expect(mockPush).toHaveBeenCalledWith("/(app)/notifications");
  });

  it("toggling a habit writes the optimistic completion to cache", async () => {
    const { adapters, storage } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <HomeContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    await act(async () => {
      mockProbe.last?.onToggleHabitDay("g1", "2026-06-10", true);
    });
    await waitFor(() =>
      expect(
        storage.getCachedHabitCompletions(USER, { goalId: "g1" }),
      ).toHaveLength(1),
    );
  });
});
