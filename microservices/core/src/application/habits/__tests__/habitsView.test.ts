import { describe, it, expect } from "vitest";
import { buildHabitsGrid } from "../habitsView";

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
