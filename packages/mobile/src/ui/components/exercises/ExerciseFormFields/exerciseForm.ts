import type {
  CreateExerciseInput,
  EquipmentType,
  ExerciseDifficulty,
  MuscleGroup,
} from "@/domain/models/exercise";

/**
 * Form model + UI-label → domain conversion for the Create-Exercise sheet
 * (and, from 04.6, the full-screen exercise editor).
 *
 * Spec: specs/04-workout-management/design.md
 *       § <CreateExercisePresenter> — Conversion layer
 *       requirements.md STORY-006 + STORY-008
 *
 * The form collects the coarse, capitalised labels the prototype's
 * `create-exercise.jsx` renders (`"Legs"`, `"Arms"`, …). The domain
 * `CreateExerciseInput` is granular, lowercase, and array-shaped; this
 * module is the one-way (UI → domain) boundary, kept pure + framework-free
 * so the mapping is unit-testable in isolation.
 *
 * Revised 2026-06-02 (Phase 04.3): the prototype's `Cardio` primary-muscle
 * chip is DROPPED for now. V2's `validateExerciseInput` requires ≥1 primary
 * muscle group and there is no `cardio`/`full-body` entry in the MuscleGroup
 * enum, so the design's `Cardio → []` mapping would fail validation on Save.
 * Cardio-as-a-category is deferred to a dedicated future slice (Brad's call).
 * Every remaining label maps to ≥1 valid muscle group, and `category` is
 * always `"strength"`.
 */

export type MuscleLabel =
  | "Chest"
  | "Back"
  | "Legs"
  | "Shoulders"
  | "Arms"
  | "Core";

export const MUSCLES: MuscleLabel[] = [
  "Chest",
  "Back",
  "Legs",
  "Shoulders",
  "Arms",
  "Core",
];

export type EquipmentLabel =
  | "Barbell"
  | "Dumbbell"
  | "Machine"
  | "Cable"
  | "Bodyweight"
  | "Kettlebell"
  | "Band";

export const EQUIPMENT_OPTIONS: EquipmentLabel[] = [
  "Barbell",
  "Dumbbell",
  "Machine",
  "Cable",
  "Bodyweight",
  "Kettlebell",
  "Band",
];

export type LevelLabel = "Beginner" | "Intermediate" | "Advanced";

/** Per-tier tone, matching `create-exercise.jsx:30-34`. */
export const LEVELS: { id: LevelLabel; tone: "success" | "gold" | "error" }[] =
  [
    { id: "Beginner", tone: "success" },
    { id: "Intermediate", tone: "gold" },
    { id: "Advanced", tone: "error" },
  ];

/**
 * UI form value. Mirrors the prototype's local state; the container converts
 * it to a `CreateExerciseInput` at the submit boundary via
 * {@link toCreateExerciseInput}.
 */
export type NewExerciseInput = {
  name: string;
  primaryMuscleLabel: MuscleLabel;
  secondaryMuscleLabels: MuscleLabel[];
  equipmentLabel: EquipmentLabel;
  level: LevelLabel;
  instructions: string;
  /** Optional photo / video URL — maps to `thumbnailUrl` at the boundary. */
  photoUrl?: string;
};

/** Sheet/editor open defaults — matches `create-exercise.jsx:20-25`. */
export const EMPTY_NEW_EXERCISE: NewExerciseInput = {
  name: "",
  primaryMuscleLabel: "Chest",
  secondaryMuscleLabels: [],
  equipmentLabel: "Barbell",
  level: "Intermediate",
  instructions: "",
};

const MUSCLE_LABEL_TO_GROUPS: Record<MuscleLabel, MuscleGroup[]> = {
  Chest: ["chest"],
  Back: ["back", "lats"],
  Legs: ["quadriceps", "hamstrings", "glutes", "calves"],
  Shoulders: ["shoulders", "traps"],
  Arms: ["biceps", "triceps", "forearms"],
  Core: ["core"],
};

const EQUIPMENT_LABEL_TO_ENUM: Record<EquipmentLabel, EquipmentType> = {
  Barbell: "barbell",
  Dumbbell: "dumbbell",
  Machine: "machine",
  Cable: "cable",
  Bodyweight: "bodyweight",
  Kettlebell: "kettlebell",
  Band: "resistance_band",
};

const LEVEL_TO_DIFFICULTY: Record<LevelLabel, ExerciseDifficulty> = {
  Beginner: "beginner",
  Intermediate: "intermediate",
  Advanced: "advanced",
};

/**
 * Convert the coarse UI form value to the granular domain create input.
 * One-way: when the same exercise is later read for editing, the granular
 * muscle list is preserved as-is (finer than the picker can express — fine
 * for v1; granular edit UI is post-launch).
 *
 * Pure. Trims free-text fields; the command's own `sanitizeInput` repeats
 * the trim defensively, so this stays idempotent with the application layer.
 */
export function toCreateExerciseInput(
  input: NewExerciseInput,
): CreateExerciseInput {
  const instructions = input.instructions.trim();
  const photoUrl = input.photoUrl?.trim();
  return {
    name: input.name.trim(),
    instructions: instructions.length > 0 ? instructions : undefined,
    category: "strength",
    difficulty: LEVEL_TO_DIFFICULTY[input.level],
    primaryMuscleGroups: MUSCLE_LABEL_TO_GROUPS[input.primaryMuscleLabel],
    secondaryMuscleGroups: input.secondaryMuscleLabels.flatMap(
      (label) => MUSCLE_LABEL_TO_GROUPS[label],
    ),
    equipment: [EQUIPMENT_LABEL_TO_ENUM[input.equipmentLabel]],
    thumbnailUrl: photoUrl && photoUrl.length > 0 ? photoUrl : undefined,
  };
}
