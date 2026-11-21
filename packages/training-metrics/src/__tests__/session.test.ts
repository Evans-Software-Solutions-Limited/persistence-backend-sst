import {
  CATALOGUE_NAME_FOR_KEY,
  estimateOneRepMax,
  exerciseVolumes,
  muscleKeyFromCatalogueName,
  MUSCLE_TO_GROUP,
  sessionTotals,
  topLifts,
  trainNextAndRest,
  windowMuscles,
  windowTotals,
  type TrainingSession,
} from "../index";
import {
  SEEDED_WEEK_EXPECTED,
  SEEDED_WEEK_RECORD_EXERCISE_IDS,
  SEEDED_WEEK_SESSIONS,
} from "../fixtures";

describe("shared seeded week (design H test 5)", () => {
  it("gives the expected totals", () => {
    expect(windowTotals(SEEDED_WEEK_SESSIONS)).toEqual(
      SEEDED_WEEK_EXPECTED.totals,
    );
  });

  it("gives the expected muscle rows", () => {
    const rows = windowMuscles(SEEDED_WEEK_SESSIONS).map(({ group, ...r }) => ({
      muscle: group,
      ...r,
    }));
    expect(rows).toEqual(SEEDED_WEEK_EXPECTED.muscles);
    const split = trainNextAndRest(windowMuscles(SEEDED_WEEK_SESSIONS));
    expect(split.trainNext.map((m) => m.group)).toEqual(
      SEEDED_WEEK_EXPECTED.trainNext,
    );
    expect(split.rest.map((m) => m.group)).toEqual(SEEDED_WEEK_EXPECTED.rest);
  });

  it("gives the expected top lifts", () => {
    expect(
      topLifts(
        SEEDED_WEEK_SESSIONS,
        new Set(SEEDED_WEEK_RECORD_EXERCISE_IDS),
      ).map((l) => ({
        exerciseId: l.exerciseId,
        oneRepMaxKg: l.oneRepMaxKg,
        isRecord: l.isRecord,
      })),
    ).toEqual(SEEDED_WEEK_EXPECTED.topLifts);
  });
});

const session = (over: Partial<TrainingSession>): TrainingSession => ({
  id: "s",
  name: "S",
  startedAt: "2026-11-16T07:00:00.000Z",
  completedAt: "2026-11-16T08:00:00.000Z",
  durationSeconds: null,
  exercises: [],
  ...over,
});

describe("sessionTotals", () => {
  it("uses the stored length when there is one", () => {
    expect(
      sessionTotals(session({ durationSeconds: 90 })).durationSeconds,
    ).toBe(90);
  });

  it("is 0 long when the workout has no finish", () => {
    expect(sessionTotals(session({ completedAt: null })).durationSeconds).toBe(
      0,
    );
  });

  it("never goes negative", () => {
    expect(
      sessionTotals(session({ completedAt: "2026-11-16T06:00:00.000Z" }))
        .durationSeconds,
    ).toBe(0);
  });
});

describe("topLifts and volumes", () => {
  const one = (id: string, w: number, reps: number, skipped = false) => ({
    exerciseId: id,
    name: id,
    isSubstituted: false,
    skipped,
    primary: ["chest"],
    secondary: [],
    sets: [{ id: `${id}-1`, isCompleted: true, reps, weightKg: w }],
  });

  it("leaves skipped exercises out of top lifts and muscle credit", () => {
    const s = session({ exercises: [one("a", 100, 5, true), one("b", 50, 5)] });
    expect(topLifts([s], new Set()).map((l) => l.exerciseId)).toEqual(["b"]);
    expect(windowMuscles([s]).find((m) => m.group === "chest")!.credit).toBe(1);
  });

  it("keeps the first set to reach a lift's best, oldest workout first", () => {
    const later = session({
      id: "later",
      startedAt: "2026-11-18T07:00:00.000Z",
      exercises: [one("a", 100, 5)],
    });
    const earlier = session({ id: "earlier", exercises: [one("a", 100, 5)] });
    const [lift] = topLifts([later, earlier], new Set());
    expect(lift!.startedAt).toBe(earlier.startedAt);
  });

  it("caps the list", () => {
    const s = session({
      exercises: ["a", "b", "c"].map((id, i) => one(id, 10 + i, 5)),
    });
    expect(topLifts([s], new Set(), 2).map((l) => l.exerciseId)).toEqual([
      "c",
      "b",
    ]);
  });

  it("sums weighted volume by exercise, largest first", () => {
    const s = session({
      exercises: [one("a", 10, 5), one("b", 30, 5), one("a", 10, 5)],
    });
    expect(exerciseVolumes([s, s])).toEqual([
      { exerciseId: "b", name: "b", volumeKg: 300 },
      { exerciseId: "a", name: "a", volumeKg: 200 },
    ]);
  });
});

describe("estimateOneRepMax", () => {
  it.each([
    [100, 1, 100],
    [100, 5, 100 * (1 + 5 / 30)],
    [100, 11, null],
    [0, 5, null],
    [100, 0, null],
    [100, 2.5, null],
    [Number.NaN, 5, null],
  ])("%p kg × %p → %p", (w, reps, out) => {
    expect(estimateOneRepMax(w, reps)).toBe(out);
  });
});

describe("catalogue names", () => {
  it.each([
    ["Abs", "core"],
    ["Obliques", "core"],
    ["Lower Back", "back"],
    [" hip flexors ", "hip_flexors"],
    ["Quadriceps", "quadriceps"],
    ["Full Body", null],
    [null, null],
    ["", null],
  ])("%p → %p", (name, key) => {
    expect(muscleKeyFromCatalogueName(name)).toBe(key);
  });

  it("round-trips every seedable key", () => {
    for (const [key, name] of Object.entries(CATALOGUE_NAME_FOR_KEY)) {
      expect(muscleKeyFromCatalogueName(name)).toBe(key);
      expect(MUSCLE_TO_GROUP[key]).toBeDefined();
    }
  });
});
