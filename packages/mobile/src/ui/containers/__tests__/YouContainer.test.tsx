import { act, render, waitFor } from "@testing-library/react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Achievement } from "@/domain/models/achievement";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import type { YouPresenterProps } from "@/ui/presenters/YouPresenter";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { PROFILE_PAGE_FIXTURE } from "@/adapters/api/__tests__/fixtures/profile-page.fixture";
import { YouContainer, buildMilestoneTiers } from "../YouContainer";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));
jest.mock("@/state/drawer", () => ({ useDrawer: () => jest.fn() }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useNavigation: () => ({ addListener: () => () => {} }),
}));

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
      health: {
        isAvailable: jest.fn(async () => false),
        getPermissionStatus: jest.fn(async () => ({
          steps: "not_determined",
          calories: "not_determined",
          bodyWeight: "not_determined",
          heartRate: "not_determined",
        })),
        writeBodyWeight: jest.fn(async () => ok(undefined)),
      } as unknown as Adapters["health"],
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

  it("derives avatar initials from the profile name once it resolves", async () => {
    // §2: initials should prefer the profile full name (legacy parity), not the
    // email. The fixture's "Brad Simms" → "BS"; without the profile the email
    // ("alex@example.com") would yield "A".
    const { api, adapters } = makeAdapters();
    api.profilePage = PROFILE_PAGE_FIXTURE;
    render(
      <AdapterProvider adapters={adapters}>
        <YouContainer />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.last?.initials).toBe("BS"));
  });

  it("falls back to the email initial until the profile resolves", async () => {
    // No profile fixture configured → getProfilePage 404s → initials fall back
    // to the email ("alex@example.com" → "A").
    const { adapters } = makeAdapters();
    render(
      <AdapterProvider adapters={adapters}>
        <YouContainer />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    expect(mockProbe.last?.initials).toBe("A");
  });

  it("surfaces the HealthKit body-fat reading when the app has no in-app fat history", async () => {
    // Renpho-style flow: weight + body fat are written to Apple Health by a
    // connected scale, never logged in-app. The /body-trend API therefore
    // carries no body fat, and the You-page tile would be empty without the
    // HealthKit fallback.
    const { adapters } = makeAdapters();
    adapters.health = {
      isAvailable: jest.fn(async () => true),
      getPermissionStatus: jest.fn(async () => ({
        steps: "granted",
        calories: "granted",
        bodyWeight: "granted",
        heartRate: "granted",
      })),
      getStepsToday: jest.fn(async () => ok(0)),
      getStepsLastNDays: jest.fn(async () => ok([])),
      getActiveCaloriesToday: jest.fn(async () => ok(0)),
      getBasalCaloriesToday: jest.fn(async () => ok(0)),
      getStandTimeTodayMinutes: jest.fn(async () => ok(0)),
      getLatestBodyWeight: jest.fn(async () =>
        ok({ value: 78.2, unit: "kg", date: "2026-06-29T12:00:00.000Z" }),
      ),
      getLatestBodyFat: jest.fn(async () =>
        ok({ value: 22.5, date: "2026-06-29T12:00:00.000Z" }),
      ),
    } as unknown as Adapters["health"];

    render(
      <AdapterProvider adapters={adapters}>
        <YouContainer />
      </AdapterProvider>,
    );

    await waitFor(() =>
      expect(mockProbe.last?.bodyTrend.bodyFat.current).toBe(22.5),
    );
    expect(mockProbe.last?.bodyTrend.bodyFat.series).toContain(22.5);
    // The paired weight reading should appear on the weight tile too.
    expect(mockProbe.last?.bodyTrend.weight.current).toBe(78.2);
  });

  it("does NOT let a STALE-dated HealthKit fat reading override newer in-app fat history", async () => {
    // A scale syncing a fresh WEIGHT without a new fat measurement must not
    // surface a stale fat value as "current". The fat merge compares the fat
    // sample's OWN date against the last in-app fat point — never the weight's
    // recency as a proxy (Inspector Brad MEDIUM, PR #143).
    const { api, adapters } = makeAdapters();
    api.bodyTrend = [
      { date: "2026-06-20T00:00:00.000Z", weightKg: 80.0, bodyFat: 20.0 },
      { date: "2026-06-28T00:00:00.000Z", weightKg: 79.0, bodyFat: 19.5 },
    ];
    adapters.health = {
      isAvailable: jest.fn(async () => true),
      getPermissionStatus: jest.fn(async () => ({
        steps: "granted",
        calories: "granted",
        bodyWeight: "granted",
        heartRate: "granted",
      })),
      getStepsToday: jest.fn(async () => ok(0)),
      getStepsLastNDays: jest.fn(async () => ok([])),
      getActiveCaloriesToday: jest.fn(async () => ok(0)),
      getBasalCaloriesToday: jest.fn(async () => ok(0)),
      getStandTimeTodayMinutes: jest.fn(async () => ok(0)),
      // A weight newer than the last in-app weigh-in...
      getLatestBodyWeight: jest.fn(async () =>
        ok({ value: 78.2, unit: "kg", date: "2026-06-30T12:00:00.000Z" }),
      ),
      // ...but a STALE fat reading from before the last in-app fat log.
      // Must not become "current".
      getLatestBodyFat: jest.fn(async () =>
        ok({ value: 25.0, date: "2026-06-23T12:00:00.000Z" }),
      ),
    } as unknown as Adapters["health"];

    render(
      <AdapterProvider adapters={adapters}>
        <YouContainer />
      </AdapterProvider>,
    );

    // In-app fat history is preserved; the stale HealthKit 25.0 is ignored.
    await waitFor(() =>
      expect(mockProbe.last?.bodyTrend.bodyFat.current).toBe(19.5),
    );
    expect(mockProbe.last?.bodyTrend.bodyFat.series).toEqual([20.0, 19.5]);
    expect(mockProbe.last?.bodyTrend.bodyFat.series).not.toContain(25.0);
    // Weight still merges (it HAS a timestamp and is genuinely newer).
    expect(mockProbe.last?.bodyTrend.weight.current).toBe(78.2);
  });

  it("merges a HealthKit fat reading NEWER than the last in-app fat log", async () => {
    // The fat sample now carries its own date, so a fresh connected-scale
    // reading taken after the last in-app log becomes "current" — the same
    // rule the weight merge has always used.
    const { api, adapters } = makeAdapters();
    api.bodyTrend = [
      { date: "2026-06-20T00:00:00.000Z", weightKg: 80.0, bodyFat: 20.0 },
      { date: "2026-06-28T00:00:00.000Z", weightKg: 79.0, bodyFat: 19.5 },
    ];
    adapters.health = {
      isAvailable: jest.fn(async () => true),
      getPermissionStatus: jest.fn(async () => ({
        steps: "granted",
        calories: "granted",
        bodyWeight: "granted",
        heartRate: "granted",
      })),
      getStepsToday: jest.fn(async () => ok(0)),
      getStepsLastNDays: jest.fn(async () => ok([])),
      getActiveCaloriesToday: jest.fn(async () => ok(0)),
      getBasalCaloriesToday: jest.fn(async () => ok(0)),
      getStandTimeTodayMinutes: jest.fn(async () => ok(0)),
      getLatestBodyWeight: jest.fn(async () =>
        ok({ value: 78.2, unit: "kg", date: "2026-06-30T12:00:00.000Z" }),
      ),
      getLatestBodyFat: jest.fn(async () =>
        ok({ value: 18.9, date: "2026-06-30T12:00:00.000Z" }),
      ),
    } as unknown as Adapters["health"];

    render(
      <AdapterProvider adapters={adapters}>
        <YouContainer />
      </AdapterProvider>,
    );

    await waitFor(() =>
      expect(mockProbe.last?.bodyTrend.bodyFat.current).toBe(18.9),
    );
    expect(mockProbe.last?.bodyTrend.bodyFat.series).toEqual([
      20.0, 19.5, 18.9,
    ]);
  });

  it("keeps onRefresh referentially stable across re-renders", async () => {
    // Regression (PR #37): the useCallback deps were the whole hook-result
    // objects (fresh literals each render), defeating memoisation. Depending on
    // the stable .refresh callbacks fixes it.
    const { adapters } = makeAdapters();
    const { rerender } = render(
      <AdapterProvider adapters={adapters}>
        <YouContainer />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    const first = mockProbe.last?.onRefresh;
    rerender(
      <AdapterProvider adapters={adapters}>
        <YouContainer />
      </AdapterProvider>,
    );
    expect(mockProbe.last?.onRefresh).toBe(first);
  });

  it("surfaces the active trainer and pending-request count", async () => {
    const { api, adapters } = makeAdapters();
    api.clientRelationships = [
      {
        relationshipId: "rel-active",
        trainerId: "trainer-1",
        trainerName: "Coach Carter",
        trainerRole: "personal_trainer",
        trainerAvatarUrl: null,
        status: "active",
        relationshipReason: null,
        since: "2026-03-01T00:00:00.000Z",
      },
      {
        relationshipId: "rel-pending",
        trainerId: "trainer-2",
        trainerName: "Dr. Lee",
        trainerRole: "physiotherapist",
        trainerAvatarUrl: null,
        status: "pending",
        relationshipReason: null,
        since: null,
      },
    ];
    render(
      <AdapterProvider adapters={adapters}>
        <YouContainer />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.last?.trainer).not.toBeNull());
    expect(mockProbe.last?.trainer?.name).toBe("Coach Carter");
    expect(mockProbe.last?.pendingRequestCount).toBe(1);
    // Exercise the requests-navigation callback.
    act(() => {
      mockProbe.last?.onOpenRequests();
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
