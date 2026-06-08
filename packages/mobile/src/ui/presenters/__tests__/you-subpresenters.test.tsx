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
});

describe("VolumeStatsPresenter", () => {
  it("renders with null adherence + empty muscles", () => {
    const { getByTestId } = renderWithTheme(
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
  });
});

describe("PRHistoryPresenter", () => {
  it("renders an empty list", () => {
    const { getByTestId } = renderWithTheme(<PRHistoryPresenter prs={[]} />);
    expect(getByTestId("pr-history")).toBeTruthy();
  });
});
