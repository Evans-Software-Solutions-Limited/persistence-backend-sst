import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { IconFlame } from "@/ui/components/icons";
import { YouPresenter, type YouPresenterProps } from "../YouPresenter";

function render(overrides: Partial<YouPresenterProps> = {}) {
  const onUseToken = jest.fn();
  const props: YouPresenterProps = {
    initials: "AL",
    workoutsLabel: "THIS MONTH · 18 WORKOUTS",
    streak: { current: 23, longest: 47, freezeTokens: 2, unit: "days" },
    milestones: [
      {
        label: "1w",
        earned: true,
        tone: "ember",
        icon: <IconFlame size={20} />,
      },
      {
        label: "2w",
        earned: false,
        tone: "primary",
        icon: <IconFlame size={20} />,
      },
    ],
    earnedCount: 1,
    bodyTrend: {
      weight: {
        current: 79.8,
        delta: -2.7,
        series: [82.5, 81, 79.8],
        unit: "kg",
      },
      bodyFat: { current: 17.2, delta: -1.4, series: [18.6, 18, 17.2] },
    },
    volumeStats: {
      window: "month",
      workouts: 18,
      totalKg: 62400,
      totalTonnes: 62.4,
      adherencePct: 92,
      byMuscle: [{ muscle: "legs", kg: 14460, pct: 1 }],
    },
    prHistory: [
      {
        id: "pr1",
        userId: "u1",
        exerciseId: "e1",
        exerciseName: "Bench Press",
        recordType: "1rm",
        value: 85,
        achievedAt: "2026-06-06T00:00:00.000Z",
        sessionId: null,
        setId: null,
      },
    ],
    isLoading: false,
    isRefreshing: false,
    trainer: null,
    pendingRequestCount: 0,
    myPendingCoachRequests: [],
    onRefresh: jest.fn(),
    onOpenDrawer: jest.fn(),
    onOpenCalendar: jest.fn(),
    onUseToken,
    onOpenRequests: jest.fn(),
    onOpenAcceptInvite: jest.fn(),
    ...overrides,
  };
  return { ...renderWithTheme(<YouPresenter {...props} />), onUseToken };
}

describe("YouPresenter", () => {
  it("renders streak hero, milestones, body, volume + PR sections", () => {
    const { getByTestId } = render();
    expect(getByTestId("you-scroll")).toBeTruthy();
    expect(getByTestId("you-streak")).toBeTruthy();
    expect(getByTestId("you-milestones")).toBeTruthy();
    expect(getByTestId("you-body")).toBeTruthy();
    expect(getByTestId("you-volume")).toBeTruthy();
    expect(getByTestId("you-prs")).toBeTruthy();
  });

  it("fires onUseToken from the StreakHero Use button", () => {
    const { getByText, onUseToken } = render();
    fireEvent.press(getByText("Use"));
    expect(onUseToken).toHaveBeenCalled();
  });

  it("shows the blocking loader with no data", () => {
    const { getByTestId } = render({
      streak: null,
      volumeStats: null,
      prHistory: [],
      isLoading: true,
    });
    expect(getByTestId("you-loader")).toBeTruthy();
  });

  it("shows the error state with no data + error", () => {
    const { getByTestId } = render({
      streak: null,
      volumeStats: null,
      prHistory: [],
      error: { kind: "api", code: "server", message: "boom" },
    });
    expect(getByTestId("you-error-state")).toBeTruthy();
  });

  it("hides volume + PR sections when absent", () => {
    const { queryByTestId } = render({ volumeStats: null, prHistory: [] });
    expect(queryByTestId("you-volume")).toBeNull();
    expect(queryByTestId("you-prs")).toBeNull();
  });

  it("always renders the COACHING section, even with no trainer and no pending (Phase 8)", () => {
    const { getByTestId } = render({
      trainer: null,
      pendingRequestCount: 0,
      myPendingCoachRequests: [],
    });
    expect(getByTestId("you-trainer-section")).toBeTruthy();
    expect(getByTestId("you-accept-invite-entry")).toBeTruthy();
  });

  it("fires onOpenAcceptInvite from the entry button", () => {
    const props: Partial<YouPresenterProps> = {
      onOpenAcceptInvite: jest.fn(),
    };
    const { getByTestId } = render(props);
    fireEvent.press(getByTestId("you-accept-invite-button"));
    expect(props.onOpenAcceptInvite).toHaveBeenCalledTimes(1);
  });

  it("forwards myPendingCoachRequests to the TrainerProgress block", () => {
    const { getByTestId } = render({
      myPendingCoachRequests: [
        { relationshipId: "rel-1", trainerName: "Coach Carter" },
      ],
    });
    expect(getByTestId("you-pending-coach-request-rel-1")).toBeTruthy();
  });
});
