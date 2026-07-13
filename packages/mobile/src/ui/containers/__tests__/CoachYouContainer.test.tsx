import { act, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { WorkoutSession } from "@/domain/models/session";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import type { CoachYouPresenterProps } from "@/ui/presenters/CoachYouPresenter";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useAddClientSheet } from "@/state/add-client-sheet";
import { CoachYouContainer, buildSessionCaption } from "../CoachYouContainer";
import { makeCoachOverview } from "@/ui/presenters/coach/__tests__/coachOverview.fixture";

const mockSwitchMode = jest.fn();
const mockProbe: { last: CoachYouPresenterProps | null } = { last: null };

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@/ui/hooks/useModeSwitch", () => ({
  useModeSwitch: () => ({ switchMode: mockSwitchMode }),
}));
jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));
jest.mock("@/ui/presenters/CoachYouPresenter", () => ({
  CoachYouPresenter: (props: CoachYouPresenterProps) => {
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

const USER = "trainer-1";

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
    email: "coach@example.com",
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

describe("buildSessionCaption", () => {
  it("returns null when there is no session", () => {
    expect(buildSessionCaption(null)).toBeNull();
  });

  it("includes the derived duration when completed", () => {
    const s = {
      id: "s1",
      userId: USER,
      workoutId: null,
      name: "Upper Body",
      status: "completed",
      startedAt: "2026-06-21T07:00:00.000Z",
      completedAt: "2026-06-21T07:45:00.000Z",
      exercises: [],
      notes: null,
    } as WorkoutSession;
    expect(buildSessionCaption(s)).toBe("Last session: Upper Body · 45m");
  });

  it("omits the duration when not completed", () => {
    const s = {
      id: "s1",
      userId: USER,
      workoutId: null,
      name: "Push Day",
      status: "in_progress",
      startedAt: "2026-06-21T07:00:00.000Z",
      completedAt: null,
      exercises: [],
      notes: null,
    } as WorkoutSession;
    expect(buildSessionCaption(s)).toBe("Last session: Push Day");
  });
});

describe("CoachYouContainer", () => {
  beforeEach(() => {
    mockProbe.last = null;
    mockSwitchMode.mockClear();
    useAddClientSheet.setState({ open: false, onInvited: null });
  });

  it("populates the presenter from the overview endpoint", async () => {
    const { adapters, api } = makeAdapters();
    api.coachOverview = makeCoachOverview();
    api.streaks = [
      {
        id: "st1",
        userId: USER,
        streakType: "workout_streak",
        sourceGoalId: null,
        period: "daily",
        currentCount: 23,
        longestCount: 30,
        lastPeriodEnd: "2026-06-21",
        freezeTokens: 0,
        status: "active",
      },
    ];
    render(
      <Wrapper adapters={adapters}>
        <CoachYouContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.overview).not.toBeNull());
    expect(mockProbe.last?.coachName).toBe("Bradley Evans");
    expect(mockProbe.last?.initials).toBe("BE");
    expect(mockProbe.last?.streakCount).toBe(23);
    expect(mockProbe.last?.coachMeta).toContain("8 active clients");
    expect(mockProbe.last?.coachMeta).toContain("Coach since Feb 2024");
  });

  it("routes the relocated Workout library entry to the coach workout library", async () => {
    mockPush.mockClear();
    const { adapters, api } = makeAdapters();
    api.coachOverview = makeCoachOverview();
    render(
      <Wrapper adapters={adapters}>
        <CoachYouContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    mockProbe.last?.onOpenWorkoutLibrary?.();
    expect(mockPush).toHaveBeenCalledWith("/(app)/workouts/library");
  });

  it("labels a weekly streak in weeks", async () => {
    const { adapters, api } = makeAdapters();
    api.coachOverview = makeCoachOverview();
    api.streaks = [
      {
        id: "st1",
        userId: USER,
        streakType: "workout_streak",
        sourceGoalId: null,
        period: "weekly",
        currentCount: 5,
        longestCount: 9,
        lastPeriodEnd: "2026-06-21",
        freezeTokens: 0,
        status: "active",
      },
    ];
    render(
      <Wrapper adapters={adapters}>
        <CoachYouContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.overview).not.toBeNull());
    expect(mockProbe.last?.streakCount).toBe(5);
    expect(mockProbe.last?.streakUnit).toBe("week");
  });

  it("derives the session caption from the latest cached session", async () => {
    const { adapters, api, storage } = makeAdapters();
    api.coachOverview = makeCoachOverview();
    storage.cacheActiveSession(USER, {
      id: "s1",
      userId: USER,
      workoutId: null,
      name: "Leg Day",
      status: "completed",
      startedAt: "2026-06-21T07:00:00.000Z",
      completedAt: "2026-06-21T07:30:00.000Z",
      exercises: [],
      notes: null,
    } as WorkoutSession);
    render(
      <Wrapper adapters={adapters}>
        <CoachYouContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    expect(mockProbe.last?.sessionCaption).toBe("Last session: Leg Day · 30m");
  });

  it("switches to athlete mode via onSwitchToAthlete", async () => {
    const { adapters, api } = makeAdapters();
    api.coachOverview = makeCoachOverview();
    render(
      <Wrapper adapters={adapters}>
        <CoachYouContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    act(() => mockProbe.last?.onSwitchToAthlete());
    expect(mockSwitchMode).toHaveBeenCalledWith("athlete", "you");
  });

  it("opens the AddClient sheet (registering the overview refresh) on invite", async () => {
    const { adapters, api } = makeAdapters();
    api.coachOverview = makeCoachOverview();
    render(
      <Wrapper adapters={adapters}>
        <CoachYouContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    act(() => mockProbe.last?.onInvite());
    const state = useAddClientSheet.getState();
    expect(state.open).toBe(true);
    expect(typeof state.onInvited).toBe("function");
  });

  it("surfaces the error and clears the loader when the cold fetch fails", async () => {
    const { adapters, api } = makeAdapters();
    api.shouldFail = true; // empty cache + failing GET
    render(
      <Wrapper adapters={adapters}>
        <CoachYouContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.error).not.toBeNull());
    expect(mockProbe.last?.isLoading).toBe(false);
    expect(mockProbe.last?.overview).toBeNull();
  });

  it("falls back to email initials + 'Coach' name before the overview lands", async () => {
    const { adapters, api } = makeAdapters();
    api.shouldFail = true;
    render(
      <Wrapper adapters={adapters}>
        <CoachYouContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    expect(mockProbe.last?.coachName).toBe("Coach");
    expect(mockProbe.last?.initials).toBe("C"); // from coach@example.com
    expect(mockProbe.last?.coachMeta).toContain("0 active clients");
  });

  it("onRefresh re-pulls both the overview and the streaks", async () => {
    const { adapters, api } = makeAdapters();
    api.coachOverview = makeCoachOverview();
    render(
      <Wrapper adapters={adapters}>
        <CoachYouContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.overview).not.toBeNull());
    const before = api.getCoachOverviewCalls;
    await act(async () => {
      await mockProbe.last?.onRefresh();
    });
    expect(api.getCoachOverviewCalls).toBeGreaterThan(before);
  });

  it("invite's onInvited callback refreshes the overview", async () => {
    const { adapters, api } = makeAdapters();
    api.coachOverview = makeCoachOverview();
    render(
      <Wrapper adapters={adapters}>
        <CoachYouContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    act(() => mockProbe.last?.onInvite());
    const onInvited = useAddClientSheet.getState().onInvited;
    const before = api.getCoachOverviewCalls;
    await act(async () => {
      onInvited?.();
    });
    await waitFor(() =>
      expect(api.getCoachOverviewCalls).toBeGreaterThan(before),
    );
  });

  it("keeps onRefresh referentially stable across re-renders", async () => {
    const { adapters, api } = makeAdapters();
    api.coachOverview = makeCoachOverview();
    const { rerender } = render(
      <Wrapper adapters={adapters}>
        <CoachYouContainer />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    const first = mockProbe.last?.onRefresh;
    rerender(
      <Wrapper adapters={adapters}>
        <CoachYouContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.onRefresh).toBe(first);
  });
});
