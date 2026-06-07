import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TodayHeroPresenter } from "../TodayHeroPresenter";
import { WeeklyVolumePresenter } from "../WeeklyVolumePresenter";
import { PRCarouselPresenter, relativeDate } from "../PRCarouselPresenter";
import { HabitsGridPresenter } from "../HabitsGridPresenter";
import type { WeeklyVolume } from "@/domain/models/progress";

describe("relativeDate", () => {
  const now = new Date("2026-06-10T12:00:00.000Z").getTime();
  it("formats coarse relative dates", () => {
    expect(relativeDate("2026-06-10T00:00:00.000Z", now)).toBe("today");
    expect(relativeDate("2026-06-09T00:00:00.000Z", now)).toBe("yesterday");
    expect(relativeDate("2026-06-07T00:00:00.000Z", now)).toBe("3 days ago");
    expect(relativeDate("2026-06-03T00:00:00.000Z", now)).toBe("1 week ago");
    expect(relativeDate("2026-05-27T00:00:00.000Z", now)).toBe("2 weeks ago");
    expect(relativeDate("2026-05-20T00:00:00.000Z", now)).toBe("3 weeks ago");
    expect(relativeDate("not-a-date", now)).toBe("");
  });
});

describe("TodayHeroPresenter", () => {
  it("renders a non-gated fuel ring with real values", () => {
    const { getByTestId } = renderWithTheme(
      <TodayHeroPresenter
        rings={{
          move: { current: 7420, target: 10000, pct: 0.74, unit: "steps" },
          train: { current: 8400, target: 20000, pct: 0.42, unit: "kg" },
          fuel: { current: 1840, target: 2100, pct: 0.88, unit: "kcal" },
        }}
        micro={{ streak: 23, water: "6/8", strain: 32, sleep: "7h" }}
      />,
    );
    expect(getByTestId("today-hero")).toBeTruthy();
  });

  it("renders a gated fuel ring", () => {
    const { getByTestId } = renderWithTheme(
      <TodayHeroPresenter
        rings={{
          move: { current: 0, target: 10000, pct: 0, unit: "steps" },
          train: { current: 0, target: 20000, pct: 0, unit: "kg" },
          fuel: "gated",
        }}
        micro={{ streak: 0, water: null, strain: null, sleep: null }}
      />,
    );
    expect(getByTestId("today-hero")).toBeTruthy();
  });
});

describe("WeeklyVolumePresenter", () => {
  const base: WeeklyVolume = {
    days: [
      { date: "2026-06-08", volumeKg: 600, isToday: false, isRest: false },
      { date: "2026-06-09", volumeKg: 0, isToday: false, isRest: true },
      { date: "2026-06-10", volumeKg: 900, isToday: true, isRest: false },
    ],
    totalKg: 14820,
    deltaPct: 12,
    workouts: { completed: 4, target: 5 },
  };
  it("renders with a positive delta", () => {
    const { getByTestId } = renderWithTheme(
      <WeeklyVolumePresenter weeklyVolume={base} />,
    );
    expect(getByTestId("weekly-volume")).toBeTruthy();
  });
  it("renders with a negative delta and null delta", () => {
    renderWithTheme(
      <WeeklyVolumePresenter weeklyVolume={{ ...base, deltaPct: -8 }} />,
    );
    const { getByTestId } = renderWithTheme(
      <WeeklyVolumePresenter weeklyVolume={{ ...base, deltaPct: null }} />,
    );
    expect(getByTestId("weekly-volume")).toBeTruthy();
  });
});

describe("HabitsGridPresenter", () => {
  it("renders habit rows + 7-day cells", () => {
    const { getByTestId } = renderWithTheme(
      <HabitsGridPresenter
        habits={[
          {
            id: "g1",
            label: "Workout",
            tone: "primary",
            days: [true, true, false, true, false, true, false],
          },
        ]}
        weekDates={[
          "2026-06-04",
          "2026-06-05",
          "2026-06-06",
          "2026-06-07",
          "2026-06-08",
          "2026-06-09",
          "2026-06-10",
        ]}
        onToggle={jest.fn()}
      />,
    );
    expect(getByTestId("habits-grid")).toBeTruthy();
  });
});

describe("PRCarouselPresenter", () => {
  it("renders PR cards", () => {
    const { getByTestId } = renderWithTheme(
      <PRCarouselPresenter
        prs={[
          {
            id: "pr1",
            userId: "u1",
            exerciseId: "e1",
            exerciseName: "Bench Press",
            recordType: "1rm",
            value: 85,
            achievedAt: "2026-06-08T00:00:00.000Z",
            sessionId: null,
            setId: null,
          },
        ]}
      />,
    );
    expect(getByTestId("pr-carousel")).toBeTruthy();
  });
});
