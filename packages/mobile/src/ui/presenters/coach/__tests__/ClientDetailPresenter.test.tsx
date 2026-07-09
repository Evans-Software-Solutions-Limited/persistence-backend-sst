import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import {
  ClientDetailPresenter,
  type ClientDetailProps,
} from "../ClientDetailPresenter";
import type { ClientDetail } from "@/domain/models/clientDetail";
import type { ActiveProgramme } from "@/domain/models/progress";

const PROGRAMME: ActiveProgramme = {
  assignmentId: "a-1",
  programId: "p-1",
  name: "Hypertrophy 8wk",
  week: 2,
  totalWeeks: 8,
  endDate: null,
  startDate: "2026-06-01",
};

function fullDetail(over: Partial<ClientDetail> = {}): ClientDetail {
  return {
    client: {
      id: "c-1",
      name: "Marcus Reid",
      initials: "MR",
      avatarUrl: null,
      status: "active",
      ageYears: 32,
      heightCm: 178,
    },
    adherence: {
      overall: 64,
      band: "atRisk",
      categories: [
        {
          label: "Workouts completed",
          pct: 64,
          sub: "Last 28 days",
          available: true,
        },
        {
          label: "Calorie target",
          pct: 76,
          sub: "Days within ±10% this week",
          available: true,
        },
        {
          label: "Protein target",
          pct: null,
          sub: "Available with Fuel",
          available: false,
        },
        {
          label: "Check-ins",
          pct: null,
          sub: "Available with habits",
          available: false,
        },
        {
          label: "Sleep",
          pct: null,
          sub: "Available with Health",
          available: false,
        },
      ],
    },
    prs: [],
    volume: {
      weekKg: 14200,
      daily: [
        { date: "2026-07-06", volumeKg: 4000 },
        { date: "2026-07-07", volumeKg: 0 },
        { date: "2026-07-08", volumeKg: 6000 },
      ],
    },
    calorieHit: {
      targetKcal: 2400,
      daysHit: 5,
      daysLogged: 7,
      todayKcal: 1800,
      todayRemainingKcal: 600,
    },
    goal: {
      id: "g-1",
      title: "Add 4 kg lean mass",
      unit: "kg",
      targetDate: "2026-10-01",
      assignedByCoach: true,
      weight: { startKg: 76.1, nowKg: 78.2, targetKg: 80 },
      pct: 0.42,
    },
    habits: null,
    aiSummary: {
      summary: null,
      coversDate: null,
      generatedAt: null,
      canManualRefresh: false,
    },
    thisWeek: {
      workoutsCompleted: 4,
      workoutsPlanned: 5,
      volumeKg: 14200,
      prs: 1,
      checkIns: 6,
    },
    recentSessions: [],
    notes: [
      {
        id: "n-1",
        noteType: "general",
        title: "",
        content: "Knee felt off Tuesday — swap heavy squat for leg press.",
        createdAt: "2026-07-01T09:00:00.000Z",
      },
    ],
    ...over,
  };
}

function render(over: Partial<ClientDetailProps> = {}) {
  const props: ClientDetailProps = {
    detail: fullDetail(),
    clientName: "Marcus Reid",
    bodyTrend: {
      weight: { current: 78.2, delta: -0.8, series: [79, 78.2], unit: "kg" },
      bodyFat: { current: 20.4, delta: -0.6, series: [21, 20.4] },
    },
    activeProgramme: PROGRAMME,
    isLoading: false,
    isRefreshing: false,
    error: null,
    onRefresh: jest.fn(),
    onBack: jest.fn(),
    onLogWeight: jest.fn(),
    onManageHabits: jest.fn(),
    onAssignWorkout: jest.fn(),
    onEditTargets: jest.fn(),
    onAssignGoal: jest.fn(),
    onEditGoal: jest.fn(),
    onOpenProgramme: jest.fn(),
    onAssignProgramme: jest.fn(),
    onAddNote: jest.fn(),
    onEditNote: jest.fn(),
    isGeneratingSummary: false,
    online: true,
    onRegenerateSummary: jest.fn(),
    ...over,
  };
  return { props, ...renderWithTheme(<ClientDetailPresenter {...props} />) };
}

