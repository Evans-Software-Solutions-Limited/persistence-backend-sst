import { act, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { ClientDetailProps } from "@/ui/presenters/coach/ClientDetailPresenter";
import type { ClientDetail } from "@/domain/models/clientDetail";
import type { ActiveProgramme } from "@/domain/models/progress";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockParams: { id?: string; name?: string } = {
  id: "client-1",
  name: "Jordan",
};
// Capture the focus callback so a test can invoke it manually (wrapped in act)
// rather than firing it on every render — the container's first-focus guard is
// otherwise device-behavior.
const focusCallbacks: (() => void)[] = [];
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void) => {
    focusCallbacks.length = 0;
    focusCallbacks.push(cb);
  },
}));

const mockCaptured: { props: ClientDetailProps | null } = { props: null };
jest.mock("@/ui/presenters/coach/ClientDetailPresenter", () => ({
  ClientDetailPresenter: (props: ClientDetailProps) => {
    mockCaptured.props = props;
    return null;
  },
  // The container imports initialsOf for the Start-live client ref fallback.
  initialsOf: (name: string) => name.slice(0, 2).toUpperCase(),
}));

// These imports resolve the mocked modules above, so they must follow the
// jest.mock calls.
/* eslint-disable import/first */
import {
  ClientDetailContainer,
  buildClientBodyTrend,
} from "@/ui/containers/ClientDetailContainer";
import { useAssignProgramSheet } from "@/state/assign-program-sheet";
import { useAssignWorkoutSheet } from "@/state/assign-workout-sheet";
import { useAssignGoalSheet } from "@/state/assign-goal-sheet";
import { useEditNutritionTargetsSheet } from "@/state/edit-nutrition-targets-sheet";
import { useCoachNoteSheet } from "@/state/coach-note-sheet";
import { useSendBriefSheet } from "@/state/send-brief-sheet";
import { useSwapWorkoutSheet } from "@/state/swap-workout-sheet";
/* eslint-enable import/first */

function props(): ClientDetailProps {
  if (!mockCaptured.props) throw new Error("presenter not rendered");
  return mockCaptured.props;
}

const NULL_SUMMARY: ClientDetail["aiSummary"] = {
  summary: null,
  coversDate: null,
  generatedAt: null,
  canManualRefresh: false,
};

const ACTIVE: ActiveProgramme = {
  assignmentId: "pa1",
  programId: "p1",
  name: "Strength Foundations",
  week: 4,
  totalWeeks: 12,
  endDate: "2026-08-01",
  startDate: "2026-05-01",
};

function fullDetail(over: Partial<ClientDetail> = {}): ClientDetail {
  return {
    client: {
      id: "client-1",
      name: "Jordan Blake",
      initials: "JB",
      avatarUrl: null,
      status: "active",
      ageYears: 30,
      heightCm: 180,
    },
    adherence: { overall: 82, band: "wobbling", categories: [] },
    prs: [],
    volume: { weekKg: 12000, daily: [] },
    calorieHit: {
      targetKcal: 2200,
      daysHit: 4,
      daysLogged: 6,
      todayKcal: 1500,
      todayRemainingKcal: 700,
    },
    goal: {
      id: "g-1",
      title: "Squat 1.5x BW",
      unit: "kg",
      targetDate: "2026-09-01",
      assignedByCoach: true,
      weight: { startKg: 60, nowKg: 62, targetKg: 65 },
      pct: 0.4,
    },
    habits: null,
    // Default to an already-cached summary so unrelated tests don't trip the
    // lazy auto-fire (which would race an async refresh). Summary-specific
    // tests override `aiSummary` with NULL_SUMMARY to exercise the auto-fire.
    aiSummary: {
      summary: "Cached summary.",
      coversDate: "2026-07-07",
      generatedAt: "2026-07-08T06:00:00.000Z",
      canManualRefresh: false,
    },
    thisWeek: {
      workoutsCompleted: 3,
      workoutsPlanned: 5,
      volumeKg: 12000,
      prs: 1,
      checkIns: 5,
    },
    recentSessions: [],
    notes: [],
    ...over,
  };
}

