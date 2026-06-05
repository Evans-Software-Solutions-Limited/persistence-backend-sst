import type { Exercise, CreateExerciseInput } from "@/domain/models/exercise";
import {
  filterExercises,
  scoreExercise,
  tokenizeSearch,
  validateExerciseInput,
} from "../exercise.service";

// -- Test fixtures --

function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: "ex-1",
    name: "Bench Press",
    description: "Barbell chest press on a flat bench",
    instructions: null,
    category: "strength",
    difficulty: "intermediate",
    primaryMuscleGroups: ["chest"],
    secondaryMuscleGroups: ["triceps", "shoulders"],
    equipment: ["barbell"],
    videoUrl: null,
    thumbnailUrl: null,
    isCustom: false,
    createdBy: null,
    ...overrides,
  };
}

const EXERCISES: Exercise[] = [
  makeExercise({
    id: "ex-1",
    name: "Bench Press",
    description: "Barbell chest press on a flat bench",
    category: "strength",
    difficulty: "intermediate",
    primaryMuscleGroups: ["chest"],
    secondaryMuscleGroups: ["triceps", "shoulders"],
    equipment: ["barbell"],
  }),
  makeExercise({
    id: "ex-2",
    name: "Incline Dumbbell Press",
    description: "Dumbbell press on an incline bench targeting upper chest",
    category: "strength",
    difficulty: "intermediate",
    primaryMuscleGroups: ["chest", "shoulders"],
    secondaryMuscleGroups: ["triceps"],
    equipment: ["dumbbell"],
  }),
  makeExercise({
    id: "ex-3",
    name: "Pull Up",
    description: "Bodyweight vertical pull",
    category: "strength",
    difficulty: "advanced",
    primaryMuscleGroups: ["back", "lats"],
    secondaryMuscleGroups: ["biceps", "forearms"],
    equipment: ["bodyweight"],
  }),
  makeExercise({
    id: "ex-4",
    name: "Running",
    description: "Steady-state cardio on a treadmill or outdoors",
    category: "cardio",
    difficulty: "beginner",
    primaryMuscleGroups: ["quadriceps", "hamstrings", "calves"],
    secondaryMuscleGroups: ["core", "glutes"],
    equipment: ["bodyweight"],
  }),
  makeExercise({
    id: "ex-5",
    name: "Cable Fly",
    description: "Cable crossover chest fly",
    category: "strength",
    difficulty: "beginner",
    primaryMuscleGroups: ["chest"],
    secondaryMuscleGroups: ["shoulders"],
    equipment: ["cable"],
  }),
  makeExercise({
    id: "ex-6",
    name: "Kettlebell Swing",
    description: "Hip-hinge explosive swing",
    category: "strength",
    difficulty: "intermediate",
    primaryMuscleGroups: ["glutes", "hamstrings"],
    secondaryMuscleGroups: ["core", "shoulders"],
    equipment: ["kettlebell"],
  }),
  makeExercise({
    id: "ex-7",
    name: "Close-Grip Bench Press",
    description: "Narrow grip bench press for triceps emphasis",
    category: "strength",
    difficulty: "intermediate",
    primaryMuscleGroups: ["triceps"],
    secondaryMuscleGroups: ["chest", "shoulders"],
    equipment: ["barbell"],
  }),
];

// -- scoreExercise --

