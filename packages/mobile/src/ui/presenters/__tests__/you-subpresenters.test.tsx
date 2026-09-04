import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { StreakHeroPresenter } from "../StreakHeroPresenter";
import { BodyTrendPresenter } from "../BodyTrendPresenter";
import { VolumeStatsPresenter } from "../VolumeStatsPresenter";
import { PRHistoryPresenter } from "../PRHistoryPresenter";

describe("StreakHeroPresenter", () => {
  it("disables Use when there are no freeze tokens", () => {
    const { getByText } = renderWithTheme(
      <StreakHeroPresenter
        current={5}
        longest={5}
        freezeTokens={0}
        unit="days"
        onUseToken={jest.fn()}
      />,
    );
    expect(getByText("Use")).toBeTruthy();
  });
});

describe("BodyTrendPresenter", () => {
  it("renders bars + sparkline, handling empty series", () => {
    const { getByTestId } = renderWithTheme(
      <BodyTrendPresenter
        weight={{ current: null, delta: 0, series: [], unit: "kg" }}
        bodyFat={{ current: 17, delta: 1.2, series: [18, 17.5, 17] }}
      />,
    );
    expect(getByTestId("body-trend")).toBeTruthy();
  });

  it("opens Weight and Body Fat through distinct actions", () => {
    const onOpenWeight = jest.fn();
    const onOpenBodyFat = jest.fn();
    const { getByTestId } = renderWithTheme(
      <BodyTrendPresenter
        weight={{ current: 80, delta: -1, series: [81, 80], unit: "kg" }}
        bodyFat={{ current: 17, delta: -1, series: [18, 17] }}
        onOpenWeight={onOpenWeight}
        onOpenBodyFat={onOpenBodyFat}
      />,
    );
    fireEvent.press(getByTestId("body-trend-weight-card"));
    fireEvent.press(getByTestId("body-trend-body-fat-card"));
    expect(onOpenWeight).toHaveBeenCalledTimes(1);
    expect(onOpenBodyFat).toHaveBeenCalledTimes(1);
  });
});

describe("VolumeStatsPresenter", () => {
  it("renders with null adherence + empty muscles", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <VolumeStatsPresenter
        stats={{
          window: "lifetime",
          workouts: 0,
          totalKg: 0,
          totalTonnes: 0,
          adherencePct: null,
          byMuscle: [],
        }}
      />,
    );
    expect(getByTestId("volume-stats")).toBeTruthy();
    expect(getByText("no Gym habit")).toBeTruthy();
  });
});

describe("PRHistoryPresenter", () => {
  it("renders an empty list", () => {
    const { getByTestId } = renderWithTheme(<PRHistoryPresenter prs={[]} />);
    expect(getByTestId("pr-history")).toBeTruthy();
  });

  it("formats best_time as a readable duration, not a weight", () => {
    const { getByText, queryByText } = renderWithTheme(
      <PRHistoryPresenter
        prs={[
          {
            id: "pr1",
            userId: "u1",
            exerciseId: "e1",
            exerciseName: "5k Run",
            recordType: "best_time",
            value: 1800,
            achievedAt: "2026-06-08T00:00:00.000Z",
            sessionId: null,
            setId: null,
          },
        ]}
      />,
    );
    expect(getByText("30:00")).toBeTruthy();
    expect(queryByText("kg")).toBeNull();
  });
});