function makeAdapters(connected = true): {
  adapters: Adapters;
  api: InMemoryApiAdapter;
} {
  const api = new InMemoryApiAdapter();
  const auth = new InMemoryAuthAdapter();
  auth.currentSession = {
    accessToken: "tok",
    refreshToken: "rtok",
    userId: "trainer-1",
    email: "coach@x.com",
    expiresAt: Date.now() + 3_600_000,
  };
  const adapters: Adapters = {
    api,
    auth,
    storage: new InMemoryStorageAdapter(),
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new MockPaymentsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(connected),
  };
  return { adapters, api };
}

function renderWith(adapters: Adapters) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
  );
  return render(<ClientDetailContainer />, { wrapper });
}

describe("buildClientBodyTrend", () => {
  it("builds series + deltas, skipping null gaps per field", () => {
    const trend = buildClientBodyTrend([
      { date: "2026-06-01", weightKg: 82, bodyFat: null },
      { date: "2026-06-10", weightKg: null, bodyFat: 22 },
      { date: "2026-06-20", weightKg: 80, bodyFat: 21 },
    ]);
    expect(trend.weight).toEqual({
      current: 80,
      delta: -2,
      series: [82, 80],
      unit: "kg",
    });
    expect(trend.bodyFat).toEqual({ current: 21, delta: -1, series: [22, 21] });
  });

  it("handles an empty series", () => {
    const trend = buildClientBodyTrend([]);
    expect(trend.weight.current).toBeNull();
    expect(trend.bodyFat.series).toEqual([]);
  });
});

