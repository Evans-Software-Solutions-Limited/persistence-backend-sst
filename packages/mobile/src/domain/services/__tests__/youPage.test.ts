import {
  bodyMapShading,
  buildRecap,
  dayKey,
  dayThatSorts,
  historyDay,
  lastSevenDays,
  monthCells,
  musclesForSessions,
  previousRecapWindow,
  recapWindow,
  sentenceList,
  sessionsBetween,
  sessionTotals,
  toLocalDate,
  topLifts,
  trainingTotals,
  workedList,
} from "../youPage";
import { muscleCredit } from "@persistence/training-metrics";
import { musclesOf, record, session } from "./youFixtures";

// Thursday 29 Oct 2026, 18:00 local.
const NOW = new Date(2026, 9, 29, 18, 0);
const at = (d: number, h = 7, m = 10) =>
  new Date(2026, 9, d, h, m).toISOString();

describe("dates", () => {
  it("keys a day by the local calendar", () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(dayKey(at(26))).toBe("2026-10-26");
  });

  it("covers the last 7 days, today included", () => {
    const w = lastSevenDays(NOW);
    expect(dayKey(w.from)).toBe("2026-10-23");
    expect(w.from.getHours()).toBe(0);
    expect(w.to).toBe(NOW);
  });
});

describe("sessionsBetween", () => {
  it("keeps finished workouts in the window, oldest first", () => {
    const a = session("a", at(28), {});
    const b = session("b", at(24), {});
    const old = session("old", at(20), {});
    const cancelled = session("c", at(27), {}, { status: "cancelled" });
    const w = lastSevenDays(NOW);
    expect(
      sessionsBetween([a, old, cancelled, b], w.from, w.to).map((s) => s.id),
    ).toEqual(["b", "a"]);
  });
});

describe("totals", () => {
  it("counts completed sets' volume and the workout's length", () => {
    const s = session("a", at(26), {
      bench: [
        [100, 5],
        [100, 5],
        [100, 5, false],
      ],
    });
    expect(sessionTotals(s)).toEqual({
      durationSeconds: 3600,
      volumeKg: 1000,
      sets: 2,
    });
  });

  it("uses a logged-after-the-fact workout's own duration", () => {
    const s = session(
      "a",
      at(26),
      { bench: [[100, 5]] },
      { retrospectiveDurationSeconds: 1800 },
    );
    expect(sessionTotals(s).durationSeconds).toBe(1800);
  });

  it("sums workouts, volume, time and sets", () => {
    const s1 = session("a", at(26), { bench: [[100, 5]] });
    const s2 = session("b", at(27), { squat: [[50, 10]] });
    expect(trainingTotals([s1, s2])).toEqual({
      workouts: 2,
      durationSeconds: 7200,
      volumeKg: 1000,
      sets: 2,
    });
    expect(trainingTotals([])).toEqual({
      workouts: 0,
      durationSeconds: 0,
      volumeKg: 0,
      sets: 0,
    });
  });
});