describe("scoreExercise", () => {
  const exercise = makeExercise({
    name: "Bench Press",
    description: "Barbell chest press on a flat bench",
  });

  it("scores 4 for exact name match (case-insensitive)", () => {
    expect(scoreExercise(exercise, "bench press")).toBe(4);
    expect(scoreExercise(exercise, "BENCH PRESS")).toBe(4);
    expect(scoreExercise(exercise, "Bench Press")).toBe(4);
    expect(scoreExercise(exercise, "bEnCh PrEsS")).toBe(4);
  });

  it("scores 3 when a token prefixes the first name word (legacy-style start match)", () => {
    expect(scoreExercise(exercise, "bench")).toBe(3);
    expect(scoreExercise(exercise, "BENCH")).toBe(3);
  });

  it("scores 3 when a token prefixes any name word — fixes 'press bench' style queries", () => {
    // Under the new tokenised scorer, 'press' matches the *second* word of
    // 'Bench Press' because it prefixes that word. Out-of-order multi-token
    // queries land here too — 'press bench' AND-matches both word-prefixes.
    expect(scoreExercise(exercise, "press")).toBe(3);
    expect(scoreExercise(exercise, "press bench")).toBe(3);
  });

  it("scores 2 for mid-word substring match (no word-prefix match)", () => {
    // 'ench' is inside 'bench' but isn't a prefix of any word — tier-3
    // fails, tier-2 (substring anywhere in name) succeeds.
    expect(scoreExercise(exercise, "ench")).toBe(2);
  });

  it("scores 2 for partial-word prefix that mid-word matches another token (AND)", () => {
    // 'benc' prefixes 'bench' → tier-3 candidate. Single token, all-pass.
    expect(scoreExercise(exercise, "benc")).toBe(3);
  });

  it("scores 1 for description contains (case-insensitive)", () => {
    expect(scoreExercise(exercise, "flat")).toBe(1);
    expect(scoreExercise(exercise, "FLAT")).toBe(1);
  });

  it("scores 0 for no match", () => {
    expect(scoreExercise(exercise, "squat")).toBe(0);
  });

  it("scores 0 when description is null and name doesn't match", () => {
    const noDesc = makeExercise({ description: null });
    expect(scoreExercise(noDesc, "flat")).toBe(0);
  });

  it("scores 0 for empty search term (no false-positive startsWith)", () => {
    // Guard against String.prototype.startsWith("") === true quirk
    expect(scoreExercise(exercise, "")).toBe(0);
  });

  it("scores 0 for whitespace-only search term", () => {
    expect(scoreExercise(exercise, "   ")).toBe(0);
    expect(scoreExercise(exercise, "\t\n")).toBe(0);
  });

  it("trims whitespace around a valid term before scoring", () => {
    expect(scoreExercise(exercise, "  bench press  ")).toBe(4);
    expect(scoreExercise(exercise, " bench ")).toBe(3);
  });

  it("tier-1 description fallback requires every token to appear somewhere", () => {
    const fixture = makeExercise({
      name: "Romanian Deadlift",
      description: "Hip-hinge pattern with a barbell, slight knee bend",
    });
    // 'barbell' in description, 'knee' in description → both present → tier 1
    expect(scoreExercise(fixture, "barbell knee")).toBe(1);
    // 'barbell' present, 'zebra' absent → at least one miss → 0
    expect(scoreExercise(fixture, "barbell zebra")).toBe(0);
  });

  it("hyphenated input tokenises into two terms (port parity with backend toPrefixTsQuery)", () => {
    // 'bench-press' → ['bench', 'press']. Against name 'Bench Press' both
    // are word-prefixes → tier 3.
    expect(scoreExercise(exercise, "bench-press")).toBe(3);
  });
});

describe("tokenizeSearch", () => {
  it("splits on whitespace and lowercases", () => {
    expect(tokenizeSearch("Press Bench")).toEqual(["press", "bench"]);
  });

  it("returns empty array on empty / whitespace-only input", () => {
    expect(tokenizeSearch("")).toEqual([]);
    expect(tokenizeSearch("   \t\n")).toEqual([]);
  });

  it("strips punctuation under the same allowlist as the backend tokeniser", () => {
    expect(tokenizeSearch("bench-press")).toEqual(["bench", "press"]);
    expect(tokenizeSearch("hello, world!")).toEqual(["hello", "world"]);
    expect(tokenizeSearch("&|!:*()")).toEqual([]);
  });

  it("preserves digits inside tokens", () => {
    expect(tokenizeSearch("5x5 squat")).toEqual(["5x5", "squat"]);
  });
});

// -- filterExercises --

