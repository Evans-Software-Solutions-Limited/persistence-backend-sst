import { act, render } from "@testing-library/react-native";
import type { CachedResourceState } from "@/ui/hooks/useCachedResource";
import type { TrainerClient } from "@/domain/models/trainerClient";
import type { Streak } from "@/domain/models/streak";
import type { HomePayload } from "@/domain/models/progress";
import type { CoachHomePresenterProps } from "@/ui/presenters/CoachHomePresenter";
import {
  CoachHomeContainer,
  buildDateLabel,
  buildFlaggedClients,
  buildProgrammeAlerts,
  buildTrainYourselfSubtitle,
  PROGRAMME_ALERT_WINDOW_DAYS,
} from "../CoachHomeContainer";

const NOW = new Date("2026-03-25T09:00:00.000Z").getTime();

function client(overrides: Partial<TrainerClient>): TrainerClient {
  return {
    id: "c-x",
    name: "Client X",
    initials: "CX",
    avatarUrl: null,
    status: "active",
    programLabel: null,
    programEndDate: null,
    adherence: 90,
    band: "strong",
    lastSeenAt: null,
    flags: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure view-model builders (exported for testing).
// ---------------------------------------------------------------------------

describe("buildDateLabel", () => {
  it("formats the header eyebrow as WEEKDAY · MON D (viewer-local)", () => {
    const d = new Date(2026, 2, 25); // 2026-03-25, a Wednesday, local
    expect(buildDateLabel(d)).toBe("WEDNESDAY · MAR 25");
  });
});

describe("buildFlaggedClients", () => {
  it("keeps at-risk/crisis bands and any flagged client, drops the healthy", () => {
    const roster = [
      client({ id: "crisis", band: "crisis", flags: [] }),
      client({ id: "atrisk", band: "atRisk", flags: [] }),
      client({
        id: "wobbling-flag",
        band: "wobbling",
        flags: [{ tone: "gold", label: "NEW PR" }],
      }),
      client({ id: "healthy", band: "strong", flags: [] }),
      client({ id: "stellar", band: "stellar", flags: [] }),
    ];
    const ids = buildFlaggedClients(roster).map((f) => f.clientId);
    expect(ids).toEqual(["crisis", "atrisk", "wobbling-flag"]);
  });

  it("composes the subtitle from flags + programLabel and maps the tone", () => {
    const [vm] = buildFlaggedClients([
      client({
        id: "tom",
        band: "crisis",
        programLabel: "Cut · Wk 6 / 8",
        flags: [{ tone: "error", label: "4d IDLE" }],
      }),
    ]);
    expect(vm.sub).toBe("4d IDLE · Cut · Wk 6 / 8");
    expect(vm.tone).toBe("error");
  });

  it("falls back to a band phrase + band tone for a flagless at-risk/crisis client", () => {
    expect(
      buildFlaggedClients([client({ band: "crisis", flags: [] })])[0].sub,
    ).toBe("Needs attention");
    const atRisk = buildFlaggedClients([
      client({ band: "atRisk", flags: [] }),
    ])[0];
    expect(atRisk.sub).toBe("At risk");
    expect(atRisk.tone).toBe("ember");
  });

  it("caps the list at four (roster arrives worst-first)", () => {
    const roster = Array.from({ length: 6 }, (_, i) =>
      client({ id: `c${i}`, band: "crisis" }),
    );
    expect(buildFlaggedClients(roster)).toHaveLength(4);
  });
});

describe("buildProgrammeAlerts", () => {
  const iso = (days: number) =>
    new Date(NOW + days * 24 * 60 * 60 * 1000).toISOString();

  it("includes only programmes ending within the window, soonest first", () => {
    const roster = [
      client({ id: "far", programLabel: "A · Wk 1", programEndDate: iso(30) }),
      client({ id: "soon", programLabel: "B · Wk 7", programEndDate: iso(3) }),
      client({ id: "mid", programLabel: "C · Wk 4", programEndDate: iso(12) }),
      client({ id: "past", programLabel: "D", programEndDate: iso(-2) }),
      client({ id: "none", programLabel: null, programEndDate: null }),
    ];
    expect(buildProgrammeAlerts(roster, NOW).map((a) => a.clientId)).toEqual([
      "soon",
      "mid",
    ]);
  });

  it("uses the programme name, ember within a week, trainer beyond", () => {
    const alerts = buildProgrammeAlerts(
      [
        client({
          id: "urgent",
          programLabel: "Hypertrophy · Wk 8",
          programEndDate: iso(3),
        }),
        client({
          id: "later",
          programLabel: "Strength · Wk 4",
          programEndDate: iso(12),
        }),
      ],
      NOW,
    );
    expect(alerts[0]).toMatchObject({
      client: "Client X",
      text: "Hypertrophy ends in 3 days",
      tone: "ember",
    });
    expect(alerts[1]).toMatchObject({
      text: "Strength ends in 2 weeks",
      tone: "trainer",
    });
  });

  it("phrases near-term windows and tolerates a missing programEndDate", () => {
    expect(
      buildProgrammeAlerts([client({ programEndDate: iso(0) })], NOW)[0].text,
    ).toBe("Programme ends today");
    expect(
      buildProgrammeAlerts([client({ programEndDate: iso(1) })], NOW)[0].text,
    ).toBe("Programme ends tomorrow");
    const stale = client({});
    // @ts-expect-error simulate a payload cached before programEndDate existed
    delete stale.programEndDate;
    expect(buildProgrammeAlerts([stale], NOW)).toHaveLength(0);
  });

  it("falls back to a generic 'Programme' name when the label has no name segment", () => {
    const text = buildProgrammeAlerts(
      [client({ programLabel: " · Wk 1 / 8", programEndDate: iso(10) })],
      NOW,
    )[0].text;
    expect(text).toBe("Programme ends in 1 week");
  });

  it("exposes the window as 14 days", () => {
    expect(PROGRAMME_ALERT_WINDOW_DAYS).toBe(14);
  });
});

describe("buildTrainYourselfSubtitle", () => {
  it("elides the streak and queued segments when absent", () => {
    expect(buildTrainYourselfSubtitle(0, "day", null)).toBe(
      "Switch to athlete view",
    );
  });
  it("includes a day streak and queued workout when present", () => {
    expect(buildTrainYourselfSubtitle(23, "day", "Upper Body")).toBe(
      "Switch to athlete view · 23-day streak · Upper Body queued",
    );
  });
  it("uses the weekly unit for weekly streaks", () => {
    expect(buildTrainYourselfSubtitle(4, "week", null)).toBe(
      "Switch to athlete view · 4-week streak",
    );
  });
});

// ---------------------------------------------------------------------------
// Container integration — hooks mocked, presenter probed.
// ---------------------------------------------------------------------------

const mockPush = jest.fn();
const mockNavigate = jest.fn();
const mockSwitchMode = jest.fn();
const mockOpenDrawer = jest.fn();
const mockOpenSheet = jest.fn();
const mockRefreshClients = jest.fn(async () => {});
const mockProbe: { last: CoachHomePresenterProps | null } = { last: null };

let mockClientsState: CachedResourceState<TrainerClient[]>;
let mockStreaksState: CachedResourceState<Streak[]>;
let mockHomeState: CachedResourceState<HomePayload>;
let mockProfileFullName: string | null;

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, navigate: mockNavigate }),
}));
jest.mock("@/ui/hooks/useModeSwitch", () => ({
  useModeSwitch: () => ({ switchMode: mockSwitchMode }),
}));
jest.mock("@/ui/hooks/useAuth", () => ({
  useAuth: () => ({ session: { userId: "t-1", email: "coach@example.com" } }),
}));
jest.mock("@/ui/hooks/useGetTrainerClients", () => ({
  useGetTrainerClients: () => mockClientsState,
}));
jest.mock("@/ui/hooks/useGetStreaks", () => ({
  useGetStreaks: () => mockStreaksState,
}));
jest.mock("@/ui/hooks/useGetHome", () => ({
  useGetHome: () => mockHomeState,
}));
jest.mock("@/ui/hooks/useProfilePage", () => ({
  useProfilePage: () => ({
    payload: { profile: { fullName: mockProfileFullName } },
  }),
}));
jest.mock("@/state/drawer", () => ({
  useDrawer: (sel: (s: { openDrawer: () => void }) => unknown) =>
    sel({ openDrawer: mockOpenDrawer }),
}));
jest.mock("@/state/add-client-sheet", () => ({
  useAddClientSheet: (
    sel: (s: { openSheet: (cb: () => void) => void }) => unknown,
  ) => sel({ openSheet: mockOpenSheet }),
}));
jest.mock("@/ui/presenters/CoachHomePresenter", () => ({
  CoachHomePresenter: (props: CoachHomePresenterProps) => {
    mockProbe.last = props;
    return null;
  },
}));

