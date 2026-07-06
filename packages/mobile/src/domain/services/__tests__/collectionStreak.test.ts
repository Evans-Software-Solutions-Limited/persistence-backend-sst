import { collectionWeekMet, deriveCollectionStreak } from "../streak.service";
import type { HabitCompletion } from "@/domain/models/habit-completion";
import type { HabitConfig } from "@/domain/models/habit-config";

/**
 * deriveCollectionStreak — the offline mirror of the backend collection.ts.
 * A single weekly streak across all enabled habits; a week counts when every
 * enabled+effective habit's weekly target is met. Walks back from the current
 * week, scores each week against its start-of-week config, holidays neutral.
 */

// Wed 2026-06-10; that week's Monday = 06-08, prior week Monday = 06-01.
const TODAY = new Date("2026-06-10T12:00:00.000Z");

function cfg(
  over: Partial<HabitConfig> & Pick<HabitConfig, "category">,
): HabitConfig {
  return {
    enabled: true,
    goalId: `goal-${over.category}`,
    assignedByCoach: false,
    locked: false,
    targetValue: 2,
    unit: "l",
    period: "daily",
    completionRule: "value_gte",
    daysPerWeek: 5,
    tolerancePct: null,
    pending: null,
    ...over,
  };
}

/** A completion carrying a value on a given local day. */
function comp(goalId: string, day: string, value: number): HabitCompletion {
  return {
    id: `${goalId}-${day}`,
    userId: "u1",
    goalId,
    completedAt: `${day}T09:00:00.000Z`,
    localCompletedDate: day,
    value,
  };
}

function byGoal(rows: HabitCompletion[]): Map<string, HabitCompletion[]> {
  const map = new Map<string, HabitCompletion[]>();
  for (const r of rows) {
    const arr = map.get(r.goalId) ?? [];
    arr.push(r);
    map.set(r.goalId, arr);
  }
  return map;
}