const EMPTY_TREND: ClientDetailProps["bodyTrend"] = {
  weight: { current: null, delta: 0, series: [], unit: "kg" },
  bodyFat: { current: null, delta: 0, series: [] },
};

describe("ClientDetailPresenter — loader / error", () => {
  it("shows the loader when loading with no data", () => {
    const { getByTestId } = render({ detail: null, isLoading: true });
    expect(getByTestId("client-detail-loader")).toBeTruthy();
  });

  it("shows the error state when errored with no data", () => {
    const { getByTestId, props } = render({
      detail: null,
      isLoading: false,
      error: { kind: "api", code: "server", message: "boom" },
    });
    const errorState = getByTestId("client-detail-error-state");
    expect(errorState).toBeTruthy();
    fireEvent(errorState, "layout");
    expect(props.onRefresh).toBeDefined();
  });
});

describe("ClientDetailPresenter — header", () => {
  it("renders name, meta (age · height · programme), and pills", () => {
    const { getByTestId, getByText } = render();
    expect(getByTestId("client-detail-name")).toBeTruthy();
    expect(getByText("Marcus Reid")).toBeTruthy();
    expect(getByText("Age 32 · 178 cm · Hypertrophy 8wk")).toBeTruthy();
    expect(getByTestId("client-detail-week-pill")).toBeTruthy();
    // 5 planned − 4 completed = 1 missed.
    expect(getByTestId("client-detail-missed-pill")).toBeTruthy();
  });

  it("hides null meta segments", () => {
    const detail = fullDetail();
    detail.client.ageYears = null;
    detail.client.heightCm = null;
    const { getByTestId, getAllByText } = render({
      detail,
      activeProgramme: PROGRAMME,
    });
    // Meta shows only the programme (age/height dropped); the name also
    // appears in the LiveSessionCTA + ProgrammeCard, so assert via the meta
    // node's text directly.
    expect(getByTestId("client-detail-meta").children.join("")).toBe(
      "Hypertrophy 8wk",
    );
    expect(getAllByText("Hypertrophy 8wk").length).toBeGreaterThanOrEqual(1);
  });

  it("fires onBack", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("client-detail-back"));
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});

describe("ClientDetailPresenter — LiveSessionCTA (display-only)", () => {
  it("shows the current programme + week when a programme is active", () => {
    const { getByTestId, getByText } = render();
    expect(getByTestId("client-detail-live-session-workout")).toBeTruthy();
    expect(getByText("Week 2 of 8")).toBeTruthy();
  });

  it("shows the empty state when no programme", () => {
    const { getByTestId } = render({ activeProgramme: null });
    expect(getByTestId("client-detail-live-session-empty")).toBeTruthy();
  });
});

describe("ClientDetailPresenter — QuickActionsRow", () => {
  it("wires Assign / Macros / Goals (Schedule hidden)", () => {
    const { getByTestId, queryByTestId, props } = render();
    fireEvent.press(getByTestId("quick-action-assign"));
    fireEvent.press(getByTestId("quick-action-macros"));
    fireEvent.press(getByTestId("quick-action-goals"));
    expect(props.onAssignWorkout).toHaveBeenCalled();
    expect(props.onEditTargets).toHaveBeenCalled();
    expect(props.onAssignGoal).toHaveBeenCalled();
    expect(queryByTestId("quick-action-schedule")).toBeNull();
  });
});

