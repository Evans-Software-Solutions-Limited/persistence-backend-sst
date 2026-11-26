import type {
  WorkoutExercise,
  WorkoutExerciseInput,
} from "@/domain/models/workout";
import {
  MAX_SETS,
  MAX_SET_REPS,
  clampReps,
  deriveFromSetReps,
  lastTimeHint,
  prescriptionSummary,
  rangeLabel,
  setCountLabel,
  setRepsOf,
  setTargetsAfterUpdate,
} from "@/domain/services/setTargets.service";

const cachedExercise = (
  overrides: Partial<WorkoutExercise> = {},
): WorkoutExercise => ({
  id: "we-1",
  exerciseId: "ex-1",
  sortOrder: 0,
  supersetGroup: null,
  targetSets: 3,
  targetRepsMin: 8,
  targetRepsMax: 10,
  targetDurationSeconds: null,
  restSeconds: 90,
  notes: null,
  setTargets: [{ reps: 10 }, { reps: 8 }, { reps: 8 }],
  exercise: null,
  ...overrides,
});

const input = (
  overrides: Partial<WorkoutExerciseInput> = {},
): WorkoutExerciseInput => ({
  exerciseId: "ex-1",
  sortOrder: 0,
  targetSets: 3,
  targetRepsMin: 8,
  targetRepsMax: 10,
  ...overrides,
});

describe("setTargets.service (PER-139)", () => {
  it("uses the shared API limits", () => {
    expect(MAX_SETS).toBe(20);
    expect(MAX_SET_REPS).toBe(100);
  });

  it("setRepsOf reads per-set reps, or null for the old range", () => {
    expect(setRepsOf({ setTargets: [{ reps: 10 }, { reps: 8 }] })).toEqual([
      10, 8,
    ]);
    expect(setRepsOf({ setTargets: [] })).toBeNull();
    expect(setRepsOf({ setTargets: null })).toBeNull();
    expect(setRepsOf({})).toBeNull();
  });

  it("derives the old columns: count, lowest, highest", () => {
    expect(deriveFromSetReps([10, 8, 8])).toEqual({
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 10,
    });
  });

  it("clamps reps to 1–100", () => {
    expect(clampReps(0)).toBe(1);
    expect(clampReps(101)).toBe(100);
    expect(clampReps(7.6)).toBe(8);
  });

  it("labels counts, ranges and the collapsed summary", () => {
    expect(setCountLabel(1)).toBe("1 set");
    expect(setCountLabel(3)).toBe("3 sets");
    expect(rangeLabel(8, 12)).toBe("8–12");
    expect(rangeLabel(10, 10)).toBe("10");
    expect(
      prescriptionSummary({
        setReps: [12, 10, 10],
        targetSets: 3,
        targetRepsMin: 10,
        targetRepsMax: 12,
      }),
    ).toBe("3 sets · 12, 10, 10");
    expect(
      prescriptionSummary({
        setReps: null,
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
      }),
    ).toBe("3 sets · 8–12 reps");
  });

  describe("setTargetsAfterUpdate (mirrors the server's rule)", () => {
    it("a list replaces, null drops, an empty list drops", () => {
      expect(
        setTargetsAfterUpdate(
          [
            input({ setTargets: [{ reps: 6 }] }),
            input({ setTargets: null }),
            input({ setTargets: [] }),
          ],
          [cachedExercise()],
        ),
      ).toEqual([[{ reps: 6 }], undefined, undefined]);
    });

    it("not sent: keeps the stored reps when the old columns still match", () => {
      expect(setTargetsAfterUpdate([input()], [cachedExercise()])).toEqual([
        [{ reps: 10 }, { reps: 8 }, { reps: 8 }],
      ]);
    });

    it("not sent: drops them when the range changed or the position moved", () => {
      expect(
        setTargetsAfterUpdate([input({ targetSets: 4 })], [cachedExercise()]),
      ).toEqual([undefined]);
      expect(
        setTargetsAfterUpdate([input({ sortOrder: 1 })], [cachedExercise()]),
      ).toEqual([undefined]);
      expect(
        setTargetsAfterUpdate(
          [input()],
          [cachedExercise({ setTargets: undefined })],
        ),
      ).toEqual([undefined]);
    });

    it("a repeated exercise at one position uses each stored list once", () => {
      expect(
        setTargetsAfterUpdate(
          [input(), input()],
          [
            cachedExercise(),
            cachedExercise({
              id: "we-2",
              setTargets: [{ reps: 8 }, { reps: 9 }, { reps: 10 }],
            }),
          ],
        ),
      ).toEqual([
        [{ reps: 10 }, { reps: 8 }, { reps: 8 }],
        [{ reps: 8 }, { reps: 9 }, { reps: 10 }],
      ]);
    });
  });

  describe("lastTimeHint", () => {
    it("is null for an exercise never logged", () => {
      expect(lastTimeHint({}, "kg")).toBeNull();
    });

    it("one weight: 'Last time 92.5 kg × 8, 6, 6, 5', in set order", () => {
      expect(
        lastTimeHint(
          {
            2: { weightKg: 92.5, reps: 6 },
            1: { weightKg: 92.5, reps: 8 },
            3: { weightKg: 92.5, reps: 6 },
            4: { weightKg: 92.5, reps: 5 },
          },
          "kg",
        ),
      ).toBe("Last time 92.5 kg × 8, 6, 6, 5");
    });

    it("different weights per set, in the user's unit", () => {
      expect(
        lastTimeHint(
          { 1: { weightKg: 100, reps: 5 }, 2: { weightKg: 90, reps: 8 } },
          "lb",
        ),
      ).toBe("Last time 220.5 lb × 5, 198.4 lb × 8");
    });

    it("bodyweight (no weight) shows reps only", () => {
      expect(
        lastTimeHint(
          { 1: { weightKg: 0, reps: 12 }, 2: { weightKg: 0, reps: 10 } },
          "kg",
        ),
      ).toBe("Last time 12, 10 reps");
    });
  });
});