/** 5 qualifying water days in the Mon–Sun week starting `monday`. */
function fiveWaterDays(goalId: string, monday: string): HabitCompletion[] {
  const days = [0, 1, 2, 3, 4].map((i) => {
    const d = new Date(`${monday}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  return days.map((d) => comp(goalId, d, 2));
}

describe("collectionWeekMet", () => {
  it("value_gte met when qualifying days >= daysPerWeek", () => {
    expect(
      collectionWeekMet(
        {
          completionRule: "value_gte",
          targetValue: 2,
          daysPerWeek: 5,
          tolerancePct: null,
        },
        5,
        0,
      ),
    ).toBe(true);
    expect(
      collectionWeekMet(
        {
          completionRule: "value_gte",
          targetValue: 2,
          daysPerWeek: 5,
          tolerancePct: null,
        },
        4,
        0,
      ),
    ).toBe(false);
  });

  it("count (gym) met when sessions >= ceil(target)", () => {
    expect(
      collectionWeekMet(
        {
          completionRule: "count",
          targetValue: 3,
          daysPerWeek: null,
          tolerancePct: null,
        },
        0,
        3,
      ),
    ).toBe(true);
    expect(
      collectionWeekMet(
        {
          completionRule: "count",
          targetValue: 3,
          daysPerWeek: null,
          tolerancePct: null,
        },
        0,
        2,
      ),
    ).toBe(false);
  });

  it("within_tolerance uses daysPerWeek like value_gte", () => {
    expect(
      collectionWeekMet(
        {
          completionRule: "within_tolerance",
          targetValue: 2000,
          daysPerWeek: 6,
          tolerancePct: 10,
        },
        6,
        0,
      ),
    ).toBe(true);
  });
});

describe("deriveCollectionStreak", () => {
  it("returns 0 when no habit is enabled", () => {
    const water = cfg({ category: "water", enabled: false });
    expect(deriveCollectionStreak([water], new Map(), TODAY)).toBe(0);
  });

  it("counts consecutive satisfied weeks (single water habit, 5/7)", () => {
    const water = cfg({ category: "water", daysPerWeek: 5 });
    const rows = [
      ...fiveWaterDays("goal-water", "2026-06-08"), // current week
      ...fiveWaterDays("goal-water", "2026-06-01"), // prev week
      ...fiveWaterDays("goal-water", "2026-05-25"), // 2 weeks back
    ];
    expect(deriveCollectionStreak([water], byGoal(rows), TODAY)).toBe(3);
  });

  it("grace: current week not yet satisfied doesn't zero a live streak", () => {
    const water = cfg({ category: "water", daysPerWeek: 5 });
    const rows = [
      ...fiveWaterDays("goal-water", "2026-06-01"), // prev week only
      ...fiveWaterDays("goal-water", "2026-05-25"),
    ];
    // Current week has 0 qualifying days → walk starts one week back → 2.
    expect(deriveCollectionStreak([water], byGoal(rows), TODAY)).toBe(2);
  });

  it("all-enabled-met: a missed second habit breaks the week", () => {
    const water = cfg({
      category: "water",
      goalId: "goal-water",
      daysPerWeek: 5,
    });
    const steps = cfg({
      category: "steps",
      goalId: "goal-steps",
      targetValue: 8000,
      daysPerWeek: 5,
    });
    // Water hits 5 days both weeks; steps hits 5 only in the prev week.
    const stepDays = (monday: string) =>
      [0, 1, 2, 3, 4].map((i) => {
        const d = new Date(`${monday}T00:00:00.000Z`);
        d.setUTCDate(d.getUTCDate() + i);
        return comp("goal-steps", d.toISOString().slice(0, 10), 9000);
      });
    const rows = [
      ...fiveWaterDays("goal-water", "2026-06-08"),
      ...fiveWaterDays("goal-water", "2026-06-01"),
      ...stepDays("2026-06-01"), // steps only prev week
    ];
    // Current week: steps missed → not satisfied → grace → prev week satisfied.
    expect(deriveCollectionStreak([water, steps], byGoal(rows), TODAY)).toBe(1);
  });

  it("gym uses session days, not completion values", () => {
    const gym = cfg({
      category: "gym",
      goalId: "goal-gym",
      completionRule: "count",
      period: "weekly",
      targetValue: 3,
      daysPerWeek: null,
      unit: "x",
    });
    const sessions = ["2026-06-08", "2026-06-09", "2026-06-10"]; // 3 this week
    expect(
      deriveCollectionStreak([gym], new Map(), TODAY, {
        gymSessionDays: sessions,
      }),
    ).toBe(1);
  });

  it("holiday weeks are neutral (skipped, neither advance nor break)", () => {
    const water = cfg({ category: "water", daysPerWeek: 5 });
    // Current + 2-weeks-back satisfied; the week between (06-01) is a holiday
    // with NO completions. It must be skipped, so the walk continues to 05-25.
    const rows = [
      ...fiveWaterDays("goal-water", "2026-06-08"),
      ...fiveWaterDays("goal-water", "2026-05-25"),
    ];
    const streak = deriveCollectionStreak([water], byGoal(rows), TODAY, {
      holidays: [{ startDate: "2026-06-01", endDate: "2026-06-07" }],
    });
    expect(streak).toBe(2); // current + 05-25; the holiday week didn't break it
  });

  it("within_tolerance (calories) counts days inside target ± leniency", () => {
    const cals = cfg({
      category: "calories",
      goalId: "goal-cals",
      completionRule: "within_tolerance",
      targetValue: 2000,
      daysPerWeek: 5,
      tolerancePct: 10, // 1800..2200
      unit: "kcal",
    });
    const monday = "2026-06-08";
    const rows = [0, 1, 2, 3, 4].map((i) => {
      const d = new Date(`${monday}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + i);
      // 2100 is within 1800..2200 → qualifies.
      return comp("goal-cals", d.toISOString().slice(0, 10), 2100);
    });
    expect(deriveCollectionStreak([cals], byGoal(rows), TODAY)).toBe(1);
  });

  it("calories day OUTSIDE tolerance doesn't qualify", () => {
    const cals = cfg({
      category: "calories",
      goalId: "goal-cals",
      completionRule: "within_tolerance",
      targetValue: 2000,
      daysPerWeek: 5,
      tolerancePct: 10,
      unit: "kcal",
    });
    const monday = "2026-06-08";
    const rows = [0, 1, 2, 3, 4].map((i) => {
      const d = new Date(`${monday}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + i);
      return comp("goal-cals", d.toISOString().slice(0, 10), 2500); // over 2200
    });
    // 0 qualifying days this week → grace → no prior week → 0.
    expect(deriveCollectionStreak([cals], byGoal(rows), TODAY)).toBe(0);
  });

  it("effective_from gate: a habit not yet effective this week is excluded", () => {
    // Water is effective; a freshly-enabled steps habit has effectiveFrom in the
    // future → it's loggable but NOT part of this week's requirement, so water
    // alone satisfies the current week.
    const water = cfg({
      category: "water",
      goalId: "goal-water",
      daysPerWeek: 5,
    });
    const futureSteps = cfg({
      category: "steps",
      goalId: "goal-steps",
      targetValue: 8000,
      daysPerWeek: 5,
      effectiveFrom: "2026-06-15", // after this week's Monday (06-08)
    });
    const rows = fiveWaterDays("goal-water", "2026-06-08");
    expect(
      deriveCollectionStreak([water, futureSteps], byGoal(rows), TODAY),
    ).toBe(1);
  });

  it("pending disable promoted for a past week excludes the habit that week", () => {
    // A habit with a pending {enabled:false, from<=weekStart} is treated as
    // disabled for that week's scoring (mirrors the cron promotion).
    const water = cfg({
      category: "water",
      goalId: "goal-water",
      daysPerWeek: 5,
    });
    const disablingSteps = cfg({
      category: "steps",
      goalId: "goal-steps",
      targetValue: 8000,
      daysPerWeek: 5,
      pending: { from: "2026-06-08", enabled: false },
    });
    // Only water has completions; steps' pending-disable promotes at 06-08 so it
    // drops out of the requirement → the current week is satisfied by water.
    const rows = fiveWaterDays("goal-water", "2026-06-08");
    expect(
      deriveCollectionStreak([water, disablingSteps], byGoal(rows), TODAY),
    ).toBe(1);
  });

  it("preserves localCompletedDate precedence over completedAt", () => {
    const water = cfg({
      category: "water",
      goalId: "goal-water",
      daysPerWeek: 1,
    });
    // completedAt is a different UTC day than localCompletedDate; bucketing MUST
    // use localCompletedDate (06-08, Monday of the current week).
    const row: HabitCompletion = {
      id: "x",
      userId: "u1",
      goalId: "goal-water",
      completedAt: "2026-06-07T23:00:00.000Z", // prior week's Sunday in UTC
      localCompletedDate: "2026-06-08", // authoritative: current week
      value: 3,
    };
    expect(deriveCollectionStreak([water], byGoal([row]), TODAY)).toBe(1);
  });
});