describe("ClientDetailPresenter — AISummaryCard", () => {
  const withSummary = (over: Partial<ClientDetail["aiSummary"]> = {}) =>
    fullDetail({
      aiSummary: {
        summary: "Solid week — hit calories 5/7 days. Focus: sleep.",
        coversDate: "2026-07-07",
        generatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        canManualRefresh: true,
        ...over,
      },
    });

  it("empty state (no cached summary, online) — no Regenerate button yet", () => {
    const { getByTestId, queryByTestId } = render();
    expect(getByTestId("client-detail-ai-summary-empty")).toBeTruthy();
    // Nothing to regenerate until a summary exists.
    expect(queryByTestId("client-detail-ai-regenerate")).toBeNull();
  });

  it("offline empty state prompts to connect", () => {
    const { getByTestId } = render({ online: false });
    expect(
      getByTestId("client-detail-ai-summary-empty").props.children,
    ).toContain("Connect to the internet");
  });

  it("generating state shows the spinner copy", () => {
    const { getByTestId, queryByTestId } = render({
      isGeneratingSummary: true,
    });
    expect(getByTestId("client-detail-ai-summary-generating")).toBeTruthy();
    expect(queryByTestId("client-detail-ai-summary-empty")).toBeNull();
  });

  it("loaded state renders the summary text + 'Updated …' + an enabled Regenerate", () => {
    const { getByTestId, props } = render({ detail: withSummary() });
    expect(
      getByTestId("client-detail-ai-summary-text").props.children,
    ).toContain("Solid week");
    expect(getByTestId("client-detail-ai-summary-updated")).toBeTruthy();
    const btn = getByTestId("client-detail-ai-regenerate");
    expect(btn.props.accessibilityState).toMatchObject({ disabled: false });
    fireEvent.press(btn);
    expect(props.onRegenerateSummary).toHaveBeenCalledTimes(1);
  });

  it("loaded + refresh spent → Regenerate disabled, reads 'Next update tomorrow'", () => {
    const { getByTestId, getByText } = render({
      detail: withSummary({ canManualRefresh: false }),
    });
    expect(
      getByTestId("client-detail-ai-regenerate").props.accessibilityState,
    ).toMatchObject({ disabled: true });
    expect(getByText("Next update tomorrow")).toBeTruthy();
  });

  it("loaded but offline → Regenerate disabled even if the server would allow it", () => {
    const { getByTestId } = render({
      detail: withSummary({ canManualRefresh: true }),
      online: false,
    });
    expect(
      getByTestId("client-detail-ai-regenerate").props.accessibilityState,
    ).toMatchObject({ disabled: true });
  });
});

describe("ClientDetailPresenter — GoalCard", () => {
  it("renders the goal with coach attribution + edit pencil when assignedByCoach", () => {
    const { getByTestId, getByText, props } = render();
    expect(getByText("Add 4 kg lean mass")).toBeTruthy();
    expect(getByTestId("client-detail-goal-attribution")).toBeTruthy();
    fireEvent.press(getByTestId("client-detail-goal-edit"));
    expect(props.onEditGoal).toHaveBeenCalledTimes(1);
  });

  it("hides the edit pencil + attribution for a self-set goal", () => {
    const detail = fullDetail();
    detail.goal = { ...detail.goal!, assignedByCoach: false };
    const { queryByTestId } = render({ detail });
    expect(queryByTestId("client-detail-goal-edit")).toBeNull();
    expect(queryByTestId("client-detail-goal-attribution")).toBeNull();
  });

  it("is hidden entirely when there is no goal", () => {
    const { queryByTestId } = render({ detail: fullDetail({ goal: null }) });
    expect(queryByTestId("client-detail-goal")).toBeNull();
  });
});

describe("ClientDetailPresenter — Body trend (kept from #146)", () => {
  it("renders the trend + Log-weight CTA", () => {
    const { getByTestId, props } = render();
    expect(getByTestId("client-detail-body-trend")).toBeTruthy();
    fireEvent.press(getByTestId("client-detail-log-weight"));
    expect(props.onLogWeight).toHaveBeenCalledTimes(1);
  });

  it("shows the empty hint when no measurements", () => {
    const { getByTestId } = render({ bodyTrend: EMPTY_TREND });
    expect(getByTestId("client-detail-body-empty")).toBeTruthy();
  });
});

