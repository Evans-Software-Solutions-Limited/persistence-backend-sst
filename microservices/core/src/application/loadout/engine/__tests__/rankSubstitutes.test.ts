import { describe, it, expect } from "vitest";
import { RANK_WEIGHTS, rankSubstitutes } from "../rankSubstitutes";
import type { AdaptationCandidate } from "../../../repositories/exerciseRepository";

// The § 6.2 ranker is the SHORTLISTER (design § 6.0), so what matters is which
// candidates survive and in what order — not the absolute scores. Every
// assertion below is about an ordering or a filter decision that would change
// the shortlist.

const CHEST = "muscle-chest";
const TRICEPS = "muscle-triceps";
const BACK = "muscle-back";
const CORE = "muscle-core";

const BARBELL = "eq-barbell";
const DUMBBELL = "eq-dumbbell";

function candidate(
  overrides: Partial<AdaptationCandidate> & { id: string; name: string },
): AdaptationCandidate {
  return {
    category: "strength",
    difficultyLevel: "intermediate",
    movementType: null,
    primaryMuscles: [CHEST],
    secondaryMuscles: [],
    equipmentRequired: [],
    thumbnailUrl: null,
    ...overrides,
  };
}

const source = candidate({
  id: "src",
  name: "Barbell Bench Press",
  primaryMuscles: [CHEST, TRICEPS],
  secondaryMuscles: [CORE],
  equipmentRequired: [BARBELL],
});

const noLogs = { loggedExerciseIds: new Set<string>() };

describe("rankSubstitutes — the hard filter", () => {
  it("drops candidates sharing NO primary muscle, rather than demoting them", () => {
    // The divergence from the orphaned `get_alternative_exercises`, which
    // returns incompatible rows with a −30 penalty. For an adaptation, a
    // candidate that works a different muscle is not a candidate.
    const ranked = rankSubstitutes(
      source,
      [
        candidate({ id: "a", name: "Barbell Row", primaryMuscles: [BACK] }),
        candidate({ id: "b", name: "Push-Up", primaryMuscles: [CHEST] }),
      ],
      noLogs,
    );

    expect(ranked.map((r) => r.candidate.id)).toEqual(["b"]);
  });

  it("never returns the source exercise as its own substitute", () => {
    const ranked = rankSubstitutes(source, [source], noLogs);
    expect(ranked).toEqual([]);
  });

  it("drops everything when the source records no primary movers", () => {
    // `overlapRatio` returns 0 for an empty source rather than NaN, so the hard
    // filter rejects every candidate instead of admitting all of them.
    const musclelessSource = candidate({
      id: "src2",
      name: "Mystery Lift",
      primaryMuscles: [],
    });

    const ranked = rankSubstitutes(
      musclelessSource,
      [candidate({ id: "a", name: "Push-Up" })],
      noLogs,
    );

    expect(ranked).toEqual([]);
  });
});