describe("muscles", () => {
  it("credits muscles across the window's workouts", () => {
    const rows = musclesForSessions(
      [
        session("a", at(26), {
          bench: [
            [80, 8],
            [80, 8],
          ],
        }),
        session("b", at(27), { curl: [[20, 10]] }),
      ],
      musclesOf,
    );
    const by = (g: string) => rows.find((r) => r.group === g)!;
    expect(by("chest").credit).toBe(2);
    // bench secondary triceps (2 × 0.5) + curl primary biceps (1).
    expect(by("arms").credit).toBe(2);
    expect(by("shoulders").credit).toBe(1);
    expect(by("forearms").credit).toBe(0.5);
  });

  it("skips exercises with no known muscles", () => {
    const rows = musclesForSessions(
      [session("a", at(26), { mystery: [[10, 10]] })],
      musclesOf,
    );
    expect(rows.every((r) => r.credit === 0)).toBe(true);
  });

  it("shades body-map regions by weekly level or relative to the busiest", () => {
    const rows = muscleCredit([
      { primary: ["chest"], secondary: [], completedSets: 10 },
      { primary: ["biceps"], secondary: [], completedSets: 2 },
    ]);
    const weekly = bodyMapShading(rows, "label");
    expect(weekly.accessibilityLabel).toBe("label");
    expect(weekly.regions).toEqual(
      expect.arrayContaining([
        { slug: "chest", intensity: 4 },
        { slug: "biceps", intensity: 1 },
        { slug: "triceps", intensity: 1 },
      ]),
    );
    const relative = bodyMapShading(rows, "label", true);
    expect(relative.regions).toEqual(
      expect.arrayContaining([
        { slug: "chest", intensity: 4 },
        { slug: "biceps", intensity: 1 },
      ]),
    );
    const mid = muscleCredit([
      { primary: ["chest"], secondary: [], completedSets: 4 },
      { primary: ["back"], secondary: [], completedSets: 3 },
      { primary: ["quadriceps"], secondary: [], completedSets: 2 },
    ]);
    expect(bodyMapShading(mid, "x", true).regions).toEqual(
      expect.arrayContaining([
        { slug: "chest", intensity: 4 },
        { slug: "upper-back", intensity: 4 },
        { slug: "quadriceps", intensity: 3 },
      ]),
    );
    expect(
      bodyMapShading(
        muscleCredit([
          { primary: ["chest"], secondary: [], completedSets: 3 },
          { primary: ["core"], secondary: [], completedSets: 1 },
        ]),
        "x",
        true,
      ).regions,
    ).toEqual(expect.arrayContaining([{ slug: "abs", intensity: 2 }]));
    expect(bodyMapShading(muscleCredit([]), "none").regions).toEqual([]);
  });

  it("lists worked groups, most first", () => {
    const rows = muscleCredit([
      { primary: ["back"], secondary: [], completedSets: 3 },
      { primary: ["chest"], secondary: [], completedSets: 4 },
    ]);
    expect(workedList(rows)).toBe("Chest, back");
    expect(workedList(muscleCredit([]))).toBe("");
    expect(sentenceList([])).toBe("");
  });

  it("knows which day sorts a set of muscles", () => {
    expect(dayThatSorts(["hamstrings", "calves", "core"])).toBe("lower");
    expect(dayThatSorts(["chest", "arms"])).toBe("upper");
    expect(dayThatSorts(["chest", "quads"])).toBeNull();
    expect(dayThatSorts([])).toBeNull();
  });
});

describe("topLifts", () => {
  const s1 = session("a", at(26), {
    squat: [
      [120, 7],
      [100, 5],
    ],
    bench: [[95, 5]],
  });
  const s2 = session("b", at(27), {
    bench: [
      [90, 3],
      [200, 12],
      [null, 10],
    ],
    curl: [[20, 8, false]],
  });

  it("ranks each exercise's best set by estimated 1RM", () => {
    const lifts = topLifts([s1, s2], [], new Date(2026, 9, 23));
    expect(lifts.map((l) => l.exerciseId)).toEqual(["squat", "bench"]);
    expect(lifts[0]).toMatchObject({
      name: "Squat",
      weightKg: 120,
      reps: 7,
      startedAt: at(26),
      isRecord: false,
    });
    expect(lifts[0]!.oneRepMaxKg).toBeCloseTo(148);
    // 95 × 5 (110.8) beats 90 × 3 (99); 12 reps can't be estimated.
    expect(lifts[1]).toMatchObject({ weightKg: 95, reps: 5 });
  });

  it("marks lifts with a record inside the window in gold", () => {
    const lifts = topLifts(
      [s1],
      [record("squat", at(26)), record("bench", at(1))],
      new Date(2026, 9, 23),
    );
    expect(lifts.find((l) => l.exerciseId === "squat")!.isRecord).toBe(true);
    expect(lifts.find((l) => l.exerciseId === "bench")!.isRecord).toBe(false);
  });

  it("skips substituted and skipped exercises and keeps the top five", () => {
    const sub = session("c", at(28), { bench: [[300, 1]] });
    sub.exercises[0]!.isSubstituted = true;
    const skipped = session("d", at(28), { squat: [[300, 1]] });
    skipped.exercises[0]!.skipped = true;
    expect(topLifts([sub, skipped], [], NOW)).toEqual([]);
    const many = session("e", at(28), {
      a: [[10, 1]],
      b: [[20, 1]],
      c: [[30, 1]],
      d: [[40, 1]],
      e: [[50, 1]],
      f: [[60, 1]],
    });
    expect(topLifts([many], [], NOW).map((l) => l.exerciseId)).toEqual([
      "f",
      "e",
      "d",
      "c",
      "b",
    ]);
  });
});

