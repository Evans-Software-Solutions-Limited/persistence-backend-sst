import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  hasIntensityMismatch,
  LOADABLE_EQUIPMENT_NAMES,
  STRENGTH_RANGE_MAX_REPS,
} from "../intensityMismatch";
import type { AdaptationCandidate } from "../../../repositories/exerciseRepository";

// AC-3.5b. The E2 dataset measured this on 10 of 171 swaps, all in the
// `bands_only` context, where the exercise choice was CORRECT and the
// prescription was still unusable.

const BARBELL = "eq-barbell";
const CABLE = "eq-cable";
const BANDS = "eq-bands";
const BENCH = "eq-bench";

const LOADABLE = new Set([BARBELL, CABLE]);

function exercise(equipmentRequired: string[]): AdaptationCandidate {
  return {
    id: `ex-${equipmentRequired.join("-") || "bodyweight"}`,
    name: "Exercise",
    category: "strength",
    difficultyLevel: "intermediate",
    movementType: null,
    primaryMuscles: ["m1"],
    secondaryMuscles: [],
    equipmentRequired,
    thumbnailUrl: null,
  };
}

const strengthRow = { targetRepsMax: 5, targetDurationSeconds: null };

describe("hasIntensityMismatch", () => {
  it("flags a strength row that loses every loadable equipment type", () => {
    // The measured case: `Barbell Deadlift 4×4-6 → Band Good Morning 4×4-6`.
    expect(
      hasIntensityMismatch(
        strengthRow,
        exercise([BARBELL]),
        exercise([BANDS]),
        LOADABLE,
      ),
    ).toBe(true);
  });

  it("flags a strength row swapped onto pure bodyweight", () => {
    // 1 of the measured 10 landed on bodyweight rather than bands.
    expect(
      hasIntensityMismatch(
        strengthRow,
        exercise([BARBELL]),
        exercise([]),
        LOADABLE,
      ),
    ).toBe(true);
  });

  it("does NOT flag a swap that keeps a loadable type", () => {
    expect(
      hasIntensityMismatch(
        strengthRow,
        exercise([BARBELL]),
        exercise([CABLE]),
        LOADABLE,
      ),
    ).toBe(false);
  });

  it("does NOT flag a hypertrophy-range row", () => {
    expect(
      hasIntensityMismatch(
        {
          targetRepsMax: STRENGTH_RANGE_MAX_REPS + 1,
          targetDurationSeconds: null,
        },
        exercise([BARBELL]),
        exercise([BANDS]),
        LOADABLE,
      ),
    ).toBe(false);
  });

  it("includes the boundary rep count itself", () => {
    expect(
      hasIntensityMismatch(
        { targetRepsMax: STRENGTH_RANGE_MAX_REPS, targetDurationSeconds: null },
        exercise([BARBELL]),
        exercise([BANDS]),
        LOADABLE,
      ),
    ).toBe(true);
  });

  it("does NOT flag when the SOURCE had no load to lose", () => {
    // A bodyweight 5×5 stays a bodyweight 5×5 — nothing was lost, so there is
    // nothing to warn about. Without this condition every low-rep bodyweight row
    // swapped for another bodyweight row would be flagged.
    expect(
      hasIntensityMismatch(
        strengthRow,
        exercise([BENCH]),
        exercise([BANDS]),
        LOADABLE,
      ),
    ).toBe(false);
  });

  it("does NOT flag a DURATION-prescribed row", () => {
    // `TARGET_REPS_DEFAULT` is 1, so a plank prescribed as `3 × 45 s` stores
    // targetRepsMax = 1 and satisfies "reps ≤ 6". Without the duration guard,
    // every timed row swapped off a machine would be reported as a strength
    // mismatch. The E2 corpus was all rep ranges, so this case is not in the
    // measured 10/171 and is guarded here instead.
    expect(
      hasIntensityMismatch(
        { targetRepsMax: 1, targetDurationSeconds: 45 },
        exercise([CABLE]),
        exercise([BANDS]),
        LOADABLE,
      ),
    ).toBe(false);
  });

  it("is inert — never true — when no loadable ids resolved", () => {
    // The handler logs a warning in this state precisely because a check that
    // cannot fire reads as a pass.
    expect(
      hasIntensityMismatch(
        strengthRow,
        exercise([BARBELL]),
        exercise([BANDS]),
        new Set(),
      ),
    ).toBe(false);
  });
});

describe("LOADABLE_EQUIPMENT_NAMES", () => {
  // The set is resolved by NAME against `equipment_types`, so a rename in the
  // catalogue would silently make AC-3.5b un-fireable. CI never executes SQL, so
  // this file's own migration is the only available source of truth.
  function migrationSql(): string {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 12; i++) {
      const candidate = resolve(
        dir,
        "supabase/migrations/20260726120300_equipment_types_category.sql",
      );
      if (existsSync(candidate)) return readFileSync(candidate, "utf8");
      dir = resolve(dir, "..");
    }
    throw new Error("Could not locate the equipment_types category migration");
  }

  it("names only equipment that exists in the seeded catalogue", () => {
    const sql = migrationSql();
    for (const name of LOADABLE_EQUIPMENT_NAMES) {
      expect(sql, `${name} is not an equipment_types row`).toContain(
        `'${name}'`,
      );
    }
  });

  it("excludes the kit that cannot express a 4-6 rep strength set", () => {
    // The narrowing design § 7.1b requires: the original sketch included
    // Kettlebell and Medicine Ball, and a barbell hinge swapped onto a 5 kg med
    // ball would have passed the check. Bench and Squat Rack hold a load rather
    // than being one.
    for (const excluded of [
      "Kettlebell",
      "Medicine Ball",
      "Bench",
      "Squat Rack",
      "Resistance Bands",
      "Bodyweight",
      "Yoga Mat",
      "Battle Ropes",
      "Treadmill",
    ]) {
      expect(LOADABLE_EQUIPMENT_NAMES as readonly string[]).not.toContain(
        excluded,
      );
    }
  });

  it("covers every loadable family: free weights, machines, cables and the sled", () => {
    const names = LOADABLE_EQUIPMENT_NAMES as readonly string[];
    expect(names).toContain("Barbell");
    expect(names).toContain("Dumbbells");
    expect(names).toContain("EZ Bar");
    expect(names).toContain("Smith Machine");
    expect(names).toContain("Cable Machine");
    expect(names).toContain("Sled");
  });
});
