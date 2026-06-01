import type { Workout, WorkoutExercise } from "@/domain/models/workout";
import { classifyWorkoutSplit, SPLIT_BADGE } from "../workoutSplit";

let seq = 0;
const exercise = (exerciseId: string, category?: string): WorkoutExercise => ({
  id: `we-${seq++}`,
  exerciseId,
  sortOrder: 0,
  supersetGroup: null,
  targetSets: 3,
  targetRepsMin: 8,
  targetRepsMax: 12,
  targetDurationSeconds: null,
  restSeconds: 60,
  notes: null,
  exercise: category
    ? {
        id: exerciseId,
        name: exerciseId,
        category,
        difficultyLevel: "beginner",
        videoUrl: null,
        thumbnailUrl: null,
      }
    : null,
});

const workout = (exercises: WorkoutExercise[]): Workout => ({
  id: "wo-1",
  name: "Test",
  description: null,
  createdBy: "u",
  visibility: "private",
  estimatedDurationMinutes: 45,
  exercises,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

/** Build a getMuscleTokens lookup — tokens may be labels, enum keys, or
 * UUIDs (the classifier normalises them). */
const lookup =
  (map: Record<string, string[]>) =>
  (id: string): readonly string[] | undefined =>
    map[id];

describe("classifyWorkoutSplit", () => {
  it("returns null for an empty workout", () => {
    expect(classifyWorkoutSplit(workout([]), () => undefined)).toBeNull();
  });

  it("returns null when no muscle data is cached and no category majority", () => {
    const w = workout([exercise("e1"), exercise("e2")]);
    expect(classifyWorkoutSplit(w, () => undefined)).toBeNull();
  });

  it("classifies a cardio-majority workout as cardio (no cache needed)", () => {
    const w = workout([
      exercise("e1", "cardio"),
      exercise("e2", "cardio"),
      exercise("e3", "strength"),
    ]);
    expect(classifyWorkoutSplit(w, () => undefined)).toBe("cardio");
  });

  it("classifies a mobility-majority workout as mobility", () => {
    const w = workout([
      exercise("e1", "flexibility"),
      exercise("e2", "mobility"),
      exercise("e3", "strength"),
    ]);
    expect(classifyWorkoutSplit(w, () => undefined)).toBe("mobility");
  });

  it("does NOT override on a 50/50 cardio split (falls through to muscles)", () => {
    const w = workout([exercise("e1", "cardio"), exercise("e2", "strength")]);
    const muscles = lookup({ e1: [], e2: ["chest", "triceps"] });
    // e1 has no muscles → only e2 resolves → push-only.
    expect(classifyWorkoutSplit(w, muscles)).toBe("push");
  });

  it("classifies a push-only workout as push", () => {
    const w = workout([exercise("e1"), exercise("e2"), exercise("e3")]);
    const muscles = lookup({
      e1: ["chest"],
      e2: ["shoulders"],
      e3: ["triceps"],
    });
    expect(classifyWorkoutSplit(w, muscles)).toBe("push");
  });

  it("resolves display labels (the runtime shape), not just enum keys", () => {
    const w = workout([exercise("e1"), exercise("e2")]);
    const muscles = lookup({ e1: ["Chest"], e2: ["Triceps"] });
    expect(classifyWorkoutSplit(w, muscles)).toBe("push");
  });

  it("ignores unresolvable UUID-only tokens and returns null", () => {
    const w = workout([exercise("e1"), exercise("e2")]);
    const muscles = lookup({
      e1: ["15f7ddb6-0000-0000-0000-000000000000"],
      e2: ["abcd1234-0000-0000-0000-000000000000"],
    });
    expect(classifyWorkoutSplit(w, muscles)).toBeNull();
  });

  it("classifies a chest-press/raise/row/curl/extension workout as upper (regression)", () => {
    // The reported case — 3 push (chest, shoulders, triceps) + 2 pull (back,
    // biceps), no legs → UPPER, not FULL. Uses display labels (runtime form).
    const w = workout([
      exercise("e1"),
      exercise("e2"),
      exercise("e3"),
      exercise("e4"),
      exercise("e5"),
    ]);
    const muscles = lookup({
      e1: ["Chest"], // machine chest press
      e2: ["Shoulders"], // lateral raise
      e3: ["Back"], // seated row
      e4: ["Biceps"], // bicep curl
      e5: ["Triceps"], // tricep extension
    });
    expect(classifyWorkoutSplit(w, muscles)).toBe("upper");
  });

  it("classifies a pull-only workout as pull", () => {
    const w = workout([exercise("e1"), exercise("e2")]);
    const muscles = lookup({ e1: ["back", "lats"], e2: ["biceps"] });
    expect(classifyWorkoutSplit(w, muscles)).toBe("pull");
  });

  it("classifies a legs-only workout as legs", () => {
    const w = workout([exercise("e1"), exercise("e2")]);
    const muscles = lookup({
      e1: ["quadriceps"],
      e2: ["hamstrings", "glutes"],
    });
    expect(classifyWorkoutSplit(w, muscles)).toBe("legs");
  });

  it("classifies legs + core (no upper) as lower", () => {
    // 2 legs + 2 core → both regions active (≥0.34), no upper → lower.
    const w = workout([
      exercise("e1"),
      exercise("e2"),
      exercise("e3"),
      exercise("e4"),
    ]);
    const muscles = lookup({
      e1: ["quadriceps"],
      e2: ["glutes"],
      e3: ["core"],
      e4: ["core"],
    });
    expect(classifyWorkoutSplit(w, muscles)).toBe("lower");
  });

  it("classifies a balanced push + pull (no legs) as upper", () => {
    // 2 push + 2 pull → both active, neither dominant → upper.
    const w = workout([
      exercise("e1"),
      exercise("e2"),
      exercise("e3"),
      exercise("e4"),
    ]);
    const muscles = lookup({
      e1: ["chest"],
      e2: ["shoulders"],
      e3: ["back"],
      e4: ["biceps"],
    });
    expect(classifyWorkoutSplit(w, muscles)).toBe("upper");
  });

  it("gives push priority over upper when pull is below threshold", () => {
    // 4 push, 1 pull → pull fraction 0.2 (< 0.34) → PUSH, not UPPER.
    const w = workout([
      exercise("e1"),
      exercise("e2"),
      exercise("e3"),
      exercise("e4"),
      exercise("e5"),
    ]);
    const muscles = lookup({
      e1: ["chest"],
      e2: ["shoulders"],
      e3: ["triceps"],
      e4: ["chest"],
      e5: ["biceps"],
    });
    expect(classifyWorkoutSplit(w, muscles)).toBe("push");
  });

  it("classifies upper + legs as full", () => {
    const w = workout([exercise("e1"), exercise("e2"), exercise("e3")]);
    const muscles = lookup({
      e1: ["chest"],
      e2: ["back"],
      e3: ["quadriceps"],
    });
    expect(classifyWorkoutSplit(w, muscles)).toBe("full");
  });

  it("classifies an evenly-spread workout (no region dominant) as full", () => {
    // 1 push / 1 pull / 1 legs / 1 core → each 0.25 (< 0.34) → mixed → full.
    const w = workout([
      exercise("e1"),
      exercise("e2"),
      exercise("e3"),
      exercise("e4"),
    ]);
    const muscles = lookup({
      e1: ["chest"],
      e2: ["back"],
      e3: ["quadriceps"],
      e4: ["core"],
    });
    expect(classifyWorkoutSplit(w, muscles)).toBe("full");
  });

  it("classifies a core-only workout as core", () => {
    const w = workout([exercise("e1"), exercise("e2")]);
    const muscles = lookup({ e1: ["core"], e2: ["core"] });
    expect(classifyWorkoutSplit(w, muscles)).toBe("core");
  });

  it("has a badge label for every split", () => {
    const splits = [
      "push",
      "pull",
      "legs",
      "upper",
      "lower",
      "full",
      "core",
      "mobility",
      "cardio",
    ] as const;
    for (const s of splits) {
      expect(SPLIT_BADGE[s]).toMatch(/^[A-Z]+$/);
    }
  });
});