describe("rankSubstitutes — signal weighting", () => {
  it("ranks a FULL primary-muscle match above a partial one", () => {
    // Proportional rather than binary overlap: with a flat +50 these two would
    // tie and the ordering would fall to the name tiebreak, which is exactly
    // the signal loss the implementation note argues against.
    const ranked = rankSubstitutes(
      source,
      [
        candidate({
          id: "partial",
          name: "AAA Triceps Extension",
          primaryMuscles: [TRICEPS],
        }),
        candidate({
          id: "full",
          name: "ZZZ Dumbbell Bench Press",
          primaryMuscles: [CHEST, TRICEPS],
        }),
      ],
      noLogs,
    );

    // Name order would put "AAA…" first if the scores tied.
    expect(ranked.map((r) => r.candidate.id)).toEqual(["full", "partial"]);
  });

  it("counts a secondary-muscle overlap, and reports it in matchedOn", () => {
    const withSecondary = candidate({
      id: "with",
      name: "ZZZ With Core",
      secondaryMuscles: [CORE],
    });
    const withoutSecondary = candidate({
      id: "without",
      name: "AAA No Core",
      secondaryMuscles: [],
    });

    const ranked = rankSubstitutes(
      source,
      [withSecondary, withoutSecondary],
      noLogs,
    );

    expect(ranked.map((r) => r.candidate.id)).toEqual(["with", "without"]);
    expect(ranked[0].matchedOn).toContain("secondary_muscles");
    expect(ranked[1].matchedOn).not.toContain("secondary_muscles");
  });

  it("prefers the same difficulty, then the adjacent tier, then neither", () => {
    // Source is `beginner`, so the three candidates are gap 0 / 1 / 2 — the only
    // arrangement that separates all three tiers of the signal. Names are chosen
    // so that a broken implementation falling back to the name tiebreak would
    // produce the REVERSE order.
    const beginnerSource = candidate({
      id: "src-b",
      name: "Source",
      difficultyLevel: "beginner",
      primaryMuscles: [CHEST],
    });

    const ranked = rankSubstitutes(
      beginnerSource,
      [
        candidate({
          id: "far",
          name: "A Advanced",
          difficultyLevel: "advanced",
        }),
        candidate({
          id: "adjacent",
          name: "B Intermediate",
          difficultyLevel: "intermediate",
        }),
        candidate({
          id: "same",
          name: "C Beginner",
          difficultyLevel: "beginner",
        }),
      ],
      noLogs,
    );

    expect(ranked.map((r) => r.candidate.id)).toEqual([
      "same",
      "adjacent",
      "far",
    ]);
    expect(ranked[0].matchedOn).toContain("difficulty");
    // Adjacency deliberately does NOT surface in matchedOn — "close enough on
    // difficulty" is not worth telling the user, it only nudges the ordering.
    expect(ranked[1].matchedOn).not.toContain("difficulty");
  });

  it("scores nothing for difficulty when either side is null", () => {
    const ranked = rankSubstitutes(
      candidate({
        id: "src3",
        name: "Source",
        difficultyLevel: null,
        primaryMuscles: [CHEST],
      }),
      [
        candidate({ id: "a", name: "A", difficultyLevel: "beginner" }),
        candidate({ id: "b", name: "B", difficultyLevel: null }),
      ],
      noLogs,
    );

    for (const entry of ranked) {
      expect(entry.matchedOn).not.toContain("difficulty");
    }
    // Equal scores → name tiebreak, which proves neither got a difficulty bonus.
    expect(ranked.map((r) => r.candidate.id)).toEqual(["a", "b"]);
  });

  it("awards the pattern signal ONCE, preferring movement_type over category", () => {
    // Both signals matching must not score 10 twice. Compared against a
    // candidate that matches only category: if movement_type double-counted, the
    // first would outrank the second by 10 rather than tie it.
    const patternSource = candidate({
      id: "src4",
      name: "Source",
      movementType: "horizontal_push",
      primaryMuscles: [CHEST],
    });

    const ranked = rankSubstitutes(
      patternSource,
      [
        candidate({
          id: "both",
          name: "ZZZ Both",
          movementType: "horizontal_push",
          category: "strength",
        }),
        candidate({
          id: "categoryOnly",
          name: "AAA Category",
          movementType: "vertical_push",
          category: "strength",
        }),
      ],
      noLogs,
    );

    expect(ranked.map((r) => r.candidate.id)).toEqual(["categoryOnly", "both"]);
    expect(ranked[1].matchedOn).toContain("movement_type");
    expect(ranked[1].matchedOn).not.toContain("category");
    expect(ranked[0].matchedOn).toContain("category");
  });

  it("falls back to category when movement_type is null — the live-data case", () => {
    // `movement_type` is NULL for all 2281 seeded rows, so this branch is the
    // one that actually runs in production (design § 6.0).
    const ranked = rankSubstitutes(
      source,
      [
        candidate({ id: "same", name: "ZZZ Same", category: "strength" }),
        candidate({ id: "other", name: "AAA Other", category: "cardio" }),
      ],
      noLogs,
    );

    expect(ranked.map((r) => r.candidate.id)).toEqual(["same", "other"]);
    expect(ranked[0].matchedOn).toContain("category");
  });

  it("awards no pattern signal when the source category is null", () => {
    const ranked = rankSubstitutes(
      candidate({ id: "src5", name: "Source", category: null }),
      [candidate({ id: "a", name: "A", category: null })],
      noLogs,
    );

    expect(ranked[0].matchedOn).not.toContain("category");
    expect(ranked[0].matchedOn).not.toContain("movement_type");
  });

  it("breaks a tie on the +8 logged-before signal", () => {
    const ranked = rankSubstitutes(
      source,
      [
        candidate({ id: "unlogged", name: "AAA Unlogged" }),
        candidate({ id: "logged", name: "ZZZ Logged" }),
      ],
      { loggedExerciseIds: new Set(["logged"]) },
    );

    expect(ranked.map((r) => r.candidate.id)).toEqual(["logged", "unlogged"]);
    expect(ranked[0].matchedOn).toContain("logged_before");
  });

  it("breaks a genuine score tie on name ASC", () => {
    const ranked = rankSubstitutes(
      source,
      [
        candidate({ id: "z", name: "Zebra Press" }),
        candidate({ id: "a", name: "Alpha Press" }),
      ],
      noLogs,
    );

    expect(ranked.map((r) => r.candidate.id)).toEqual(["a", "z"]);
  });

  it("is NULL-safe on empty secondary muscles and equipment", () => {
    // The repository normalises both columns to `[]`; this asserts the ranker
    // survives that shape rather than needing the nullable original.
    const ranked = rankSubstitutes(
      candidate({
        id: "src6",
        name: "Source",
        secondaryMuscles: [],
        equipmentRequired: [],
      }),
      [
        candidate({
          id: "a",
          name: "A",
          secondaryMuscles: [],
          equipmentRequired: [],
        }),
      ],
      noLogs,
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0].matchedOn).not.toContain("secondary_muscles");
  });

  it("never re-checks equipment, so the picker can rank incompatible rows", () => {
    // § 6.4's `others` list ranks candidates the caller CANNOT perform, so the
    // ranker must be equipment-blind. Containment is stage 1's job.
    const ranked = rankSubstitutes(
      source,
      [
        candidate({
          id: "needs-kit",
          name: "Machine Press",
          equipmentRequired: [DUMBBELL, BARBELL],
        }),
      ],
      noLogs,
    );

    expect(ranked.map((r) => r.candidate.id)).toEqual(["needs-kit"]);
  });
});

describe("RANK_WEIGHTS", () => {
  it("keeps § 6.2's ordering of signal importance", () => {
    // The table's shape, not its literals: primary dominates, secondary is next,
    // same-difficulty beats adjacent, and every signal is positive.
    expect(RANK_WEIGHTS.primaryMuscles).toBeGreaterThan(
      RANK_WEIGHTS.secondaryMuscles,
    );
    expect(RANK_WEIGHTS.secondaryMuscles).toBeGreaterThan(
      RANK_WEIGHTS.sameDifficulty,
    );
    expect(RANK_WEIGHTS.sameDifficulty).toBeGreaterThan(
      RANK_WEIGHTS.adjacentDifficulty,
    );
    expect(RANK_WEIGHTS.samePattern).toBeGreaterThan(0);
    expect(RANK_WEIGHTS.loggedBefore).toBeGreaterThan(0);
  });
});