function cached<T>(
  over: Partial<CachedResourceState<T>>,
): CachedResourceState<T> {
  return {
    data: null,
    isStale: false,
    isRefreshing: false,
    error: null,
    refresh: jest.fn(async () => {}),
    reload: jest.fn(),
    ...over,
  } as CachedResourceState<T>;
}

describe("CoachHomeContainer", () => {
  beforeEach(() => {
    mockProbe.last = null;
    mockPush.mockClear();
    mockNavigate.mockClear();
    mockSwitchMode.mockClear();
    mockOpenDrawer.mockClear();
    mockOpenSheet.mockClear();
    mockRefreshClients.mockClear();
    mockProfileFullName = "Bradley Evans";
    mockClientsState = cached<TrainerClient[]>({
      data: [
        client({
          id: "c-tom",
          name: "Tom Hayward",
          band: "crisis",
          flags: [{ tone: "error", label: "4d IDLE" }],
        }),
        client({ id: "c-ok", name: "Ok Client", band: "strong", flags: [] }),
      ],
      refresh: mockRefreshClients,
    });
    mockStreaksState = cached<Streak[]>({
      data: [
        {
          id: "s1",
          userId: "t-1",
          streakType: "workout_streak",
          sourceGoalId: null,
          period: "daily",
          currentCount: 12,
          longestCount: 30,
          lastPeriodEnd: "2026-03-24",
          freezeTokens: 0,
          status: "active",
        },
      ],
    });
    mockHomeState = cached<HomePayload>({
      data: {
        rings: {} as HomePayload["rings"],
        micro: {} as HomePayload["micro"],
        weeklyVolume: {} as HomePayload["weeklyVolume"],
        recentPRs: [],
        habits: [],
        todayWorkout: [],
        activeProgramme: null,
        todaysTraining: [
          {
            assignmentId: null,
            workoutId: "w1",
            name: "Upper Body",
            estimatedDurationMinutes: 45,
            dueDate: null,
            assignedByType: null,
          },
        ],
      },
    });
  });

  it("derives the view-models from the roster, streaks, and home hooks", () => {
    render(<CoachHomeContainer />);
    expect(mockProbe.last).not.toBeNull();
    expect(mockProbe.last?.initials).toBe("BE");
    expect(mockProbe.last?.hasClients).toBe(true);
    expect(mockProbe.last?.flaggedClients.map((f) => f.clientId)).toEqual([
      "c-tom",
    ]);
    expect(mockProbe.last?.trainYourselfSubtitle).toBe(
      "Switch to athlete view · 12-day streak · Upper Body queued",
    );
    expect(typeof mockProbe.last?.greeting).toBe("string");
    expect(mockProbe.last?.greeting.length).toBeGreaterThan(0);
  });

  it("falls back to email initials when the profile has no name", () => {
    mockProfileFullName = null;
    render(<CoachHomeContainer />);
    expect(mockProbe.last?.initials).toBe("C"); // coach@example.com
  });

  it("derives the queued workout from the active programme when no session is due today", () => {
    mockHomeState = cached<HomePayload>({
      data: {
        rings: {} as HomePayload["rings"],
        micro: {} as HomePayload["micro"],
        weeklyVolume: {} as HomePayload["weeklyVolume"],
        recentPRs: [],
        habits: [],
        todayWorkout: [],
        activeProgramme: {
          assignmentId: "a1",
          programId: "p1",
          name: "Push Split",
          week: 2,
          totalWeeks: 8,
          endDate: null,
          startDate: "2026-03-01",
        },
        todaysTraining: [],
      },
    });
    render(<CoachHomeContainer />);
    expect(mockProbe.last?.trainYourselfSubtitle).toContain(
      "Push Split queued",
    );
  });

  it("reports hasClients=false for an empty roster", () => {
    mockClientsState = cached<TrainerClient[]>({ data: [] });
    render(<CoachHomeContainer />);
    expect(mockProbe.last?.hasClients).toBe(false);
    expect(mockProbe.last?.flaggedClients).toEqual([]);
  });

  it("shows the loader while the roster loads with no cache", () => {
    mockClientsState = cached<TrainerClient[]>({
      data: null,
      isRefreshing: true,
    });
    render(<CoachHomeContainer />);
    expect(mockProbe.last?.isLoading).toBe(true);
  });

  it("surfaces the roster error", () => {
    mockClientsState = cached<TrainerClient[]>({
      data: null,
      error: { kind: "network", message: "offline" } as never,
    });
    render(<CoachHomeContainer />);
    expect(mockProbe.last?.isLoading).toBe(false);
    expect(mockProbe.last?.error).not.toBeNull();
  });

  it("routes every navigation + action callback correctly", () => {
    render(<CoachHomeContainer />);
    act(() => mockProbe.last?.onOpenClient("c-tom"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/clients/c-tom");

    act(() => mockProbe.last?.onOpenClients());
    expect(mockNavigate).toHaveBeenCalledWith("/(app)/(tabs)/clients");

    act(() => mockProbe.last?.onOpenNotifications());
    expect(mockPush).toHaveBeenCalledWith("/(app)/notifications");

    act(() => mockProbe.last?.onTrainYourself());
    expect(mockSwitchMode).toHaveBeenCalledWith("athlete", "index");

    act(() => mockProbe.last?.onOpenDrawer());
    expect(mockOpenDrawer).toHaveBeenCalledTimes(1);

    act(() => mockProbe.last?.onInviteClient());
    expect(mockOpenSheet).toHaveBeenCalledTimes(1);
  });

  it("invite registers a roster refresh callback", () => {
    render(<CoachHomeContainer />);
    act(() => mockProbe.last?.onInviteClient());
    const cb = mockOpenSheet.mock.calls[0][0] as () => void;
    cb();
    expect(mockRefreshClients).toHaveBeenCalledTimes(1);
  });

  it("onRefresh re-pulls the roster", async () => {
    render(<CoachHomeContainer />);
    await act(async () => {
      await mockProbe.last?.onRefresh();
    });
    expect(mockRefreshClients).toHaveBeenCalled();
  });
});
