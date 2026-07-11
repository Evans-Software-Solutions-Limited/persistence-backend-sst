import { fireEvent, renderWithTheme } from "../../../../__tests__/test-utils";
import { CoachHomePresenter } from "../CoachHomePresenter";
import type { FlaggedClientVM } from "../coach/FlaggedClientsPresenter";
import type { ProgrammeAlertVM } from "../coach/ProgrammeAlertsPresenter";
import {
  ScheduleHeroPresenter,
  type ScheduleItemVM,
} from "../coach/ScheduleHeroPresenter";

const FLAGGED: FlaggedClientVM[] = [
  {
    clientId: "c-tom",
    name: "Tom Hayward",
    initials: "TH",
    sub: "4d IDLE · Cut wk 6",
    tone: "error",
  },
  {
    clientId: "c-priya",
    name: "Priya Shah",
    initials: "PS",
    sub: "NEW PR · Mobility wk 1",
    tone: "gold",
  },
  {
    clientId: "c-sam",
    name: "Sam Coach",
    initials: "SC",
    sub: "At risk",
    tone: "trainer",
  },
];

const ALERTS: ProgrammeAlertVM[] = [
  {
    clientId: "c-aisha",
    client: "Aisha Williams",
    text: "Strength ends in 2 weeks",
    tone: "trainer",
  },
  {
    clientId: "c-emma",
    client: "Emma Chen",
    text: "Hypertrophy ends in 3 days",
    tone: "ember",
  },
];

const SCHEDULE: ScheduleItemVM[] = [
  {
    start: "08:30",
    end: "09:00",
    clientId: "s-emma",
    name: "Emma Chen",
    initials: "EC",
    kind: "check-in",
    tone: "primary",
    mode: "Video call",
    soon: true,
  },
  {
    start: "11:00",
    end: "12:00",
    clientId: "s-marcus",
    name: "Marcus Reid",
    initials: "MR",
    kind: "session",
    tone: "trainer",
    mode: "In-person · Studio A",
  },
  {
    start: "17:00",
    end: "17:30",
    clientId: "s-priya",
    name: "Priya Shah",
    initials: "PS",
    kind: "review",
    tone: "gold",
    mode: "Programme review · Async",
  },
];

function baseProps() {
  return {
    dateLabel: "MONDAY · MAR 25",
    greeting: "Good morning",
    initials: "BE",
    hasClients: true,
    flaggedClients: FLAGGED,
    programmeAlerts: ALERTS,
    trainYourselfSubtitle:
      "Switch to athlete view · 23-day streak · Upper Body queued",
    isLoading: false,
    isRefreshing: false,
    error: null,
    onRefresh: jest.fn(),
    onOpenDrawer: jest.fn(),
    onOpenNotifications: jest.fn(),
    onOpenClient: jest.fn(),
    onOpenClients: jest.fn(),
    onTrainYourself: jest.fn(),
    onInviteClient: jest.fn(),
  };
}