describe("monthCells", () => {
  it("lays out a month Monday first, padded to whole weeks", () => {
    // October 2026 starts on a Thursday: three blanks first.
    const cells = monthCells(2026, 9, new Set(["2026-10-26"]), NOW);
    expect(cells).toHaveLength(35);
    expect(cells.slice(0, 3).every((c) => c.day === null)).toBe(true);
    expect(cells[3]).toMatchObject({ day: 1, key: "2026-10-01" });
    expect(cells.find((c) => c.day === 26)!.logged).toBe(true);
    expect(cells.find((c) => c.day === 25)!.logged).toBe(false);
    expect(cells.find((c) => c.day === 29)!.future).toBe(false);
    expect(cells.find((c) => c.day === 30)!.future).toBe(true);
    expect(cells.slice(-1)[0]!.day).toBeNull();
  });

  it("needs no padding when a month starts on Monday and fills weeks", () => {
    // February 2021: 1 Feb is a Monday, 28 days.
    const cells = monthCells(2021, 1, new Set(), NOW);
    expect(cells).toHaveLength(28);
    expect(cells[0]!.day).toBe(1);
  });
});

describe("historyDay", () => {
  const morning = session("a", at(26, 7, 10), {
    bench: [
      [95, 5],
      [95, 5],
    ],
  });
  const evening = session("b", at(26, 18, 30), { plank: [[null, 60]] });
  const other = session("c", at(25), { squat: [[100, 5]] });

  it("collects the day's workouts in time order with their records", () => {
    const day = historyDay(
      "2026-10-26",
      [evening, other, morning],
      [record("bench", at(26), { sessionId: "a" })],
      musclesOf,
    );
    expect(day.workouts.map((w) => w.name)).toEqual(["Workout a", "Workout b"]);
    expect(day.workouts[0]!.records).toBe(1);
    expect(day.workouts[1]!.records).toBe(0);
    expect(day.totals.workouts).toBe(2);
    expect(day.totals.volumeKg).toBe(950);
    expect(day.muscles.find((r) => r.group === "chest")!.credit).toBe(2);
    expect(day.muscles.find((r) => r.group === "core")!.credit).toBe(1);
  });

  it("is a rest day with no workouts", () => {
    const day = historyDay("2026-10-24", [morning], [], musclesOf);
    expect(day.workouts).toEqual([]);
    expect(day.totals.workouts).toBe(0);
    expect(day.muscles.every((r) => r.credit === 0)).toBe(true);
  });
});

