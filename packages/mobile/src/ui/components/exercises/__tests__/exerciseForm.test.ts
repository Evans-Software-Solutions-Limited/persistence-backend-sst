import {
  EMPTY_NEW_EXERCISE,
  EQUIPMENT_OPTIONS,
  LEVELS,
  MUSCLES,
  type NewExerciseInput,
  toCreateExerciseInput,
} from "@/ui/components/exercises/ExerciseFormFields";

const base: NewExerciseInput = {
  ...EMPTY_NEW_EXERCISE,
  name: "  Incline Press  ",
};

describe("exerciseForm constants", () => {
  it("drops the Cardio chip (deferred to cardio-as-category work)", () => {
    expect(MUSCLES).toEqual([
      "Chest",
      "Back",
      "Legs",
      "Shoulders",
      "Arms",
      "Core",
    ]);
    expect(MUSCLES).not.toContain("Cardio");
  });

  it("offers the seven prototype equipment options", () => {
    expect(EQUIPMENT_OPTIONS).toEqual([
      "Barbell",
      "Dumbbell",
      "Machine",
      "Cable",
      "Bodyweight",
      "Kettlebell",
      "Band",
    ]);
  });

  it("maps the three levels to their per-tier tones", () => {
    expect(LEVELS).toEqual([
      { id: "Beginner", tone: "success" },
      { id: "Intermediate", tone: "gold" },
      { id: "Advanced", tone: "error" },
    ]);
  });
});

describe("toCreateExerciseInput", () => {
  it("trims the name and always sets category=strength", () => {
    const out = toCreateExerciseInput(base);
    expect(out.name).toBe("Incline Press");
    expect(out.category).toBe("strength");
  });

  it("maps each coarse muscle label to its granular groups", () => {
    expect(
      toCreateExerciseInput({ ...base, primaryMuscleLabel: "Chest" })
        .primaryMuscleGroups,
    ).toEqual(["chest"]);
    expect(
      toCreateExerciseInput({ ...base, primaryMuscleLabel: "Back" })
        .primaryMuscleGroups,
    ).toEqual(["back", "lats"]);
    expect(
      toCreateExerciseInput({ ...base, primaryMuscleLabel: "Legs" })
        .primaryMuscleGroups,
    ).toEqual(["quadriceps", "hamstrings", "glutes", "calves"]);
    expect(
      toCreateExerciseInput({ ...base, primaryMuscleLabel: "Shoulders" })
        .primaryMuscleGroups,
    ).toEqual(["shoulders", "traps"]);
    expect(
      toCreateExerciseInput({ ...base, primaryMuscleLabel: "Arms" })
        .primaryMuscleGroups,
    ).toEqual(["biceps", "triceps", "forearms"]);
    expect(
      toCreateExerciseInput({ ...base, primaryMuscleLabel: "Core" })
        .primaryMuscleGroups,
    ).toEqual(["core"]);
  });

  it("flat-maps secondary labels to granular groups", () => {
    const out = toCreateExerciseInput({
      ...base,
      secondaryMuscleLabels: ["Arms", "Core"],
    });
    expect(out.secondaryMuscleGroups).toEqual([
      "biceps",
      "triceps",
      "forearms",
      "core",
    ]);
  });

  it("returns an empty secondary array when none selected", () => {
    expect(
      toCreateExerciseInput({ ...base, secondaryMuscleLabels: [] })
        .secondaryMuscleGroups,
    ).toEqual([]);
  });

  it("maps the equipment label to a single-element enum array", () => {
    expect(
      toCreateExerciseInput({ ...base, equipmentLabel: "Band" }).equipment,
    ).toEqual(["resistance_band"]);
    expect(
      toCreateExerciseInput({ ...base, equipmentLabel: "Barbell" }).equipment,
    ).toEqual(["barbell"]);
  });

  it("maps each level label to its lowercase difficulty", () => {
    expect(
      toCreateExerciseInput({ ...base, level: "Beginner" }).difficulty,
    ).toBe("beginner");
    expect(
      toCreateExerciseInput({ ...base, level: "Intermediate" }).difficulty,
    ).toBe("intermediate");
    expect(
      toCreateExerciseInput({ ...base, level: "Advanced" }).difficulty,
    ).toBe("advanced");
  });

  it("drops whitespace-only instructions + photo to undefined", () => {
    const out = toCreateExerciseInput({
      ...base,
      instructions: "   ",
      photoUrl: "  ",
    });
    expect(out.instructions).toBeUndefined();
    expect(out.thumbnailUrl).toBeUndefined();
  });

  it("keeps trimmed instructions + photo URL", () => {
    const out = toCreateExerciseInput({
      ...base,
      instructions: "  keep depth  ",
      photoUrl: "  https://x/y.png ",
    });
    expect(out.instructions).toBe("keep depth");
    expect(out.thumbnailUrl).toBe("https://x/y.png");
  });

  it("produces input that passes the domain muscle/equipment requirements", () => {
    // Every label maps to >=1 primary muscle and exactly one equipment —
    // the guarantee that fixes the dropped-Cardio validation trap.
    for (const m of MUSCLES) {
      const out = toCreateExerciseInput({ ...base, primaryMuscleLabel: m });
      expect(out.primaryMuscleGroups.length).toBeGreaterThanOrEqual(1);
      expect(out.equipment).toHaveLength(1);
    }
  });
});