describe("CoachHomePresenter", () => {
  it("renders the header, all four blocks, and the deferred hero is absent by default", () => {
    const { getByText, getByTestId, queryByTestId } = renderWithTheme(
      <CoachHomePresenter {...baseProps()} />,
    );

    // Header (greeting is split "Good morning, " + accented "Coach").
    expect(getByText("MONDAY · MAR 25")).toBeTruthy();
    expect(getByText("Coach")).toBeTruthy();
    expect(getByTestId("coach-home-bell")).toBeTruthy();
    expect(getByTestId("coach-home-avatar")).toBeTruthy();

    // Needs-you-today + programme alerts + train-yourself.
    expect(getByText("3 flagged")).toBeTruthy();
    expect(getByText("Tom Hayward")).toBeTruthy();
    expect(getByText("Aisha Williams")).toBeTruthy();
    expect(getByTestId("coach-home-train")).toBeTruthy();

    // Deferred schedule hero: NOT rendered when no schedule is passed (v1).
    expect(queryByTestId("coach-home-schedule")).toBeNull();
  });

  it("renders the schedule hero when a (future) appointments schedule is supplied", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <CoachHomePresenter
        {...baseProps()}
        schedule={SCHEDULE}
        onOpenAppointment={jest.fn()}
      />,
    );
    expect(getByTestId("coach-home-schedule")).toBeTruthy();
    expect(getByText("Today's Schedule")).toBeTruthy();
    expect(getByText("SESSION")).toBeTruthy();
    expect(getByText("CHECK-IN")).toBeTruthy();
    expect(getByText("REVIEW")).toBeTruthy();
  });

  it("tolerates a schedule with no appointment handler (row tap is a no-op)", () => {
    const { getByTestId } = renderWithTheme(
      <CoachHomePresenter {...baseProps()} schedule={SCHEDULE} />,
    );
    // No onOpenAppointment passed → falls back to an internal no-op; must not throw.
    expect(() =>
      fireEvent.press(getByTestId("coach-home-schedule-s-marcus")),
    ).not.toThrow();
  });

  it("routes schedule-row taps to the appointment handler", () => {
    const onOpenAppointment = jest.fn();
    const { getByTestId } = renderWithTheme(
      <CoachHomePresenter
        {...baseProps()}
        schedule={SCHEDULE}
        onOpenAppointment={onOpenAppointment}
      />,
    );
    fireEvent.press(getByTestId("coach-home-schedule-s-marcus"));
    expect(onOpenAppointment).toHaveBeenCalledWith("s-marcus");
  });

  it("shows the calm empty card when the coach has clients but none flagged", () => {
    const { getByText, getByTestId, queryByTestId } = renderWithTheme(
      <CoachHomePresenter
        {...baseProps()}
        flaggedClients={[]}
        programmeAlerts={[]}
      />,
    );
    expect(getByText("All clear")).toBeTruthy();
    expect(getByTestId("coach-home-flagged-empty")).toBeTruthy();
    // Programme-alerts section hides entirely when empty.
    expect(queryByTestId("coach-home-alerts")).toBeNull();
  });

  it("shows the invite nudge for a new coach with no clients", () => {
    const props = baseProps();
    const { getByTestId, getByText, queryByTestId } = renderWithTheme(
      <CoachHomePresenter {...props} hasClients={false} />,
    );
    expect(getByTestId("coach-home-no-clients")).toBeTruthy();
    expect(getByText("Invite your first client")).toBeTruthy();
    // Triage sections are not shown until there are clients.
    expect(queryByTestId("coach-home-flagged")).toBeNull();
    fireEvent.press(getByTestId("coach-home-invite"));
    expect(props.onInviteClient).toHaveBeenCalledTimes(1);
  });

  it("renders the blocking loader while the roster is loading with no cache", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <CoachHomePresenter {...baseProps()} isLoading />,
    );
    expect(getByTestId("coach-home-loader")).toBeTruthy();
    expect(queryByTestId("coach-home-scroll")).toBeNull();
  });

  it("renders the error state with an athlete-mode escape hatch", () => {
    const props = baseProps();
    const { getByTestId } = renderWithTheme(
      <CoachHomePresenter
        {...props}
        error={{ kind: "network", message: "offline" } as never}
      />,
    );
    expect(getByTestId("coach-home-error-state")).toBeTruthy();
  });

  it("renders nothing when the schedule hero has an empty list (deferred stub)", () => {
    const { queryByTestId } = renderWithTheme(
      <ScheduleHeroPresenter
        schedule={[]}
        onOpenAppointment={jest.fn()}
        testID="direct-schedule"
      />,
    );
    expect(queryByTestId("direct-schedule")).toBeNull();
  });

  it("wires header, flagged-row, all-clients, and train-yourself callbacks", () => {
    const props = baseProps();
    const { getByTestId } = renderWithTheme(<CoachHomePresenter {...props} />);

    fireEvent.press(getByTestId("coach-home-bell"));
    expect(props.onOpenNotifications).toHaveBeenCalledTimes(1);

    fireEvent.press(getByTestId("coach-home-avatar"));
    expect(props.onOpenDrawer).toHaveBeenCalledTimes(1);

    fireEvent.press(getByTestId("coach-home-flagged-c-tom"));
    expect(props.onOpenClient).toHaveBeenCalledWith("c-tom");

    fireEvent.press(getByTestId("coach-home-all-clients"));
    expect(props.onOpenClients).toHaveBeenCalledTimes(1);

    fireEvent.press(getByTestId("coach-home-alert-c-emma"));
    expect(props.onOpenClient).toHaveBeenCalledWith("c-emma");

    fireEvent.press(getByTestId("coach-home-train-yourself"));
    expect(props.onTrainYourself).toHaveBeenCalledTimes(1);
  });
});
