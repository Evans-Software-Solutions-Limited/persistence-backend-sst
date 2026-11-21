import { describe, expect, it } from "vitest";
import type { TrainingSession } from "@persistence/training-metrics";
import {
  calorieResult,
  historyMonthModel,
  parseDate,
  parseDays,
  parseMonth,
  recapWindows,
  trainingReviewModel,
} from "../trainingReadModels";
import { isoDay, type WindowRecord } from "../trainingReadRepository";

describe("query parsing", () => {
  it.each([
    [undefined, 7],
    ["", 7],
    ["1", 1],
    ["92", 92],
    ["0", null],
    ["93", null],
    ["-1", null],
    ["7d", null],
  ])("days %p → %p", (raw, out) => {
    expect(parseDays(raw)).toBe(out);
  });

  it("knows each month's length, leap years included", () => {
    expect(parseMonth("2028-02")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
    expect(parseMonth("2026-02")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(parseMonth("2026-12")?.to).toBe("2026-12-31");
    expect(parseMonth("2026-00")).toBeNull();
  });

  it("accepts only real days", () => {
    expect(parseDate("2028-02-29")).toBe("2028-02-29");
    expect(parseDate("2026-02-29")).toBeNull();
    expect(parseDate("2026-04-31")).toBeNull();
  });
});

describe("recapWindows", () => {
  const now = new Date("2026-01-14T10:00:00Z");
  it("goes back across the new year", () => {
    expect(recapWindows("month", now, "Europe/London")).toEqual({
      current: { from: "2026-01-01", to: "2026-01-14" },
      previous: { from: "2025-12-01", to: "2025-12-31" },
    });
    expect(recapWindows("3months", now, "Europe/London")).toEqual({
      current: { from: "2025-11-01", to: "2026-01-14" },
      previous: { from: "2025-08-01", to: "2025-10-31" },
    });
  });

  it("starts the week on the owner's Monday", () => {
    // 23:30 UTC Sunday is already Monday in Auckland.
    const sunNight = new Date("2026-01-18T23:30:00Z");
    expect(recapWindows("week", sunNight, "Europe/London").current.from).toBe(
      "2026-01-12",
    );
    expect(recapWindows("week", sunNight, "Pacific/Auckland").current).toEqual({
      from: "2026-01-19",
      to: "2026-01-19",
    });
  });
});

describe("calorieResult (design B ±10%)", () => {
  it.each([
    [null, 2000, "notLogged"],
    [1800, null, "noTarget"],
    [1800, 0, "noTarget"],
    [1800, 2000, "on"],
    [2200, 2000, "on"],
    [2201, 2000, "over"],
    [1799, 2000, "under"],
  ] as const)("%p kcal vs %p → %p", (kcal, target, out) => {
    expect(calorieResult(kcal, target)).toBe(out);
  });
});

describe("historyMonthModel", () => {
  it("keeps only days inside the month that have something logged", () => {
    const m = historyMonthModel({
      month: "2026-11",
      window: { from: "2026-11-01", to: "2026-11-30" },
      timezone: "Europe/London",
      sessions: [],
      logs: new Map([
        [
          "2026-10-31",
          {
            date: "2026-10-31",
            kcal: 100,
            waterCups: 0,
            steps: null,
            weightKg: null,
            habits: [],
            sleepHours: null,
          },
        ],
        [
          "2026-11-02",
          {
            date: "2026-11-02",
            kcal: 0,
            waterCups: 0,
            steps: null,
            weightKg: null,
            habits: [],
            sleepHours: null,
          },
        ],
        [
          "2026-11-03",
          {
            date: "2026-11-03",
            kcal: 0,
            waterCups: 2,
            steps: null,
            weightKg: null,
            habits: [],
            sleepHours: null,
          },
        ],
      ]),
      asOf: "x",
    });
    expect(m.loggedDays).toEqual(["2026-11-03"]);
    expect(m.days[0]).toMatchObject({ food: true, workouts: 0 });
  });
});

describe("trainingReviewModel edges", () => {
  const session: TrainingSession = {
    id: "s1",
    name: "S",
    startedAt: "2026-11-20T10:00:00.000Z",
    completedAt: "2026-11-20T11:00:00.000Z",
    durationSeconds: null,
    exercises: [
      {
        exerciseId: "neck",
        name: "Neck curl",
        isSubstituted: false,
        // A muscle the page has no group for trains nothing.
        primary: ["neck"],
        secondary: [],
        sets: [{ id: "n1", isCompleted: true, reps: 5, weightKg: 20 }],
      },
      {
        exerciseId: "skipped",
        name: "Skipped",
        isSubstituted: false,
        skipped: true,
        primary: ["chest"],
        secondary: [],
        sets: [{ id: "k1", isCompleted: true, reps: 5, weightKg: 20 }],
      },
    ],
  };
  const record: WindowRecord = {
    exerciseId: "elsewhere",
    exerciseName: "Lift from before the window",
    recordType: "1rm",
    value: 100,
    achievedAt: "2026-11-21T10:00:00.000Z",
    sessionId: null,
    setId: null,
  };
  const model = trainingReviewModel({
    window: "7d",
    windows: {
      review: { from: "2026-11-16", to: "2026-11-22" },
      strength: { from: "2026-10-26", to: "2026-11-22" },
      week: { from: "2026-11-16", to: "2026-11-22" },
    },
    timezone: "Europe/London",
    bodyType: "male",
    sessions: [session],
    records: [record],
    asOf: "x",
  });

  it("credits nothing for unknown muscles or skipped exercises", () => {
    expect(model.worked).toEqual([]);
    expect(model.strength).toEqual([]);
  });

  it("still lists a record whose lift isn't in the window, with no muscles", () => {
    expect(model.prsHit).toEqual([{ ...record, muscles: [] }]);
  });
});

describe("isoDay", () => {
  it("reads both driver shapes", () => {
    expect(isoDay(new Date("2026-11-18T00:00:00Z"))).toBe("2026-11-18");
    expect(isoDay("2026-11-18")).toBe("2026-11-18");
  });
});
