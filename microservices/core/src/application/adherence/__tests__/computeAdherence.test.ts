import { describe, expect, it } from "vitest";
import {
  addDays,
  adherenceByArea,
  computeAdherence,
  judgeCalorieDay,
  localDateIn,
  practiceAdherence,
  safeTimeZone,
  targetResolver,
  type AdherenceInput,
  type AdherenceReport,
} from "../computeAdherence";

/**
 * Design B D6 test 1 — `computeAdherence` table tests (PER-114). Pure: every
 * case builds its own input, no database.
 */

const LONDON = "Europe/London";
// Friday 20 Nov 2026, 10:00 in London (GMT).
const NOW = new Date("2026-11-20T10:00:00Z");

function input(over: Partial<AdherenceInput> = {}): AdherenceInput {
  return {
    timeZone: LONDON,
    now: NOW,
    coachingStart: null,
    settings: { trackTraining: true, trackCalories: true, sessionsPerWeek: 4 },
    sessions: [],
    dayKcal: new Map(),
    targets: [{ effectiveAt: new Date(0), dailyKcal: 2000 }],
    windowDays: 7,
    ...over,
  };
}

const at = (iso: string) => ({ completedAt: new Date(iso) });
const kcal = (entries: [string, number][]) => new Map(entries);
const results = (r: AdherenceReport) =>
  r.calories!.perDay.map((d) => `${d.date}:${d.result}`);

describe("computeAdherence — calories", () => {
  it("never counts today, even when today is logged on target", () => {
    const r = computeAdherence(
      input({ dayKcal: kcal([["2026-11-20", 2000]]) }),
    );
    expect(r.calories!.to).toBe("2026-11-19");
    expect(r.calories!.from).toBe("2026-11-13");
    expect(r.calories!.perDay).toHaveLength(7);
    expect(r.calories!.perDay.map((d) => d.date)).not.toContain("2026-11-20");
    expect(r.calories!.daysOnTarget).toBe(0);
  });

  it("counts an unlogged day as a miss and also on its own", () => {
    const r = computeAdherence(
      input({
        dayKcal: kcal([
          ["2026-11-19", 2000],
          ["2026-11-18", 2500],
          ["2026-11-17", 1500],
        ]),
      }),
    );
    expect(r.calories).toMatchObject({
      daysOnTarget: 1,
      daysOver: 1,
      daysUnder: 1,
      daysNotLogged: 4,
      daysCounted: 7,
    });
    expect(r.calories!.perDay[0]).toEqual({
      date: "2026-11-13",
      kcal: null,
      targetKcal: 2000,
      result: "notLogged",
    });
  });

  it("treats a logged day at 0 kcal as logged (under), not unlogged", () => {
    const r = computeAdherence(input({ dayKcal: kcal([["2026-11-19", 0]]) }));
    expect(r.calories!.perDay[6]!.result).toBe("under");
  });

  it("scores each day on the target in force that day", () => {
    // 2000 until Tue 17 Nov 15:00, then 2500. The change day takes the new one.
    const r = computeAdherence(
      input({
        targets: [
          { effectiveAt: new Date("2026-11-17T15:00:00Z"), dailyKcal: 2500 },
          { effectiveAt: new Date(0), dailyKcal: 2000 },
        ],
        dayKcal: kcal([
          ["2026-11-16", 2000],
          ["2026-11-17", 2500],
          ["2026-11-18", 2000],
        ]),
      }),
    );
    const byDate = new Map(r.calories!.perDay.map((d) => [d.date, d]));
    expect(byDate.get("2026-11-16")).toMatchObject({
      targetKcal: 2000,
      result: "on",
    });
    expect(byDate.get("2026-11-17")).toMatchObject({
      targetKcal: 2500,
      result: "on",
    });
    expect(byDate.get("2026-11-18")).toMatchObject({
      targetKcal: 2500,
      result: "under",
    });
  });

  it("excludes a day with no target in force", () => {
    const r = computeAdherence(
      input({
        targets: [
          { effectiveAt: new Date("2026-11-18T09:00:00Z"), dailyKcal: 2000 },
        ],
        dayKcal: kcal([
          ["2026-11-17", 2000],
          ["2026-11-18", 2000],
        ]),
      }),
    );
    expect(results(r).slice(0, 5)).toEqual([
      "2026-11-13:noTarget",
      "2026-11-14:noTarget",
      "2026-11-15:noTarget",
      "2026-11-16:noTarget",
      "2026-11-17:noTarget",
    ]);
    expect(r.calories).toMatchObject({
      daysCounted: 2,
      daysOnTarget: 1,
      daysNotLogged: 1,
    });
  });

  it("treats a zero target as no target", () => {
    expect(judgeCalorieDay(0, 0)).toBe("noTarget");
    expect(judgeCalorieDay(null, null)).toBe("noTarget");
  });

  it("judges ±10% inclusively", () => {
    expect(judgeCalorieDay(2200, 2000)).toBe("on");
    expect(judgeCalorieDay(1800, 2000)).toBe("on");
    expect(judgeCalorieDay(2200.5, 2000)).toBe("over");
    expect(judgeCalorieDay(1799.5, 2000)).toBe("under");
    expect(judgeCalorieDay(null, 2000)).toBe("notLogged");
  });

  it("uses 28 completed days for the 28-day window", () => {
    const r = computeAdherence(input({ windowDays: 28 }));
    expect(r.calories!.from).toBe("2026-10-23");
    expect(r.calories!.to).toBe("2026-11-19");
    expect(r.calories!.perDay).toHaveLength(28);
    expect(r.calories!.daysNotLogged).toBe(28);
  });
});

