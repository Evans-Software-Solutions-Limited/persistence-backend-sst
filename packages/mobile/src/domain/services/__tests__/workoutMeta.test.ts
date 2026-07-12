import type { Workout, WorkoutExercise } from "@/domain/models/workout";
import {
  deriveDominantEquipment,
  deriveWorkoutMuscles,
} from "@/domain/services/workoutMeta";

const ex = (id: string, exerciseId: string): WorkoutExercise => ({
  id,
  exerciseId,
  sortOrder: 1,
  supersetGroup: null,
  targetSets: 3,
  targetRepsMin: 8,
  targetRepsMax: 12,
  targetDurationSeconds: null,
  restSeconds: 60,
  notes: null,
  exercise: null,
});

const workout = (exerciseIds: string[]): Workout => ({
  id: "w",
  name: "W",
  description: null,
  createdBy: "u",
  visibility: "private",
  estimatedDurationMinutes: 30,
  showInOwnerLibrary: true,
  exercises: exerciseIds.map((id, i) => ex(`we-${i}`, id)),
  createdAt: "",
  updatedAt: "",
});

describe("deriveWorkoutMuscles", () => {
  it("orders by frequency desc, ties by first appearance, dedups per exercise", () => {
    const w = workout(["a", "b", "c"]);
    const labels: Record<string, string[]> = {
      a: ["Chest", "Chest", "Shoulders"], // duplicate within exercise counts once
      b: ["Chest", "Back"],
      c: ["Shoulders"],
    };
    const result = deriveWorkoutMuscles(w, (id) => labels[id]);
    // Chest: 2, Shoulders: 2 (Chest first-seen before Shoulders), Back: 1.
    expect(result).toEqual(["Chest", "Shoulders", "Back"]);
  });

  it("skips exercises with no cached labels", () => {
    const w = workout(["a", "b"]);
    expect(
      deriveWorkoutMuscles(w, (id) => (id === "a" ? ["Legs"] : undefined)),
    ).toEqual(["Legs"]);
  });

  it("returns [] when nothing resolves", () => {
    expect(deriveWorkoutMuscles(workout(["a"]), () => undefined)).toEqual([]);
  });
});

describe("deriveDominantEquipment", () => {
  it("returns the most common label", () => {
    const w = workout(["a", "b", "c"]);
    const eq: Record<string, string[]> = {
      a: ["Machine"],
      b: ["Machine"],
      c: ["Barbell"],
    };
    expect(deriveDominantEquipment(w, (id) => eq[id])).toBe("Machine");
  });

  it("breaks ties by first appearance", () => {
    const w = workout(["a", "b"]);
    const eq: Record<string, string[]> = { a: ["Cable"], b: ["Dumbbell"] };
    expect(deriveDominantEquipment(w, (id) => eq[id])).toBe("Cable");
  });

  it("returns null when nothing resolves", () => {
    expect(deriveDominantEquipment(workout(["a"]), () => undefined)).toBeNull();
    expect(deriveDominantEquipment(workout(["a"]), () => [])).toBeNull();
  });
});
