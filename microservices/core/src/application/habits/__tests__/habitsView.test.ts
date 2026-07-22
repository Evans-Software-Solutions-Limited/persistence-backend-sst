import { describe, it, expect } from "vitest";
import {
  buildHabitsGrid,
  habitsGridWindow,
  mergeDerivedHabitRows,
} from "../habitsView";

const NOW = new Date("2026-06-10T12:00:00Z"); // Wed, window 06-04..06-10
const LON = "Europe/London";

describe("buildHabitsGrid", () => {
  it("buckets completions into a 7-day grid with today last", () => {
    // Uses the STORED local_completed_date (tz-change-proof), not completedAt.
    const grid = buildHabitsGrid(
      [
        { goalId: "g1", localCompletedDate: "2026-06-10" }, // today
        { goalId: "g1", localCompletedDate: "2026-06-08" }, // Mon
        { goalId: "g2", localCompletedDate: "2026-06-10" },
      ],
      NOW,
      LON,
    );
    const g1 = grid.find((r) => r.goalId === "g1")!;
    expect(g1.days).toHaveLength(7);
    expect(g1.days[6]).toBe(true); // 06-10 today (last)
    expect(g1.days[4]).toBe(true); // 06-08
    expect(g1.days[5]).toBe(false); // 06-09
    expect(grid.find((r) => r.goalId === "g2")).toBeTruthy();
  });

  it("returns an empty grid with no completions", () => {
    expect(buildHabitsGrid([], NOW, LON)).toEqual([]);
  });
});

describe("habitsGridWindow", () => {
  it("returns [today-6 … today], today last — the same window buildHabitsGrid uses", () => {
    expect(habitsGridWindow(NOW, LON)).toEqual([
      "2026-06-04",
      "2026-06-05",
      "2026-06-06",
      "2026-06-07",
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
    ]);
  });
});

// BRIEF-7 QA-1..QA-4 (device-QA sweep): Gym + Calories never write a
// habit_completions row, so buildHabitsGrid's pure row-existence logic can
// never fill their tile. mergeDerivedHabitRows folds in the DERIVED rows
// StreakRepository.getDerivedHabitGridRows computes straight from logged
// workout_sessions / nutrition_entries.
describe("mergeDerivedHabitRows", () => {
  const water = {
    goalId: "water-goal",
    days: [true, false, false, false, false, false, false],
  };
  const gym = {
    goalId: "gym-goal",
    days: [false, false, false, false, false, false, true],
  };
  const calories = {
    goalId: "cal-goal",
    days: [true, true, true, true, true, true, true],
  };

  it("adds derived rows alongside untouched completion-based rows (manual water + derived gym/calories)", () => {
    const merged = mergeDerivedHabitRows([water], [gym, calories]);
    expect(merged).toHaveLength(3);
    expect(merged.find((r) => r.goalId === "water-goal")).toEqual(water);
    expect(merged.find((r) => r.goalId === "gym-goal")).toEqual(gym);
    expect(merged.find((r) => r.goalId === "cal-goal")).toEqual(calories);
  });

  it("a derived row wins over a same-goalId completion row", () => {
    const staleCompletionRow = {
      goalId: "gym-goal",
      days: [true, true, true, true, true, true, true],
    };
    const merged = mergeDerivedHabitRows([staleCompletionRow], [gym]);
    expect(merged).toEqual([gym]);
  });

  it("returns the base grid unchanged when there are no derived rows", () => {
    expect(mergeDerivedHabitRows([water], [])).toEqual([water]);
  });

  it("returns just the derived rows when the base grid is empty (no other habits configured)", () => {
    expect(mergeDerivedHabitRows([], [gym, calories])).toEqual([gym, calories]);
  });
});
