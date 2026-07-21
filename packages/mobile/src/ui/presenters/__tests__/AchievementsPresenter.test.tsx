import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { IconFlame } from "@/ui/components/icons";
import type { Achievement } from "@/domain/models/achievement";
import type { PersonalRecord } from "@/domain/models/record";
import {
  AchievementsPresenter,
  type AchievementsPresenterProps,
} from "../AchievementsPresenter";
import type { MilestoneTier } from "../MilestonesRowPresenter";

const MILESTONES: MilestoneTier[] = [
  { label: "1w", earned: true, tone: "ember", icon: <IconFlame size={20} /> },
  {
    label: "2w",
    earned: false,
    tone: "primary",
    icon: <IconFlame size={20} />,
  },
];

const ACHIEVEMENTS: Achievement[] = [
  {
    id: "ua1",
    achievementId: "a1",
    name: "Workout Streak — 4 weeks",
    description: "Trained 4 weeks in a row.",
    category: "streak",
    requirements: { streak_type: "workout_streak", threshold: 4 },
    unlockedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "ua2",
    achievementId: "a2",
    name: "First PR",
    description: null,
    category: "personal_record",
    requirements: null,
    unlockedAt: "2026-05-01T00:00:00.000Z",
  },
];

const PRS: PersonalRecord[] = [
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
];

function render(overrides: Partial<AchievementsPresenterProps> = {}) {
  const onRefresh = jest.fn();
  const props: AchievementsPresenterProps = {
    milestones: MILESTONES,
    earnedCount: 1,
    achievements: ACHIEVEMENTS,
    prHistory: PRS,
    isLoading: false,
    isRefreshing: false,
    error: null,
    onRefresh,
    ...overrides,
  };
  return {
    ...renderWithTheme(<AchievementsPresenter {...props} />),
    onRefresh,
  };
}

describe("AchievementsPresenter", () => {
  it("renders milestones, trophy cards, and PR history sections", () => {
    const { getByTestId, getByText } = render();
    expect(getByTestId("achievements-scroll")).toBeTruthy();
    expect(getByTestId("achievements-milestones")).toBeTruthy();
    expect(getByTestId("achievements-trophies")).toBeTruthy();
    expect(getByTestId("achievements-prs")).toBeTruthy();

    expect(getByText("Workout Streak — 4 weeks")).toBeTruthy();
    expect(getByText("Trained 4 weeks in a row.")).toBeTruthy();
    expect(getByText("First PR")).toBeTruthy();
    expect(getByTestId("pr-history")).toBeTruthy();
    expect(getByText("Bench Press")).toBeTruthy();
  });

  it("omits the milestones section when there are no tiers", () => {
    const { queryByTestId } = render({ milestones: [] });
    expect(queryByTestId("achievements-milestones")).toBeNull();
  });

  it("shows a friendly empty state when there are no achievements", () => {
    const { getByTestId, getByText, queryByTestId } = render({
      achievements: [],
    });
    expect(getByTestId("achievements-empty")).toBeTruthy();
    expect(getByText("Keep training to unlock achievements.")).toBeTruthy();
    expect(queryByTestId("achievement-card-ua1")).toBeNull();
  });

  it("shows a friendly empty state when there are no personal records", () => {
    const { getByTestId, queryByTestId } = render({ prHistory: [] });
    expect(getByTestId("prs-empty")).toBeTruthy();
    expect(queryByTestId("pr-history")).toBeNull();
  });

  it("renders a blocking loader only when there's no data at all", () => {
    const { getByTestId } = render({
      milestones: [],
      achievements: [],
      prHistory: [],
      isLoading: true,
    });
    expect(getByTestId("achievements-loader")).toBeTruthy();
  });

  it("prefers present data over the loader even while isLoading is true", () => {
    const { queryByTestId, getByTestId } = render({ isLoading: true });
    expect(queryByTestId("achievements-loader")).toBeNull();
    expect(getByTestId("achievements-scroll")).toBeTruthy();
  });

  it("renders a blocking error state only when there's no data at all, with a working retry", () => {
    const { getByTestId, getByText, onRefresh } = render({
      milestones: [],
      achievements: [],
      prHistory: [],
      error: { kind: "api", code: "network", message: "offline" },
    });
    expect(getByTestId("achievements-error-state")).toBeTruthy();
    fireEvent.press(getByText("Retry"));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("prefers present data over the error state", () => {
    const { queryByTestId, getByTestId } = render({
      error: { kind: "api", code: "network", message: "offline" },
    });
    expect(queryByTestId("achievements-error-state")).toBeNull();
    expect(getByTestId("achievements-scroll")).toBeTruthy();
  });
});