describe("computeAdherence — coaching start", () => {
  it("only counts days since a client started 3 days ago", () => {
    const r = computeAdherence(
      input({
        coachingStart: "2026-11-17",
        sessions: [
          at("2026-11-15T09:00:00Z"),
          at("2026-11-16T09:00:00Z"),
          at("2026-11-17T09:00:00Z"),
          at("2026-11-19T09:00:00Z"),
        ],
        dayKcal: kcal([
          ["2026-11-16", 2000],
          ["2026-11-17", 2000],
        ]),
      }),
    );
    expect(r.training).toMatchObject({
      from: "2026-11-17",
      to: "2026-11-20",
      done: 2,
    });
    expect(results(r)).toEqual([
      "2026-11-13:beforeCoaching",
      "2026-11-14:beforeCoaching",
      "2026-11-15:beforeCoaching",
      "2026-11-16:beforeCoaching",
      "2026-11-17:on",
      "2026-11-18:notLogged",
      "2026-11-19:notLogged",
    ]);
    expect(r.calories).toMatchObject({ daysCounted: 3, daysOnTarget: 1 });
    // The excluded day still shows what was logged and the target.
    expect(r.calories!.perDay[3]).toEqual({
      date: "2026-11-16",
      kcal: 2000,
      targetKcal: 2000,
      result: "beforeCoaching",
    });
  });

  it("counts the whole window when the start is earlier", () => {
    const r = computeAdherence(input({ coachingStart: "2026-01-01" }));
    expect(r.training!.from).toBe("2026-11-14");
    expect(r.calories!.daysCounted).toBe(7);
  });
});

describe("computeAdherence — time zones", () => {
  it("rolls across the October clock change in Europe/London", () => {
    // Clocks went back at 02:00 BST on Sun 25 Oct 2026.
    const now = new Date("2026-10-28T10:00:00Z");
    const r = computeAdherence(
      input({
        now,
        sessions: [
          at("2026-10-21T22:30:00Z"), // 21 Oct 23:30 BST — outside
          at("2026-10-21T23:30:00Z"), // 22 Oct 00:30 BST — first day in
          at("2026-10-28T09:00:00Z"), // today
        ],
        // The repository groups by local day; these days come from it.
        dayKcal: kcal([
          [localDateIn(new Date("2026-10-24T23:30:00Z"), LONDON), 1000],
          [localDateIn(new Date("2026-10-25T23:30:00Z"), LONDON), 1000],
        ]),
      }),
    );
    expect(localDateIn(new Date("2026-10-24T23:30:00Z"), LONDON)).toBe(
      "2026-10-25",
    );
    expect(localDateIn(new Date("2026-10-25T23:30:00Z"), LONDON)).toBe(
      "2026-10-25",
    );
    expect(r.training).toMatchObject({
      from: "2026-10-22",
      to: "2026-10-28",
      done: 2,
    });
    expect(r.calories!.perDay.map((d) => d.date)).toEqual([
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
    ]);
  });

  it("uses the athlete's own time zone", () => {
    // 05:00 UTC on 20 Nov is 21:00 on 19 Nov in Los Angeles.
    const now = new Date("2026-11-20T05:00:00Z");
    const r = computeAdherence(
      input({
        now,
        timeZone: "America/Los_Angeles",
        sessions: [at("2026-11-20T04:00:00Z"), at("2026-11-13T08:30:00Z")],
      }),
    );
    expect(r.training).toMatchObject({
      from: "2026-11-13",
      to: "2026-11-19",
      done: 2,
    });
    expect(r.calories!.to).toBe("2026-11-18");
    // In London the same instants give a different window.
    const london = computeAdherence(
      input({
        now,
        sessions: [at("2026-11-20T04:00:00Z"), at("2026-11-13T08:30:00Z")],
      }),
    );
    expect(london.training).toMatchObject({ to: "2026-11-20", done: 1 });
  });

  it("falls back to London for an unknown or missing zone", () => {
    expect(safeTimeZone("Not/AZone")).toBe(LONDON);
    expect(safeTimeZone(null)).toBe(LONDON);
    const r = computeAdherence(input({ timeZone: "Not/AZone" }));
    expect(r.training!.to).toBe("2026-11-20");
  });
});

