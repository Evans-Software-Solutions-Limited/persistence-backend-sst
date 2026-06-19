import { act, render, waitFor } from "@testing-library/react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Achievement } from "@/domain/models/achievement";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import type { YouPresenterProps } from "@/ui/presenters/YouPresenter";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { YouContainer, buildMilestoneTiers } from "../YouContainer";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));
jest.mock("@/state/drawer", () => ({ useDrawer: () => jest.fn() }));

const mockProbe: { last: YouPresenterProps | null } = { last: null };
jest.mock("@/ui/presenters/YouPresenter", () => ({
  YouPresenter: (props: YouPresenterProps) => {
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

describe("buildMilestoneTiers", () => {
  it("marks workout-streak tiers earned from achievements", () => {
    const achievements: Achievement[] = [
      {
        id: "ua1",
        achievementId: "a1",
        name: "Workout Streak — 4 weeks",
        description: null,
        category: "streak",
        requirements: { streak_type: "workout_streak", threshold: 4 },
        unlockedAt: null,
      },
    ];
    const tiers = buildMilestoneTiers(achievements);
    expect(tiers).toHaveLength(5);
    expect(tiers.find((t) => t.label === "4w")?.earned).toBe(true);
    expect(tiers.find((t) => t.label === "1w")?.earned).toBe(false);
  });

  it("returns all-unearned for an empty set", () => {
    expect(buildMilestoneTiers([]).every((t) => !t.earned)).toBe(true);
  });
});

function makeAdapters() {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: "user-1",
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
    adapters: {
      api,
      auth,
      storage,
      health: {} as Adapters["health"],
      notifications: {} as Adapters["notifications"],
      payments: {} as Adapters["payments"],
      netInfo: {} as Adapters["netInfo"],
    } as Adapters,
  };
}

describe("YouContainer", () => {
  beforeEach(() => {
    mockProbe.last = null;
    mockFetch.mockClear();
  });

  it("wires the streak + volume + milestone props from the API", async () => {
    const { api, adapters } = makeAdapters();
    api.streaks = [
      {
        id: "s1",
        userId: "user-1",
        streakType: "workout_streak",
        sourceGoalId: null,
        period: "weekly",
        currentCount: 4,
        longestCount: 8,
        lastPeriodEnd: "2026-06-07",
        freezeTokens: 2,
        status: "active",
      },
    ];
    render(
      <AdapterProvider adapters={adapters}>
        <YouContainer />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.last?.streak).not.toBeNull());
    expect(mockProbe.last?.streak?.current).toBe(4);
    expect(mockProbe.last?.streak?.unit).toBe("weeks");
    expect(mockProbe.last?.milestones).toHaveLength(5);
    expect(mockProbe.last?.initials).toBe("A");

    // Exercise the wired callbacks (use-token spends + refreshes; refresh
    // fans out to every read hook).
    await act(async () => {
      await mockProbe.last?.onUseToken();
    });
    await act(async () => {
      mockProbe.last?.onRefresh();
    });
  });

  it("escapes the loader and surfaces the error when a cold-start fetch fails", async () => {
    const { api, adapters } = makeAdapters();
    api.shouldFail = true; // empty cache + failing GET
    render(
      <AdapterProvider adapters={adapters}>
        <YouContainer />
      </AdapterProvider>,
    );
    // Same loader-trap guard as Home: once the failed streaks fetch settles,
    // isLoading must drop to false so YouPresenter can render its error state.
    await waitFor(() => expect(mockProbe.last?.error).not.toBeNull());
    expect(mockProbe.last?.isLoading).toBe(false);
  });
});
