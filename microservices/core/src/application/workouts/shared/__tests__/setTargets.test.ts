import { describe, expect, it } from "vitest";
import {
  cloneSetTargets,
  deriveFromSetTargets,
  hasSetTargets,
  indexStoredSetTargets,
  matchesDerived,
  preservedSetTargets,
} from "../setTargets";
import { findInvalidRepRangeIndex } from "../schemas";

const reps = (...values: number[]) => values.map((r) => ({ reps: r }));

describe("deriveFromSetTargets", () => {
  it("gives 1.2.0's columns: the set count and the lowest / highest reps", () => {
    expect(deriveFromSetTargets(reps(10, 8, 8))).toEqual({
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 10,
    });
    // "Same reps for all" is just equal values.
    expect(deriveFromSetTargets(reps(12, 12))).toEqual({
      targetSets: 2,
      targetRepsMin: 12,
      targetRepsMax: 12,
    });
  });
});

describe("hasSetTargets / cloneSetTargets", () => {
  it("treats only a non-empty list as per-set targets", () => {
    expect(hasSetTargets(reps(5))).toBe(true);
    expect(hasSetTargets([])).toBe(false);
    expect(hasSetTargets(null)).toBe(false);
    expect(hasSetTargets(undefined)).toBe(false);
  });

  it("keeps only reps (no weight or stray keys reach storage)", () => {
    const sent = [{ reps: 8, weightKg: 100 }] as unknown as { reps: number }[];
    expect(cloneSetTargets(sent)).toEqual([{ reps: 8 }]);
  });
});

describe("the old-bundle preservation rule", () => {
  const stored = () =>
    indexStoredSetTargets([
      { exerciseId: "bench", sortOrder: 0, setTargets: reps(10, 8, 8) },
      { exerciseId: "row", sortOrder: 1, setTargets: [] },
    ]);

  it("matches only when the sets and range equal the derived values", () => {
    const set = reps(10, 8, 8);
    expect(
      matchesDerived(
        { targetSets: 3, targetRepsMin: 8, targetRepsMax: 10 },
        set,
      ),
    ).toBe(true);
    expect(
      matchesDerived(
        { targetSets: null, targetRepsMin: 8, targetRepsMax: 10 },
        set,
      ),
    ).toBe(false);
    expect(
      matchesDerived(
        { targetSets: 3, targetRepsMin: 8, targetRepsMax: 9 },
        set,
      ),
    ).toBe(false);
  });

  it("keeps the stored rows for the same exercise, position and values", () => {
    expect(
      preservedSetTargets(stored(), {
        exerciseId: "bench",
        sortOrder: 0,
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 10,
      }),
    ).toEqual(reps(10, 8, 8));
  });

  it("returns nothing for a row that never had per-set targets", () => {
    expect(
      preservedSetTargets(stored(), {
        exerciseId: "row",
        sortOrder: 1,
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
      }),
    ).toBeNull();
  });

  it("drops them when the prescription changed, and uses each stored entry once", () => {
    const index = stored();
    const changed = {
      exerciseId: "bench",
      sortOrder: 0,
      targetSets: 3,
      targetRepsMin: 6,
      targetRepsMax: 10,
    };
    expect(preservedSetTargets(index, changed)).toBeNull();
    // The entry was consumed: a second matching row can't claim it.
    expect(
      preservedSetTargets(index, { ...changed, targetRepsMin: 8 }),
    ).toBeNull();
  });
});

describe("findInvalidRepRangeIndex with per-set targets", () => {
  it("validates the derived range, not the sent one", () => {
    expect(
      findInvalidRepRangeIndex([
        {
          exerciseId: "bench",
          sortOrder: 0,
          targetRepsMin: 12,
          targetRepsMax: 6,
          setTargets: reps(6, 12),
        },
      ]),
    ).toBeNull();
    expect(
      findInvalidRepRangeIndex([
        { exerciseId: "bench", sortOrder: 0, setTargets: null },
        {
          exerciseId: "row",
          sortOrder: 1,
          targetRepsMin: 12,
          targetRepsMax: 6,
        },
      ]),
    ).toBe(1);
  });
});