describe("ClientDetailContainer — populated", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams.id = "client-1";
    mockParams.name = "Jordan";
  });

  it("composes the aggregate, trend + active programme into props", async () => {
    const { adapters, api } = makeAdapters();
    api.clientDetails["client-1"] = fullDetail();
    api.clientActiveProgrammes["client-1"] = ACTIVE;
    renderWith(adapters);

    await waitFor(() => expect(props().detail).not.toBeNull());
    expect(api.getClientDetailCalls).toContain("client-1");
    expect(props().detail?.goal?.title).toBe("Squat 1.5x BW");
    await waitFor(() => expect(props().activeProgramme).not.toBeNull());
    expect(props().activeProgramme?.programId).toBe("p1");
    expect(props().error).toBeNull();
  });

  it("routes Log weight with the client id + name", async () => {
    const { adapters, api } = makeAdapters();
    api.clientDetails["client-1"] = fullDetail();
    renderWith(adapters);
    await waitFor(() => expect(props().detail).not.toBeNull());
    props().onLogWeight();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/(app)/clients/[id]/log-weight",
      params: { id: "client-1", name: "Jordan" },
    });
  });

  it("routes Manage habits", async () => {
    const { adapters, api } = makeAdapters();
    api.clientDetails["client-1"] = fullDetail();
    renderWith(adapters);
    await waitFor(() => expect(props().detail).not.toBeNull());
    props().onManageHabits();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/(app)/clients/[id]/habits",
      params: { id: "client-1", name: "Jordan" },
    });
  });

  it("navigates back", async () => {
    const { adapters, api } = makeAdapters();
    api.clientDetails["client-1"] = fullDetail();
    renderWith(adapters);
    await waitFor(() => expect(props().detail).not.toBeNull());
    props().onBack();
    expect(mockBack).toHaveBeenCalled();
  });

  it("onEditTargets opens the macros sheet seeded from module d", async () => {
    useEditNutritionTargetsSheet.setState({
      open: false,
      clientId: null,
      initial: null,
      onSaved: null,
    });
    const { adapters, api } = makeAdapters();
    api.clientDetails["client-1"] = fullDetail();
    renderWith(adapters);
    await waitFor(() => expect(props().detail).not.toBeNull());
    props().onEditTargets();
    const s = useEditNutritionTargetsSheet.getState();
    expect(s.open).toBe(true);
    expect(s.clientId).toBe("client-1");
    expect(s.initial?.dailyKcal).toBe(2200);
  });

  it("onAssignGoal opens the goal sheet in create mode", async () => {
    useAssignGoalSheet.setState({
      open: false,
      clientId: null,
      editGoal: null,
      onSaved: null,
    });
    const { adapters, api } = makeAdapters();
    api.clientDetails["client-1"] = fullDetail();
    renderWith(adapters);
    await waitFor(() => expect(props().detail).not.toBeNull());
    props().onAssignGoal();
    const s = useAssignGoalSheet.getState();
    expect(s.open).toBe(true);
    expect(s.editGoal).toBeNull();
  });

  it("onEditGoal opens the goal sheet in edit mode with the goal id + title", async () => {
    useAssignGoalSheet.setState({
      open: false,
      clientId: null,
      editGoal: null,
      onSaved: null,
    });
    const { adapters, api } = makeAdapters();
    api.clientDetails["client-1"] = fullDetail();
    renderWith(adapters);
    await waitFor(() => expect(props().detail).not.toBeNull());
    props().onEditGoal();
    const s = useAssignGoalSheet.getState();
    expect(s.open).toBe(true);
    expect(s.editGoal).toMatchObject({
      goalId: "g-1",
      title: "Squat 1.5x BW",
      targetDate: "2026-09-01",
    });
  });

  it("onOpenProgramme navigates to the programme; no-op when no programme", async () => {
    const { adapters, api } = makeAdapters();
    api.clientDetails["client-1"] = fullDetail();
    api.clientActiveProgrammes["client-1"] = ACTIVE;
    renderWith(adapters);
    await waitFor(() => expect(props().activeProgramme).not.toBeNull());
    props().onOpenProgramme();
    expect(mockPush).toHaveBeenCalledWith("/(app)/programs/p1");
  });

  it("onOpenProgramme is a no-op when there is no active programme", async () => {
    const { adapters, api } = makeAdapters();
    api.clientDetails["client-1"] = fullDetail();
    // no active programme fixture
    renderWith(adapters);
    await waitFor(() => expect(props().detail).not.toBeNull());
    props().onOpenProgramme();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("re-focus (after the first) refreshes the aggregate, trend + programme", async () => {
    const { adapters, api } = makeAdapters();
    api.clientDetails["client-1"] = fullDetail();
    api.clientActiveProgrammes["client-1"] = ACTIVE;
    renderWith(adapters);
    await waitFor(() => expect(props().detail).not.toBeNull());
    const before = api.getClientDetailCalls.length;
    // First focus is a no-op (guard); a second focus triggers the refresh.
    await act(async () => {
      focusCallbacks[0]?.();
    });
    await act(async () => {
      focusCallbacks[0]?.();
    });
    await waitFor(() =>
      expect(api.getClientDetailCalls.length).toBeGreaterThan(before),
    );
  });

  it("onRefresh re-fetches the aggregate, trend + programme", async () => {
    const { adapters, api } = makeAdapters();
    api.clientDetails["client-1"] = fullDetail();
    api.clientActiveProgrammes["client-1"] = ACTIVE;
    renderWith(adapters);
    await waitFor(() => expect(props().detail).not.toBeNull());
    const before = api.getClientDetailCalls.length;
    await act(async () => {
      props().onRefresh();
    });
    await waitFor(() =>
      expect(api.getClientDetailCalls.length).toBeGreaterThan(before),
    );
  });

  it("onAddNote opens the note sheet in create mode; onEditNote in edit mode with the note", async () => {
    useCoachNoteSheet.setState({
      open: false,
      clientId: null,
      editNote: null,
      onSaved: null,
    });
    const { adapters, api } = makeAdapters();
    api.clientDetails["client-1"] = fullDetail({
      notes: [
        {
          id: "note-7",
          noteType: "general",
          title: "",
          content: "Swap heavy squat for leg press.",
          createdAt: "2026-07-01T09:00:00.000Z",
        },
      ],
    });
    renderWith(adapters);
    await waitFor(() => expect(props().detail).not.toBeNull());

    props().onAddNote();
    let s = useCoachNoteSheet.getState();
    expect(s.open).toBe(true);
    expect(s.clientId).toBe("client-1");
    expect(s.editNote).toBeNull(); // create mode

    props().onEditNote(props().detail!.notes[0]);
    s = useCoachNoteSheet.getState();
    expect(s.open).toBe(true);
    expect(s.editNote).toEqual({
      noteId: "note-7",
      content: "Swap heavy squat for leg press.",
    });
  });

  it("onSendBrief opens the Send-brief sheet with the client id + name", async () => {
    useSendBriefSheet.setState({
      open: false,
      clientId: null,
      clientName: null,
    });
    const { adapters, api } = makeAdapters();
    api.clientDetails["client-1"] = fullDetail();
    renderWith(adapters);
    await waitFor(() => expect(props().detail).not.toBeNull());

    props().onSendBrief();
    const s = useSendBriefSheet.getState();
    expect(s.open).toBe(true);
    expect(s.clientId).toBe("client-1");
    expect(s.clientName).toBe("Jordan");
  });

  it("loads the client's open assignments and opens the swap sheet on onSwapWorkout", async () => {
    useSwapWorkoutSheet.setState({
      open: false,
      clientId: null,
      assignmentId: null,
      currentName: null,
      onSwapped: null,
    });
    const { adapters, api } = makeAdapters();
    api.clientDetails["client-1"] = fullDetail();
    api.clientWorkoutAssignments["client-1"] = [
      {
        assignmentId: "wa-1",
        workoutId: "w-1",
        name: "Push Day",
        estimatedDurationMinutes: 45,
        dueDate: "2026-07-12",
        status: "assigned",
        isProgrammeOccurrence: false,
        occurrenceIndex: null,
        isSwapped: false,
      },
    ];
    renderWith(adapters);
    await waitFor(() => expect(props().assignments).toHaveLength(1));

    props().onSwapWorkout(props().assignments[0]);
    const s = useSwapWorkoutSheet.getState();
    expect(s.open).toBe(true);
    expect(s.clientId).toBe("client-1");
    expect(s.assignmentId).toBe("wa-1");
    expect(s.currentName).toBe("Push Day");
  });

  it("onStartSession navigates to the active-session screen with the client ref (M18 Start-live)", async () => {
    mockPush.mockClear();
    const { adapters, api } = makeAdapters();
    api.clientDetails["client-1"] = fullDetail();
    api.clientWorkoutAssignments["client-1"] = [
      {
        assignmentId: "wa-1",
        workoutId: "w-1",
        name: "Push Day",
        estimatedDurationMinutes: 45,
        dueDate: "2026-07-12",
        status: "assigned",
        isProgrammeOccurrence: false,
        occurrenceIndex: null,
        isSwapped: false,
      },
    ];
    renderWith(adapters);
    await waitFor(() => expect(props().assignments).toHaveLength(1));

    props().onStartSession(props().assignments[0]);

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/(app)/session",
      params: {
        workoutId: "w-1",
        clientId: "client-1",
        clientName: "Jordan",
        // fullDetail's client.initials is preferred over the derived fallback.
        clientInitials: expect.any(String),
      },
    });
  });

  it("onAssignProgramme + onAssignWorkout open their sheets", async () => {
    useAssignProgramSheet.setState({
      open: false,
      programId: null,
      clientId: null,
      onAssigned: null,
    });
    useAssignWorkoutSheet.setState({
      open: false,
      clientId: null,
      onAssigned: null,
    });
    const { adapters, api } = makeAdapters();
    api.clientDetails["client-1"] = fullDetail();
    renderWith(adapters);
    await waitFor(() => expect(props().detail).not.toBeNull());
    props().onAssignProgramme();
    props().onAssignWorkout();
    expect(useAssignProgramSheet.getState().clientId).toBe("client-1");
    expect(useAssignWorkoutSheet.getState().clientId).toBe("client-1");
  });
});