describe("ClientDetailPresenter — TargetsCard", () => {
  it("renders the calorie target + '—' for unmapped fields, edit fires onEditTargets", () => {
    const { getByTestId, getAllByText, props } = render();
    expect(getByTestId("client-detail-targets")).toBeTruthy();
    // Protein/Workouts/Volume are unmapped → em-dash.
    expect(getAllByText("—").length).toBeGreaterThanOrEqual(3);
    fireEvent.press(getByTestId("client-detail-targets-edit"));
    expect(props.onEditTargets).toHaveBeenCalledTimes(1);
  });

  it("shows '—' for calories when no target set", () => {
    const { getByTestId } = render({
      detail: fullDetail({ calorieHit: null }),
    });
    expect(getByTestId("client-detail-target-calories")).toBeTruthy();
  });
});

describe("ClientDetailPresenter — ThisWeekCard", () => {
  it("renders mini-stats + daily bars", () => {
    const { getByTestId, getByText } = render();
    expect(getByTestId("client-detail-this-week")).toBeTruthy();
    expect(getByText("4/5")).toBeTruthy();
    expect(getByTestId("client-detail-daily-bars")).toBeTruthy();
  });

  it("shows '—' nulls when thisWeek is degraded", () => {
    const { getByText } = render({
      detail: fullDetail({
        thisWeek: {
          workoutsCompleted: 0,
          workoutsPlanned: null,
          volumeKg: null,
          prs: 0,
          checkIns: null,
        },
        volume: { weekKg: null, daily: [] },
      }),
    });
    // volume + check-ins render "—"; daily-bars shows the empty caption.
    expect(getByText("No sessions logged this week yet.")).toBeTruthy();
  });
});

describe("ClientDetailPresenter — AdherenceBreakdown", () => {
  it("renders overall + band + lit/available categories", () => {
    const { getByTestId } = render();
    expect(getByTestId("client-detail-adherence-overall")).toBeTruthy();
    expect(
      getByTestId("client-detail-adherence-cat-workouts-completed"),
    ).toBeTruthy();
    expect(
      getByTestId("client-detail-adherence-cat-calorie-target"),
    ).toBeTruthy();
  });

  it("shows the 'Not enough data yet' empty state for a brand-new client", () => {
    const { getByTestId } = render({
      detail: fullDetail({
        adherence: { overall: null, band: null, categories: [] },
      }),
    });
    expect(getByTestId("client-detail-adherence-empty")).toBeTruthy();
  });
});

describe("ClientDetailPresenter — ProgrammeCard + habits entry", () => {
  it("renders the programme card + assign-workout when a programme is active", () => {
    const { getByTestId, props } = render();
    expect(getByTestId("client-detail-programme-card")).toBeTruthy();
    fireEvent.press(getByTestId("client-detail-programme-card-pressable"));
    expect(props.onOpenProgramme).toHaveBeenCalledTimes(1);
  });

  it("shows assign CTAs when no programme", () => {
    const { getByTestId, props } = render({ activeProgramme: null });
    fireEvent.press(getByTestId("client-detail-assign-programme"));
    expect(props.onAssignProgramme).toHaveBeenCalledTimes(1);
  });

  it("keeps the Manage habits entry", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("client-detail-manage-habits"));
    expect(props.onManageHabits).toHaveBeenCalledTimes(1);
  });
});