describe("recap windows", () => {
  it("runs the week from Monday, the month from the 1st, 3 months back", () => {
    expect(dayKey(recapWindow("week", NOW).from)).toBe("2026-10-26");
    expect(dayKey(recapWindow("month", NOW).from)).toBe("2026-10-01");
    expect(dayKey(recapWindow("3months", NOW).from)).toBe("2026-08-01");
    // A Sunday belongs to the week that started the Monday before.
    expect(dayKey(recapWindow("week", new Date(2026, 10, 1)).from)).toBe(
      "2026-10-26",
    );
  });

  it("compares with the window just before", () => {
    const w = previousRecapWindow("week", NOW);
    expect(dayKey(w.from)).toBe("2026-10-19");
    expect(dayKey(w.to)).toBe("2026-10-25");
    expect(dayKey(previousRecapWindow("month", NOW).from)).toBe("2026-09-01");
    const q = previousRecapWindow("3months", NOW);
    expect(dayKey(q.from)).toBe("2026-05-01");
    expect(dayKey(q.to)).toBe("2026-07-31");
  });
});

describe("buildRecap", () => {
  const thisWeek = session(
    "a",
    at(27),
    {
      squat: [
        [100, 5],
        [100, 5],
      ],
      bench: [[80, 5]],
      plank: [[null, 60]],
    },
    { together: { sessionId: "t1", executionId: "x" } },
  );
  const lastWeek = session("b", at(20), { squat: [[100, 5]] });
  const records = [
    record("squat", at(27)),
    record("bench", at(28)),
    record("bench", at(1)),
  ];

  it("builds every page from the window's workouts", () => {
    const r = buildRecap({
      period: "week",
      now: NOW,
      sessions: [thisWeek, lastWeek],
      records,
      musclesOf,
      partners: new Map([["a", ["Tom", "Priya"]]]),
    });
    expect(r.totals.workouts).toBe(1);
    expect(r.previous.workouts).toBe(1);
    expect(r.volume).toEqual([
      { exerciseId: "squat", name: "Squat", volumeKg: 1000 },
      { exerciseId: "bench", name: "Bench", volumeKg: 400 },
    ]);
    expect(r.lifts.map((l) => l.exerciseId)).toEqual(["squat", "bench"]);
    expect(r.lifts.every((l) => l.isRecord)).toBe(true);
    expect(r.records.map((x) => x.exerciseId)).toEqual(["bench", "squat"]);
    expect(r.together).toEqual({ sessions: 1, names: ["Tom", "Priya"] });
    expect(r.muscles.find((m) => m.group === "quads")!.credit).toBe(2);
  });

  it("sums volume for an exercise across workouts", () => {
    const again = session("c", at(28), { squat: [[100, 5]] });
    const r = buildRecap({
      period: "month",
      now: NOW,
      sessions: [thisWeek, again, lastWeek],
      records: [],
      musclesOf,
    });
    expect(r.totals.workouts).toBe(3);
    expect(r.volume[0]).toEqual({
      exerciseId: "squat",
      name: "Squat",
      volumeKg: 2000,
    });
    expect(r.together).toEqual({ sessions: 1, names: [] });
  });

  it("is empty for a new user", () => {
    const r = buildRecap({
      period: "3months",
      now: NOW,
      sessions: [],
      records: [],
      musclesOf,
    });
    expect(r.totals.workouts).toBe(0);
    expect(r.lifts).toEqual([]);
    expect(r.volume).toEqual([]);
    expect(r.records).toEqual([]);
    expect(r.together).toEqual({ sessions: 0, names: [] });
  });
});

describe("date-only days (Inspector Brad #541)", () => {
  // `new Date("2026-06-10")` is UTC midnight: the 9th west of Greenwich.
  // These hold in every zone; run with TZ=America/New_York to see the trap.
  it("reads YYYY-MM-DD as that local calendar day", () => {
    expect(dayKey("2026-06-10")).toBe("2026-06-10");
    expect(toLocalDate("2026-06-10").getTime()).toBe(
      new Date(2026, 5, 10, 12).getTime(),
    );
  });

  it("still converts instants to the local day", () => {
    const instant = new Date(2026, 5, 10, 23, 30).toISOString();
    expect(dayKey(instant)).toBe("2026-06-10");
    expect(toLocalDate(instant).toISOString()).toBe(instant);
  });
});