describe("ClientDetailContainer — AI summary (Phase 6)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams.id = "client-1";
    mockParams.name = "Jordan";
  });

  it("lazy-fires generate (manual:false) ONCE on open when the concluded day has no cached summary + online", async () => {
    const { adapters, api } = makeAdapters(true);
    api.clientDetails["client-1"] = fullDetail({ aiSummary: NULL_SUMMARY });
    renderWith(adapters);

    await waitFor(() =>
      expect(api.generateClientAiSummaryCalls.length).toBe(1),
    );
    expect(api.generateClientAiSummaryCalls[0]).toEqual({
      clientId: "client-1",
      manual: false,
    });
    // It refreshes the aggregate afterwards so the card can fill from cache.
    await waitFor(() =>
      expect(api.getClientDetailCalls.length).toBeGreaterThan(1),
    );
  });

  it("does NOT lazy-fire when a summary is already cached for the day", async () => {
    const { adapters, api } = makeAdapters(true);
    api.clientDetails["client-1"] = fullDetail({
      aiSummary: {
        summary: "Already generated.",
        coversDate: "2026-07-07",
        generatedAt: "2026-07-08T06:00:00.000Z",
        canManualRefresh: true,
      },
    });
    renderWith(adapters);
    await waitFor(() => expect(props().detail).not.toBeNull());
    // Give any stray effect a tick.
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.generateClientAiSummaryCalls).toHaveLength(0);
  });

  it("does NOT lazy-fire when offline (generation is online-only)", async () => {
    const { adapters, api } = makeAdapters(false);
    api.clientDetails["client-1"] = fullDetail({ aiSummary: NULL_SUMMARY });
    renderWith(adapters);
    await waitFor(() => expect(props().detail).not.toBeNull());
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.generateClientAiSummaryCalls).toHaveLength(0);
    expect(props().online).toBe(false);
  });

  it("onRegenerateSummary posts manual:true then refreshes the aggregate", async () => {
    const { adapters, api } = makeAdapters(true);
    api.clientDetails["client-1"] = fullDetail({
      aiSummary: {
        summary: "Existing summary.",
        coversDate: "2026-07-07",
        generatedAt: "2026-07-08T06:00:00.000Z",
        canManualRefresh: true,
      },
    });
    renderWith(adapters);
    await waitFor(() => expect(props().detail).not.toBeNull());
    const before = api.getClientDetailCalls.length;

    await act(async () => {
      props().onRegenerateSummary();
    });

    await waitFor(() =>
      expect(
        api.generateClientAiSummaryCalls.some((c) => c.manual === true),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(api.getClientDetailCalls.length).toBeGreaterThan(before),
    );
  });
});