describe("filterExercises", () => {
  describe("search", () => {
    it("returns all exercises when no filters provided", () => {
      const result = filterExercises(EXERCISES, {});
      expect(result).toHaveLength(EXERCISES.length);
    });

    it("orders the no-search result alphabetically by name (legacy parity)", () => {
      const names = filterExercises(EXERCISES, {}).map((e) => e.name);
      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sorted);
    });

    it("sorts a freshly-appended custom into its alphabetical place, not the bottom", () => {
      const base = filterExercises(EXERCISES, {});
      const custom = {
        ...base[0],
        id: "local-new",
        name: "Aaa First Custom",
        isCustom: true,
        createdBy: "me",
      };
      // Append at the end (mirrors SQLite insertion order for a new row).
      const result = filterExercises([...EXERCISES, custom], {});
      expect(result[0].id).toBe("local-new");
      // And it surfaces under the "Mine" filter.
      const mine = filterExercises([...EXERCISES, custom], {
        createdBy: "mine",
      });
      expect(mine.map((e) => e.id)).toContain("local-new");
    });

    it("returns all exercises with empty search string", () => {
      const result = filterExercises(EXERCISES, { search: "" });
      expect(result).toHaveLength(EXERCISES.length);
    });

    it("returns all exercises with whitespace-only search", () => {
      const result = filterExercises(EXERCISES, { search: "   " });
      expect(result).toHaveLength(EXERCISES.length);
    });

    it("filters by name match", () => {
      const result = filterExercises(EXERCISES, { search: "pull up" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("ex-3");
    });

    it("filters by description match", () => {
      const result = filterExercises(EXERCISES, { search: "treadmill" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("ex-4");
    });

    it("is case-insensitive", () => {
      const result = filterExercises(EXERCISES, { search: "BENCH" });
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("ranks exact name match above partial match", () => {
      const result = filterExercises(EXERCISES, { search: "bench press" });
      expect(result[0].id).toBe("ex-1"); // exact "Bench Press"
      // Close-Grip Bench Press should come after
      expect(result.some((e) => e.id === "ex-7")).toBe(true);
    });

    it("ranks name starts-with above name contains", () => {
      const result = filterExercises(EXERCISES, { search: "bench" });
      // "Bench Press" (starts-with) should be before "Close-Grip Bench Press" (contains)
      const benchIdx = result.findIndex((e) => e.id === "ex-1");
      const closeGripIdx = result.findIndex((e) => e.id === "ex-7");
      expect(benchIdx).toBeLessThan(closeGripIdx);
    });

    it("sorts alphabetically within the same relevance tier", () => {
      const exercises = [
        makeExercise({ id: "a", name: "Zottman Curl", description: null }),
        makeExercise({ id: "b", name: "Alternating Curl", description: null }),
      ];
      const result = filterExercises(exercises, { search: "curl" });
      expect(result[0].name).toBe("Alternating Curl");
      expect(result[1].name).toBe("Zottman Curl");
    });

    it("finds out-of-order multi-token queries — 'press bench' finds Bench Press", () => {
      // This is the staging-reported failure that triggered the FTS work.
      const result = filterExercises(EXERCISES, { search: "press bench" });
      const benchIdx = result.findIndex((e) => e.id === "ex-1");
      expect(benchIdx).toBeGreaterThanOrEqual(0);
    });

    it("finds partial-word matches — 'benc' finds Bench Press", () => {
      const result = filterExercises(EXERCISES, { search: "benc" });
      expect(result.some((e) => e.id === "ex-1")).toBe(true);
    });

    it("AND-matches all tokens — every query token must appear somewhere", () => {
      // 'pull bodyweight': 'pull' in name 'Pull Up' OR desc 'Bodyweight pull';
      // 'bodyweight' in desc. Both present → tier 1 match for ex-3.
      const result = filterExercises(EXERCISES, { search: "pull bodyweight" });
      expect(result.some((e) => e.id === "ex-3")).toBe(true);
      // 'pull treadmill': 'pull' matches ex-3's name+desc, 'treadmill' only
      // matches ex-4's desc. No row has both → 0 results.
      const noMatch = filterExercises(EXERCISES, {
        search: "pull treadmill",
      });
      expect(noMatch).toHaveLength(0);
    });
  });

  describe("category filter", () => {
    it("filters by category", () => {
      const result = filterExercises(EXERCISES, { category: "cardio" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("ex-4");
    });

    it("returns empty when no exercises match category", () => {
      const result = filterExercises(EXERCISES, { category: "olympic" });
      expect(result).toHaveLength(0);
    });
  });

  describe("difficulty filter", () => {
    it("filters by a single difficulty", () => {
      const result = filterExercises(EXERCISES, {
        difficulties: ["beginner"],
      });
      expect(result).toHaveLength(2); // Running + Cable Fly
    });

    it("OR-matches across multiple difficulties", () => {
      const result = filterExercises(EXERCISES, {
        difficulties: ["beginner", "advanced"],
      });
      // beginner ×2 + advanced ×1 (Pull Up) = 3
      expect(result).toHaveLength(3);
    });

    it("returns empty when no exercises match difficulty", () => {
      const result = filterExercises(EXERCISES, {
        difficulties: ["expert"],
      });
      expect(result).toHaveLength(0);
    });

    it("ignores an empty difficulties array", () => {
      const result = filterExercises(EXERCISES, { difficulties: [] });
      expect(result).toHaveLength(EXERCISES.length);
    });
  });

  describe("createdBy filter", () => {
    it("'mine' returns only custom (user-created) exercises", () => {
      const EXTRA = [
        ...EXERCISES,
        {
          ...EXERCISES[0],
          id: "custom-1",
          name: "My Custom Lift",
          videoUrl: null,
          thumbnailUrl: null,
          isCustom: true,
          createdBy: "user-123",
        },
      ];
      const result = filterExercises(EXTRA, { createdBy: "mine" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("custom-1");
    });

    it("'system' returns only built-in exercises", () => {
      const EXTRA = [
        ...EXERCISES,
        {
          ...EXERCISES[0],
          id: "custom-1",
          name: "My Custom Lift",
          videoUrl: null,
          thumbnailUrl: null,
          isCustom: true,
          createdBy: "user-123",
        },
      ];
      const result = filterExercises(EXTRA, { createdBy: "system" });
      // all seeded EXERCISES default to isCustom: false
      expect(result.every((e) => !e.isCustom)).toBe(true);
      expect(result).toHaveLength(EXERCISES.length);
    });
  });

  describe("muscle group filter", () => {
    it("matches primary muscle groups", () => {
      const result = filterExercises(EXERCISES, {
        muscleGroups: ["back"],
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("ex-3");
    });

    it("does NOT match secondary muscle groups (primary-only contract)", () => {
      // Pull Up has biceps as a SECONDARY muscle — no exercise in
      // the fixture lists biceps as primary, so the result must be
      // empty. Keeps server and client filters in lock-step and
      // matches user expectation ("filter by X = exercises whose
      // primary target is X").
      const result = filterExercises(EXERCISES, {
        muscleGroups: ["biceps"],
      });
      expect(result).toHaveLength(0);
    });

    it("matches any of multiple muscle groups (OR logic, primary-only)", () => {
      const result = filterExercises(EXERCISES, {
        muscleGroups: ["chest", "back"],
      });
      // Primary-only: Bench Press, Incline DB Press, Pull Up, Cable Fly.
      // Close-Grip has chest as secondary so it does NOT count.
      expect(result).toHaveLength(4);
    });

    it("returns empty when no exercises match muscle groups", () => {
      const result = filterExercises(EXERCISES, {
        muscleGroups: ["adductors"],
      });
      expect(result).toHaveLength(0);
    });

    it("treats null muscle arrays as empty (defensive — legacy cached rows)", () => {
      // Simulates a cached row whose primary/secondary muscles were
      // stored as null instead of []. Without the defensive `?? []`
      // guard, `.includes()` would throw and the entire list would
      // empty out — masquerading as "the filter is broken".
      const exotic = makeExercise({
        id: "ex-null",
        name: "Ghost",
        primaryMuscleGroups: null as unknown as never,
        secondaryMuscleGroups: null as unknown as never,
      });
      const result = filterExercises([exotic, ...EXERCISES], {
        muscleGroups: ["chest"],
      });
      // The null row is filtered out (no match), but the call doesn't
      // throw and the remaining chest exercises still come back.
      expect(result.find((e) => e.id === "ex-null")).toBeUndefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it("treats null equipment array as empty", () => {
      const exotic = makeExercise({
        id: "ex-null-eq",
        name: "Ghost Equipment",
        equipment: null as unknown as never,
      });
      const result = filterExercises([exotic, ...EXERCISES], {
        equipment: ["barbell"],
      });
      expect(result.find((e) => e.id === "ex-null-eq")).toBeUndefined();
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("equipment filter", () => {
    it("filters by single equipment type", () => {
      const result = filterExercises(EXERCISES, {
        equipment: ["cable"],
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("ex-5");
    });

    it("matches any of multiple equipment types (OR logic)", () => {
      const result = filterExercises(EXERCISES, {
        equipment: ["barbell", "dumbbell"],
      });
      expect(result).toHaveLength(3); // Bench, Incline DB, Close-Grip
    });

    it("returns empty when no exercises match equipment", () => {
      const result = filterExercises(EXERCISES, {
        equipment: ["smith_machine"],
      });
      expect(result).toHaveLength(0);
    });
  });

  describe("combined filters", () => {
    it("combines search + category", () => {
      const result = filterExercises(EXERCISES, {
        search: "press",
        category: "strength",
      });
      // "Bench Press", "Incline Dumbbell Press", "Close-Grip Bench Press" are strength
      expect(result).toHaveLength(3);
    });

    it("combines category + difficulty", () => {
      const result = filterExercises(EXERCISES, {
        category: "strength",
        difficulties: ["beginner"],
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("ex-5"); // Cable Fly
    });

    it("combines category + muscle group + equipment", () => {
      const result = filterExercises(EXERCISES, {
        category: "strength",
        muscleGroups: ["chest"],
        equipment: ["barbell"],
      });
      // Primary-only: Bench Press (primary chest, barbell). Close-Grip
      // has chest as secondary, so it falls out of the muscle filter.
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("ex-1");
    });

    it("returns empty when combined filters are too restrictive", () => {
      const result = filterExercises(EXERCISES, {
        category: "cardio",
        equipment: ["barbell"],
      });
      expect(result).toHaveLength(0);
    });

    it("preserves search ranking when combined with other filters", () => {
      const result = filterExercises(EXERCISES, {
        search: "bench",
        category: "strength",
      });
      // Both "Bench Press" and "Close-Grip Bench Press" are strength
      expect(result[0].id).toBe("ex-1"); // starts-with wins
    });
  });
});

// -- validateExerciseInput --

describe("validateExerciseInput", () => {
  function validInput(
    overrides: Partial<CreateExerciseInput> = {},
  ): CreateExerciseInput {
    return {
      name: "Bulgarian Split Squat",
      category: "strength",
      difficulty: "intermediate",
      primaryMuscleGroups: ["quadriceps", "glutes"],
      equipment: ["dumbbell"],
      ...overrides,
    };
  }

  describe("valid inputs", () => {
    it("accepts a valid complete input", () => {
      const result = validateExerciseInput(validInput());
      expect(result.ok).toBe(true);
    });

    it("accepts input with all optional fields", () => {
      const result = validateExerciseInput(
        validInput({
          description: "Single-leg squat variation",
          instructions: "Step back with one foot on a bench",
          secondaryMuscleGroups: ["hamstrings", "core"],
        }),
      );
      expect(result.ok).toBe(true);
    });

    it("accepts a 2-character name", () => {
      const result = validateExerciseInput(validInput({ name: "DB" }));
      expect(result.ok).toBe(true);
    });
  });

  describe("name validation", () => {
    it("rejects empty name", () => {
      const result = validateExerciseInput(validInput({ name: "" }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fields.name).toBe("Name is required");
      }
    });

    it("rejects whitespace-only name", () => {
      const result = validateExerciseInput(validInput({ name: "   " }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fields.name).toBe("Name is required");
      }
    });

    it("rejects 1-character name", () => {
      const result = validateExerciseInput(validInput({ name: "A" }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fields.name).toBe(
          "Name must be at least 2 characters",
        );
      }
    });
  });

  describe("category validation", () => {
    it("rejects invalid category", () => {
      const result = validateExerciseInput(
        validInput({ category: "invalid" as "strength" }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fields.category).toBe("Invalid category");
      }
    });

    it("accepts all valid categories", () => {
      const categories = [
        "strength",
        "cardio",
        "flexibility",
        "balance",
        "plyometric",
        "olympic",
        "mobility",
      ] as const;
      for (const category of categories) {
        const result = validateExerciseInput(validInput({ category }));
        expect(result.ok).toBe(true);
      }
    });
  });

  describe("difficulty validation", () => {
    it("rejects invalid difficulty", () => {
      const result = validateExerciseInput(
        validInput({ difficulty: "legendary" as "beginner" }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fields.difficulty).toBe("Invalid difficulty level");
      }
    });

    it("accepts all valid difficulties", () => {
      const difficulties = [
        "beginner",
        "intermediate",
        "advanced",
        "expert",
      ] as const;
      for (const difficulty of difficulties) {
        const result = validateExerciseInput(validInput({ difficulty }));
        expect(result.ok).toBe(true);
      }
    });
  });

  describe("muscle group validation", () => {
    it("rejects empty primary muscle groups", () => {
      const result = validateExerciseInput(
        validInput({ primaryMuscleGroups: [] }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fields.primaryMuscleGroups).toBe(
          "At least one primary muscle group is required",
        );
      }
    });

    it("rejects invalid primary muscle group", () => {
      const result = validateExerciseInput(
        validInput({
          primaryMuscleGroups: ["chest", "neck" as "chest"],
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fields.primaryMuscleGroups).toBe(
          "Invalid muscle group",
        );
      }
    });

    it("rejects invalid secondary muscle group", () => {
      const result = validateExerciseInput(
        validInput({
          secondaryMuscleGroups: ["spine" as "chest"],
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fields.secondaryMuscleGroups).toBe(
          "Invalid muscle group",
        );
      }
    });

    it("accepts empty secondary muscle groups", () => {
      const result = validateExerciseInput(
        validInput({ secondaryMuscleGroups: [] }),
      );
      expect(result.ok).toBe(true);
    });

    it("accepts undefined secondary muscle groups", () => {
      const input = validInput();
      delete input.secondaryMuscleGroups;
      const result = validateExerciseInput(input);
      expect(result.ok).toBe(true);
    });
  });

  describe("equipment validation", () => {
    it("rejects empty equipment list", () => {
      const result = validateExerciseInput(validInput({ equipment: [] }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fields.equipment).toBe(
          "At least one equipment type is required",
        );
      }
    });

    it("rejects invalid equipment type", () => {
      const result = validateExerciseInput(
        validInput({ equipment: ["barbell", "trx" as "barbell"] }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fields.equipment).toBe("Invalid equipment type");
      }
    });
  });

  describe("text length validation", () => {
    it("rejects instructions over 10,000 characters", () => {
      const result = validateExerciseInput(
        validInput({ instructions: "a".repeat(10001) }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fields.instructions).toBe(
          "Instructions must be under 10,000 characters",
        );
      }
    });

    it("accepts instructions at exactly 10,000 characters", () => {
      const result = validateExerciseInput(
        validInput({ instructions: "a".repeat(10000) }),
      );
      expect(result.ok).toBe(true);
    });

    it("rejects description over 5,000 characters", () => {
      const result = validateExerciseInput(
        validInput({ description: "a".repeat(5001) }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.fields.description).toBe(
          "Description must be under 5,000 characters",
        );
      }
    });

    it("accepts description at exactly 5,000 characters", () => {
      const result = validateExerciseInput(
        validInput({ description: "a".repeat(5000) }),
      );
      expect(result.ok).toBe(true);
    });
  });

  describe("multiple errors", () => {
    it("returns all field errors at once", () => {
      const result = validateExerciseInput({
        name: "",
        category: "bad" as "strength",
        difficulty: "bad" as "beginner",
        primaryMuscleGroups: [],
        equipment: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(Object.keys(result.error.fields)).toHaveLength(5);
        expect(result.error.fields.name).toBeDefined();
        expect(result.error.fields.category).toBeDefined();
        expect(result.error.fields.difficulty).toBeDefined();
        expect(result.error.fields.primaryMuscleGroups).toBeDefined();
        expect(result.error.fields.equipment).toBeDefined();
      }
    });

    it("returns validation error kind", () => {
      const result = validateExerciseInput(validInput({ name: "" }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("validation");
      }
    });
  });
});
