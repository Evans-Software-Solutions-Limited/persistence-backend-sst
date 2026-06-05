import {
  EMPTY_NEW_EXERCISE,
  EQUIPMENT_OPTIONS,
  LEVELS,
  MUSCLES,
  type NewExerciseInput,
  toCreateExerciseInput,
  toFormInput,
} from "@/ui/components/exercises/ExerciseFormFields";
import type { Exercise } from "@/domain/models/exercise";

const exercise: Exercise = {
  id: "ex-1",
  name: "Bench Press",
  description: null,
  instructions: "Keep elbows tucked",
  category: "strength",
  difficulty: "advanced",
  primaryMuscleGroups: ["chest"],
  secondaryMuscleGroups: ["triceps"],
  equipment: ["barbell"],
  videoUrl: null,
  thumbnailUrl: null,
  isCustom: true,
  createdBy: "u1",
};

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

describe("toFormInput", () => {
  it("seeds name, level, instructions, and photo from the exercise", () => {
    const out = toFormInput(exercise);
    expect(out.name).toBe("Bench Press");
    expect(out.level).toBe("Advanced");
    expect(out.instructions).toBe("Keep elbows tucked");
    expect(out.photoUrl).toBeUndefined();
  });

  it("collapses the 'expert' difficulty onto the Advanced coarse tier", () => {
    expect(toFormInput({ ...exercise, difficulty: "expert" }).level).toBe(
      "Advanced",
    );
  });

  it("derives the coarse primary muscle from granular display labels", () => {
    const out = toFormInput({
      ...exercise,
      primaryMuscleGroups: [],
      primaryMuscleGroupLabels: ["Quads"],
    });
    expect(out.primaryMuscleLabel).toBe("Legs");
  });

  it("derives the coarse primary muscle from raw enum keys when labels absent", () => {
    const out = toFormInput({
      ...exercise,
      primaryMuscleGroups: ["hamstrings"],
      primaryMuscleGroupLabels: undefined,
    });
    expect(out.primaryMuscleLabel).toBe("Legs");
  });

  it("dedupes secondary labels and excludes the resolved primary", () => {
    const out = toFormInput({
      ...exercise,
      primaryMuscleGroups: ["chest"],
      secondaryMuscleGroups: ["triceps", "biceps", "chest"],
      primaryMuscleGroupLabels: ["Chest"],
      secondaryMuscleGroupLabels: ["Triceps", "Biceps", "Chest"],
    });
    // triceps+biceps both → Arms (deduped); Chest dropped (it's primary).
    expect(out.secondaryMuscleLabels).toEqual(["Arms"]);
  });

  it("resolves equipment display labels back to the coarse picker option", () => {
    expect(
      toFormInput({
        ...exercise,
        equipment: [],
        equipmentLabels: ["Resistance Band"],
      }).equipmentLabel,
    ).toBe("Band");
    expect(
      toFormInput({
        ...exercise,
        equipment: ["dumbbell"],
        equipmentLabels: undefined,
      }).equipmentLabel,
    ).toBe("Dumbbell");
  });

  it("falls back to the empty-form defaults for unmappable tokens", () => {
    const out = toFormInput({
      ...exercise,
      primaryMuscleGroups: ["hip_flexors"],
      primaryMuscleGroupLabels: ["Hip Flexors"],
      secondaryMuscleGroups: [],
      secondaryMuscleGroupLabels: [],
      equipment: ["smith_machine"],
      equipmentLabels: ["Smith Machine"],
    });
    expect(out.primaryMuscleLabel).toBe(EMPTY_NEW_EXERCISE.primaryMuscleLabel);
    expect(out.secondaryMuscleLabels).toEqual([]);
    expect(out.equipmentLabel).toBe(EMPTY_NEW_EXERCISE.equipmentLabel);
  });

  it("treats null instructions as an empty string and maps thumbnail to photoUrl", () => {
    const out = toFormInput({
      ...exercise,
      instructions: null,
      thumbnailUrl: "https://x/y.png",
    });
    expect(out.instructions).toBe("");
    expect(out.photoUrl).toBe("https://x/y.png");
  });
});