describe("ClientDetailContainer — degraded", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams.id = "client-1";
    mockParams.name = "Jordan";
  });

  it("surfaces an aggregate fetch error when there's no cache", async () => {
    const { adapters } = makeAdapters();
    // No fixture configured → the in-memory adapter fails with not_found.
    renderWith(adapters);
    await waitFor(() => expect(props().error).not.toBeNull());
    expect(props().detail).toBeNull();
  });

  it("guards every action when the route has no client id", async () => {
    mockParams.id = undefined;
    const { adapters } = makeAdapters();
    renderWith(adapters);
    await waitFor(() => expect(mockCaptured.props).not.toBeNull());
    const p = props();
    // All id-dependent actions are safe no-ops (no navigation, no sheet open).
    useAssignGoalSheet.setState({
      open: false,
      clientId: null,
      editGoal: null,
      onSaved: null,
    });
    p.onLogWeight();
    p.onManageHabits();
    p.onAssignProgramme();
    p.onAssignWorkout();
    p.onEditTargets();
    p.onAssignGoal();
    p.onEditGoal();
    expect(mockPush).not.toHaveBeenCalled();
    expect(useAssignGoalSheet.getState().open).toBe(false);
  });

  it("still passes a degraded (null-goal) aggregate through", async () => {
    const { adapters, api } = makeAdapters();
    api.clientDetails["client-1"] = fullDetail({
      goal: null,
      calorieHit: null,
      adherence: { overall: null, band: null, categories: [] },
    });
    renderWith(adapters);
    await waitFor(() => expect(props().detail).not.toBeNull());
    expect(props().detail?.goal).toBeNull();
    // onEditGoal is a no-op with no goal — must not open the sheet.
    useAssignGoalSheet.setState({
      open: false,
      clientId: null,
      editGoal: null,
      onSaved: null,
    });
    props().onEditGoal();
    expect(useAssignGoalSheet.getState().open).toBe(false);
  });
});
