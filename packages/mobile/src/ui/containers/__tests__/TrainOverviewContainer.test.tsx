import { act, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { TrainOverviewPresenterProps } from "@/ui/presenters/TrainOverviewPresenter";
import type { HomePayload } from "@/domain/models/progress";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

const mockPush = jest.fn();
let mockFocusCallback: (() => void | (() => void)) | null = null;
jest.mock("expo-router", () => {
  const React = jest.requireActual("react") as typeof import("react");
  return {
    useRouter: () => ({ push: mockPush }),
    // Run the focus callback once on mount (= first focus, which
    // useRefreshOnFocus skips) so the container's focus-refresh wiring doesn't
    // throw and existing assertions are unaffected.
    useFocusEffect: (cb: () => void | (() => void)) => {
      mockFocusCallback = cb;
      React.useEffect(cb, [cb]);
    },
  };
});

const captured: { props: TrainOverviewPresenterProps | null } = { props: null };
jest.mock("@/ui/presenters/TrainOverviewPresenter", () => ({
  TrainOverviewPresenter: (props: TrainOverviewPresenterProps) => {
    captured.props = props;
    return null;
  },
}));

/* eslint-disable import/first */
import { TrainOverviewContainer } from "@/ui/containers/TrainOverviewContainer";
/* eslint-enable import/first */

const USER = "u-1";

function homePayload(): HomePayload {
  return {
    rings: {
      move: { current: 0, target: 100, pct: 0, unit: "" },
      train: { current: 0, target: 100, pct: 0, unit: "" },
      fuel: "gated",
      todayPct: 0,
    },
    micro: { streak: 0, water: null, strain: null, sleep: null },
    weeklyVolume: {
      days: [],
      totalKg: 0,
      deltaPct: null,
      workouts: { completed: 0, target: 0 },
    },
    recentPRs: [],
    habits: [],
    todayWorkout: [],
    activeProgramme: {
      assignmentId: "pa-1",
      programId: "p-1",
      name: "Strength Foundations",
      week: 2,
      totalWeeks: 8,
      endDate: null,
      startDate: "2026-06-01",
      assignedByName: "Coach Jane",
    },
    todaysTraining: [],
  };
}

function makeAdapters(): {
  adapters: Adapters;
  storage: InMemoryStorageAdapter;
} {
  const api = new InMemoryApiAdapter();
  const auth = new InMemoryAuthAdapter();
  auth.currentSession = {
    accessToken: "tok",
    refreshToken: "rtok",
    userId: USER,
    email: "athlete@x.com",
    expiresAt: Date.now() + 3_600_000,
  };
  const storage = new InMemoryStorageAdapter();
  const adapters: Adapters = {
    api,
    auth,
    storage,
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(true),
  };
  return { adapters, storage };
}

function renderContainer(adapters: Adapters) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
  );
  return render(<TrainOverviewContainer />, { wrapper });
}

function props(): TrainOverviewPresenterProps {
  if (!captured.props) throw new Error("presenter not rendered");
  return captured.props;
}

describe("<TrainOverviewContainer>", () => {
  beforeEach(() => {
    captured.props = null;
    mockPush.mockReset();
    jest.restoreAllMocks();
  });

  it("passes the cached active programme + today's training to the presenter", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheHome(USER, homePayload());

    renderContainer(adapters);

    await waitFor(() =>
      expect(props().activeProgramme?.name).toBe("Strength Foundations"),
    );
    expect(props().activeProgramme?.week).toBe(2);
    expect(props().todaysTraining).toEqual([]);
  });

  it("onOpenWorkout routes to the workout detail screen", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheHome(USER, homePayload());

    renderContainer(adapters);
    await waitFor(() => expect(captured.props).not.toBeNull());

    props().onOpenWorkout("w-9");
    expect(mockPush).toHaveBeenCalledWith("/(app)/workouts/w-9");
  });

  it("onOpenProgramme routes to the athlete programme view (not the coach editor)", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheHome(USER, homePayload());

    renderContainer(adapters);
    await waitFor(() => expect(props().activeProgramme?.programId).toBe("p-1"));

    props().onOpenProgramme?.();
    expect(mockPush).toHaveBeenCalledWith("/(app)/programs/view/p-1");
  });

  it("does not fall back to another coach's programme when the relationship assignment explicitly has none", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheHome(USER, homePayload());
    (adapters.api as InMemoryApiAdapter).clientRelationships = [
      {
        relationshipId: "rel-1",
        trainerId: "coach-a",
        trainerName: "Coach A",
        trainerRole: "personal_trainer",
        trainerAvatarUrl: null,
        status: "active",
        relationshipReason: null,
        since: "2026-06-01T00:00:00.000Z",
        initiatedBy: "trainer",
        assignment: {
          activeProgramme: null,
          upcomingWorkouts: [],
          habits: [],
          nutritionTarget: null,
          activeGoal: null,
          visibleBriefs: [],
        },
      },
    ];

    renderContainer(adapters);

    await waitFor(() => expect(props().coaching?.assignmentLoaded).toBe(true));
    expect(props().activeProgramme).toBeNull();
    props().onOpenProgramme?.();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("onRefresh refetches the home payload from the network", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheHome(USER, homePayload());
    const getHome = jest.spyOn(adapters.api, "getHome");

    renderContainer(adapters);
    await waitFor(() =>
      expect(props().activeProgramme?.name).toBe("Strength Foundations"),
    );

    const before = getHome.mock.calls.length;
    await act(async () => {
      props().onRefresh();
    });
    await waitFor(() =>
      expect(getHome.mock.calls.length).toBeGreaterThan(before),
    );
  });

  it("refetches active relationships when the kept-alive tab regains focus", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheHome(USER, homePayload());
    const getRelationships = jest.spyOn(adapters.api, "getClientRelationships");

    renderContainer(adapters);
    await waitFor(() => expect(mockFocusCallback).not.toBeNull());
    const before = getRelationships.mock.calls.length;
    await act(async () => {
      mockFocusCallback?.();
    });
    await waitFor(() =>
      expect(getRelationships.mock.calls.length).toBeGreaterThan(before),
    );
    expect((adapters.api as InMemoryApiAdapter).analyticsEvents).toContainEqual(
      { name: "coaching_overview_opened" },
    );
  });
});
