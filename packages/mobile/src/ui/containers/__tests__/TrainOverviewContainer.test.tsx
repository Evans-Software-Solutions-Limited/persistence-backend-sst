import { render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Alert } from "react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { TrainOverviewPresenterProps } from "@/ui/presenters/TrainOverviewPresenter";
import type { Goal } from "@/domain/models/goal";
import type { HomePayload } from "@/domain/models/progress";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const captured: { props: TrainOverviewPresenterProps | null } = { props: null };
jest.mock("@/ui/presenters/TrainOverviewPresenter", () => ({
  TrainOverviewPresenter: (props: TrainOverviewPresenterProps) => {
    captured.props = props;
    return null;
  },
}));

/* eslint-disable import/first */
import { TrainOverviewContainer } from "@/ui/containers/TrainOverviewContainer";
import { useGoalSheet } from "@/state/goal-sheet";
/* eslint-enable import/first */

const USER = "u-1";

function selfGoal(over: Partial<Goal> = {}): Goal {
  return {
    id: "g-1",
    goalTypeId: "gt-1",
    goalTypeName: "Squat 1RM",
    iconName: null,
    category: null,
    targetValue: null,
    currentValue: null,
    unit: null,
    targetDate: null,
    notes: null,
    priority: 1,
    isActive: true,
    assignedByUserId: null,
    assignedByName: null,
    isCoachAssigned: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

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
    payments: new MockPaymentsAdapter(),
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
    useGoalSheet.getState().closeSheet();
    jest.restoreAllMocks();
  });

  it("passes the cached programme + goals to the presenter", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheHome(USER, homePayload());
    storage.cacheGoals(USER, [selfGoal()]);

    renderContainer(adapters);

    await waitFor(() => expect(props().goals).toHaveLength(1));
    expect(props().activeProgramme?.name).toBe("Strength Foundations");
    expect(props().goals[0].goalTypeName).toBe("Squat 1RM");
  });

  it("fetches + maps goals from the API when the cache is empty", async () => {
    const { adapters } = makeAdapters();
    // No cached goals → useGetGoals refreshes and maps the enriched wire rows.
    (adapters.api as InMemoryApiAdapter).goals.push({
      id: "g-remote",
      userId: USER,
      goalTypeId: "gt-1",
      priority: 1,
      targetDate: "2026-12-31",
      isActive: true,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      goalTypeName: "Squat 1RM",
      assignedByUserId: "coach-1",
      assignedByName: "Coach Jane",
    });

    renderContainer(adapters);

    await waitFor(() => expect(props().goals).toHaveLength(1));
    expect(props().goals[0].goalTypeName).toBe("Squat 1RM");
    expect(props().goals[0].isCoachAssigned).toBe(true);
    expect(props().goals[0].assignedByName).toBe("Coach Jane");
  });

  it("onAddGoal opens the sheet excluding already-owned types", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheGoals(USER, [selfGoal({ goalTypeId: "gt-1" })]);

    renderContainer(adapters);
    await waitFor(() => expect(props().goals).toHaveLength(1));

    props().onAddGoal();
    const s = useGoalSheet.getState();
    expect(s.open).toBe(true);
    expect(s.editGoal).toBeNull();
    expect(s.takenGoalTypeIds).toEqual(["gt-1"]);
  });

  it("onEditGoal opens the sheet in edit mode", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheGoals(USER, [selfGoal()]);

    renderContainer(adapters);
    await waitFor(() => expect(props().goals).toHaveLength(1));

    props().onEditGoal(props().goals[0]);
    const s = useGoalSheet.getState();
    expect(s.open).toBe(true);
    expect(s.editGoal?.goalId).toBe("g-1");
    expect(s.editGoal?.goalTypeName).toBe("Squat 1RM");
  });

  it("onDeleteGoal confirms then optimistically removes the goal", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheGoals(USER, [selfGoal()]);
    storage.getCachedGoals(USER); // touch
    // Auto-confirm the destructive alert button.
    jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      const del = buttons?.find((b) => b.style === "destructive");
      del?.onPress?.();
    });

    renderContainer(adapters);
    await waitFor(() => expect(props().goals).toHaveLength(1));

    // Retry until the auth session hydrates (delete guards on userId).
    await waitFor(() => {
      props().onDeleteGoal(props().goals[0]);
      expect(storage.getCachedGoals(USER)).toEqual([]);
    });
  });
});
