import type { MuscleGroup } from "@/domain/models/exercise";
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

/** Build a getMuscles lookup from an id→muscles map. */
const lookup =
  (map: Record<string, MuscleGroup[]>) =>
  (id: string): readonly MuscleGroup[] | undefined =>
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