describe("computeAdherence — training", () => {
  const sessions = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      at(`2026-11-${String(14 + i).padStart(2, "0")}T12:00:00Z`),
    );

  it("is met when done reaches the target", () => {
    const r = computeAdherence(input({ sessions: sessions(4) }));
    expect(r.training).toEqual({
      from: "2026-11-14",
      to: "2026-11-20",
      target: 4,
      done: 4,
      label: "4 of 4 in the last 7 days",
      state: "met",
    });
  });

  it("is behind below the target", () => {
    const r = computeAdherence(input({ sessions: sessions(3) }));
    expect(r.training).toMatchObject({
      done: 3,
      state: "behind",
      label: "3 of 4 in the last 7 days",
    });
  });

  it("has no target without sessions_per_week", () => {
    const r = computeAdherence(
      input({
        sessions: sessions(2),
        settings: {
          trackTraining: true,
          trackCalories: false,
          sessionsPerWeek: null,
        },
      }),
    );
    expect(r.training).toMatchObject({
      target: null,
      done: 2,
      state: "noTarget",
      label: "2 in the last 7 days",
    });
  });

  it("scales the target to 4 x weekly over 28 days", () => {
    const many = Array.from({ length: 13 }, (_, i) =>
      at(new Date(NOW.getTime() - i * 2 * 86_400_000).toISOString()),
    );
    const r = computeAdherence(input({ windowDays: 28, sessions: many }));
    expect(r.training).toMatchObject({
      from: "2026-10-24",
      target: 16,
      done: 13,
      state: "behind",
      label: "13 of 16 in the last 28 days",
    });
  });

  it("ignores sessions outside the window, including future ones", () => {
    const r = computeAdherence(
      input({
        sessions: [at("2026-11-13T12:00:00Z"), at("2026-11-21T12:00:00Z")],
      }),
    );
    expect(r.training!.done).toBe(0);
  });
});

describe("computeAdherence — tracked areas", () => {
  it("leaves untracked areas out", () => {
    const none = computeAdherence(
      input({
        settings: {
          trackTraining: false,
          trackCalories: false,
          sessionsPerWeek: 4,
        },
      }),
    );
    expect(none).toEqual({ asOf: NOW.toISOString(), windowDays: 7 });
    expect("training" in none).toBe(false);
    expect("calories" in none).toBe(false);

    const caloriesOnly = computeAdherence(
      input({
        settings: {
          trackTraining: false,
          trackCalories: true,
          sessionsPerWeek: 4,
        },
      }),
    );
    expect(caloriesOnly.training).toBeUndefined();
    expect(caloriesOnly.calories).toBeDefined();
  });
});

describe("targetResolver", () => {
  it("takes the later of two rows with the same effective time", () => {
    const same = new Date("2026-11-10T10:00:00Z");
    const resolve = targetResolver(
      [
        { effectiveAt: same, dailyKcal: 1800 },
        { effectiveAt: same, dailyKcal: 1900 },
      ],
      LONDON,
    );
    expect(resolve("2026-11-10")).toBe(1900);
    expect(resolve("2026-11-09")).toBeNull();
  });
});

describe("addDays", () => {
  it("crosses month ends and the clock change by calendar days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-10-26", -2)).toBe("2026-10-24");
  });
});

describe("adherenceByArea and practiceAdherence", () => {
  const a = computeAdherence(
    input({
      sessions: [at("2026-11-19T09:00:00Z"), at("2026-11-18T09:00:00Z")],
      dayKcal: kcal([["2026-11-19", 2000]]),
    }),
  );
  const b = computeAdherence(
    input({
      settings: {
        trackTraining: true,
        trackCalories: true,
        sessionsPerWeek: 3,
      },
      sessions: [at("2026-11-19T09:00:00Z")],
      dayKcal: kcal([
        ["2026-11-19", 2000],
        ["2026-11-18", 2000],
      ]),
    }),
  );
  const noTarget = computeAdherence(
    input({
      settings: {
        trackTraining: true,
        trackCalories: false,
        sessionsPerWeek: null,
      },
      sessions: [at("2026-11-19T09:00:00Z")],
    }),
  );
  const untracked = computeAdherence(
    input({
      settings: {
        trackTraining: false,
        trackCalories: false,
        sessionsPerWeek: null,
      },
    }),
  );

  it("compacts a report to the roster shape", () => {
    expect(adherenceByArea(a)).toEqual({
      training: {
        done: 2,
        target: 4,
        label: "2 of 4 in the last 7 days",
        state: "behind",
      },
      calories: { daysOnTarget: 1, daysCounted: 7, daysNotLogged: 6 },
    });
    expect(adherenceByArea(untracked)).toEqual({});
  });

  it("sums per area across tracked clients, never blended", () => {
    expect(practiceAdherence([a, b, noTarget, untracked])).toEqual({
      training: { done: 3, target: 7, clients: 2 },
      calories: {
        daysOnTarget: 3,
        daysCounted: 14,
        daysNotLogged: 11,
        clients: 2,
      },
    });
    expect(practiceAdherence([untracked])).toEqual({});
    expect(practiceAdherence([])).toEqual({});
  });
});
