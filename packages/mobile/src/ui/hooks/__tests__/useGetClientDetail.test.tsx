import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { Adapters } from "@/shared/types";
import type { ClientDetail } from "@/domain/models/clientDetail";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  CLIENT_DETAIL_STALE_AFTER_MS,
  isClientDetailStale,
  useGetClientDetail,
} from "@/ui/hooks/useGetClientDetail";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

function stubDetail(clientId: string, title: string): ClientDetail {
  return {
    client: {
      id: clientId,
      name: "Client",
      initials: "CC",
      avatarUrl: null,
      status: "active",
      ageYears: null,
      heightCm: null,
      preferredUnits: null,
    },
    adherence: { overall: null, band: null, categories: [] },
    prs: [],
    volume: { weekKg: null, daily: [] },
    calorieHit: null,
    goal: {
      id: "g",
      title,
      unit: "kg",
      targetDate: null,
      assignedByCoach: true,
      weight: { startKg: null, nowKg: null, targetKg: null },
      pct: null,
    },
    habits: null,
    aiSummary: {
      summary: null,
      coversDate: null,
      generatedAt: null,
      canManualRefresh: false,
    },
    thisWeek: {
      workoutsCompleted: 0,
      workoutsPlanned: null,
      volumeKg: null,
      prs: 0,
      checkIns: null,
    },
    recentSessions: [],
    notes: [],
  };
}

function setup(clientId: string | undefined) {
  const api = new InMemoryApiAdapter();
  api.clientDetails["c-1"] = stubDetail("c-1", "Goal One");
  const auth = new InMemoryAuthAdapter();
  auth.currentSession = {
    accessToken: "tok",
    refreshToken: "rtok",
    userId: "trainer-1",
    email: "c@x.com",
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
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
  );
  return {
    api,
    adapters,
    ...renderHook(() => useGetClientDetail(clientId), { wrapper }),
  };
}

describe("isClientDetailStale", () => {
  const now = 1_000_000_000_000;

  it("is stale with no timestamp / garbage timestamp", () => {
    expect(isClientDetailStale(null, now)).toBe(true);
    expect(isClientDetailStale("nope", now)).toBe(true);
  });

  it("is fresh within the TTL, stale past it", () => {
    expect(isClientDetailStale(new Date(now - 1000).toISOString(), now)).toBe(
      false,
    );
    expect(
      isClientDetailStale(
        new Date(now - CLIENT_DETAIL_STALE_AFTER_MS - 1000).toISOString(),
        now,
      ),
    ).toBe(true);
  });
});

describe("useGetClientDetail", () => {
  it("fetches + caches the aggregate keyed by (userId, clientId)", async () => {
    const { result, adapters } = setup("c-1");
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.data?.goal?.title).toBe("Goal One");
    // Cached under the composite key so a re-mount reads it back.
    expect(
      adapters.storage.getCachedClientDetail("trainer-1", "c-1"),
    ).not.toBeNull();
  });

  it("stays empty + stale with no clientId (never fetches)", async () => {
    const { result, api } = setup(undefined);
    await waitFor(() => expect(result.current.isRefreshing).toBe(false));
    expect(result.current.data).toBeNull();
    expect(api.getClientDetailCalls).toHaveLength(0);
  });
});