describe("ClientDetailPresenter — CoachNotesCard", () => {
  it("renders the notes list + an ENABLED add button that fires onAddNote", () => {
    const { getByTestId, props } = render();
    expect(getByTestId("client-detail-note-n-1")).toBeTruthy();
    const add = getByTestId("client-detail-notes-add");
    expect(add.props.accessibilityState).toMatchObject({ disabled: false });
    fireEvent.press(add);
    expect(props.onAddNote).toHaveBeenCalledTimes(1);
  });

  it("tapping a note fires onEditNote with that note", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("client-detail-note-n-1"));
    expect(props.onEditNote).toHaveBeenCalledTimes(1);
    expect(props.onEditNote).toHaveBeenCalledWith(
      expect.objectContaining({ id: "n-1" }),
    );
  });

  it("shows the empty state with no notes", () => {
    const { getByTestId } = render({ detail: fullDetail({ notes: [] }) });
    expect(getByTestId("client-detail-notes-empty")).toBeTruthy();
  });
});

describe("ClientDetailPresenter — helper edge cases", () => {
  it("falls back to route-param initials before the aggregate lands", () => {
    const { getByTestId } = render({ detail: null, clientName: "Sky" });
    // Loader shows when isLoading — but here isLoading=false + detail=null,
    // so the header renders with the fallback name.
    expect(getByTestId("client-detail-name")).toBeTruthy();
  });

  it("handles NaN note dates + NaN daily-bar dates without crashing", () => {
    const detail = fullDetail({
      notes: [
        {
          id: "n-bad",
          noteType: "general",
          title: "Kept",
          content: "body",
          createdAt: "not-a-date",
        },
      ],
      volume: {
        weekKg: 100,
        daily: [{ date: "not-a-date", volumeKg: 100 }],
      },
    });
    const { getByTestId } = render({ detail });
    expect(getByTestId("client-detail-note-n-bad")).toBeTruthy();
    expect(getByTestId("client-detail-daily-bars")).toBeTruthy();
  });

  it("renders a single-word client name (initials fallback path)", () => {
    const { getByText } = render({ detail: null, clientName: "Cher" });
    expect(getByText("Cher")).toBeTruthy();
  });

  it("hides the missed pill when planned == completed (missed 0)", () => {
    const detail = fullDetail({
      thisWeek: {
        workoutsCompleted: 5,
        workoutsPlanned: 5,
        volumeKg: 14200,
        prs: 1,
        checkIns: 6,
      },
    });
    const { queryByTestId } = render({ detail });
    expect(queryByTestId("client-detail-missed-pill")).toBeNull();
  });

  it("hides the missed + week pills entirely when there's no programme / plan", () => {
    const detail = fullDetail({
      thisWeek: {
        workoutsCompleted: 2,
        workoutsPlanned: null,
        volumeKg: null,
        prs: 0,
        checkIns: null,
      },
    });
    const { queryByTestId } = render({ detail, activeProgramme: null });
    expect(queryByTestId("client-detail-missed-pill")).toBeNull();
    expect(queryByTestId("client-detail-week-pill")).toBeNull();
  });

  it("renders a goal weight axis with a null unit (defaults to kg) + no pct bar", () => {
    const detail = fullDetail({
      goal: {
        id: "g-2",
        title: "Maintain",
        unit: null,
        targetDate: null,
        assignedByCoach: false,
        weight: { startKg: null, nowKg: null, targetKg: null },
        pct: null,
      },
    });
    const { getByTestId, queryByTestId } = render({ detail });
    expect(getByTestId("client-detail-goal-title")).toBeTruthy();
    // pct null → no progress bar.
    expect(queryByTestId("client-detail-goal-bar")).toBeNull();
  });

  it("hides the header week pill + shows 'Week 2' in the CTA when totalWeeks is null", () => {
    const { queryByTestId, getByText } = render({
      activeProgramme: { ...PROGRAMME, totalWeeks: null },
    });
    // Week pill needs both week + totalWeeks; hidden here.
    expect(queryByTestId("client-detail-week-pill")).toBeNull();
    // LiveSessionCTA falls back to "Week N" without the total.
    expect(getByText("Week 2")).toBeTruthy();
  });
});
