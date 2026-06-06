import type {
  CreateExerciseInput,
  EquipmentType,
  Exercise,
  ExerciseDifficulty,
  MuscleGroup,
} from "@/domain/models/exercise";
import {
  EQUIPMENT_LABELS,
  MUSCLE_GROUP_LABELS,
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

const DIFFICULTY_TO_LEVEL: Record<ExerciseDifficulty, LevelLabel> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  // No "Expert" tier in the coarse picker — collapse onto Advanced for
  // display. The editor preserves the original difficulty unless the user
  // actually changes the Level picker (see ExerciseEditorContainer).
  expert: "Advanced",
};

/** Granular muscle-group enum key → coarse picker label. Inverted from
 * {@link MUSCLE_LABEL_TO_GROUPS}; groups absent from the coarse map
 * (hip_flexors, abductors, adductors) resolve to `undefined`. */
const GROUP_TO_MUSCLE_LABEL = (() => {
  const out = {} as Partial<Record<MuscleGroup, MuscleLabel>>;
  (Object.keys(MUSCLE_LABEL_TO_GROUPS) as MuscleLabel[]).forEach((label) => {
    MUSCLE_LABEL_TO_GROUPS[label].forEach((group) => {
      out[group] = label;
    });
  });
  return out;
})();

/** Display label (lowercased, e.g. "quads") → coarse picker label. Lets the
 * resolver accept the `*Labels` display strings the adapter resolves, not
 * just enum keys. */
const DISPLAY_TO_MUSCLE_LABEL = (() => {
  const out: Record<string, MuscleLabel> = {};
  (Object.keys(GROUP_TO_MUSCLE_LABEL) as MuscleGroup[]).forEach((group) => {
    const coarse = GROUP_TO_MUSCLE_LABEL[group];
    if (coarse) out[MUSCLE_GROUP_LABELS[group].toLowerCase()] = coarse;
  });
  return out;
})();

/** Resolve a single muscle token (enum key OR display label) to a coarse
 * picker label, or undefined when it maps to nothing the picker can show. */
function resolveCoarseMuscle(token: string): MuscleLabel | undefined {
  return (
    GROUP_TO_MUSCLE_LABEL[token as MuscleGroup] ??
    DISPLAY_TO_MUSCLE_LABEL[token.toLowerCase()]
  );
}

/** Equipment enum key → coarse picker label. Inverted from
 * {@link EQUIPMENT_LABEL_TO_ENUM}. */
const ENUM_TO_EQUIPMENT_LABEL = (() => {
  const out = {} as Partial<Record<EquipmentType, EquipmentLabel>>;
  (Object.keys(EQUIPMENT_LABEL_TO_ENUM) as EquipmentLabel[]).forEach(
    (label) => {
      out[EQUIPMENT_LABEL_TO_ENUM[label]] = label;
    },
  );
  return out;
})();

const VALID_EQUIPMENT_LABELS = new Set<string>(EQUIPMENT_OPTIONS);

/** Resolve an equipment token (coarse label, enum key, or display label) to a
 * coarse picker label, or undefined when unmappable (e.g. smith_machine). */
function resolveEquipmentLabel(token: string): EquipmentLabel | undefined {
  if (VALID_EQUIPMENT_LABELS.has(token)) return token as EquipmentLabel;
  const fromEnum = ENUM_TO_EQUIPMENT_LABEL[token as EquipmentType];
  if (fromEnum) return fromEnum;
  // Display label (e.g. "Resistance Band") → enum → coarse label.
  const entry = (Object.keys(EQUIPMENT_LABELS) as EquipmentType[]).find(
    (e) => EQUIPMENT_LABELS[e].toLowerCase() === token.toLowerCase(),
  );
  return entry ? ENUM_TO_EQUIPMENT_LABEL[entry] : undefined;
}

/**
 * Seed the coarse form value from an existing domain {@link Exercise} for the
 * full-screen editor (04.6). Best-effort + display-only: the coarse picker is
 * lossier than the stored granular arrays, so the editor container keeps the
 * original arrays and only re-expands a field if the user actually changes it
 * (preserve-granular-unless-changed). This mapper just decides which chips
 * render selected on open.
 *
 * Prefers the adapter-resolved `*Labels` display strings; falls back to the
 * raw enum-typed arrays (which may hold enum keys in local/test data). Unknown
 * tokens are dropped, defaulting to the same opens-empty values as create.
 *
 * Pure.
 */
export function toFormInput(exercise: Exercise): NewExerciseInput {
  const primaryTokens =
    exercise.primaryMuscleGroupLabels ?? exercise.primaryMuscleGroups;
  const secondaryTokens =
    exercise.secondaryMuscleGroupLabels ?? exercise.secondaryMuscleGroups;
  const equipmentTokens = exercise.equipmentLabels ?? exercise.equipment;

  const primaryMuscleLabel =
    primaryTokens
      .map((t) => resolveCoarseMuscle(String(t)))
      .find((m): m is MuscleLabel => m !== undefined) ??
    EMPTY_NEW_EXERCISE.primaryMuscleLabel;

  const secondaryMuscleLabels = Array.from(
    new Set(
      secondaryTokens
        .map((t) => resolveCoarseMuscle(String(t)))
        .filter((m): m is MuscleLabel => m !== undefined)
        .filter((m) => m !== primaryMuscleLabel),
    ),
  );

  const equipmentLabel =
    equipmentTokens
      .map((t) => resolveEquipmentLabel(String(t)))
      .find((e): e is EquipmentLabel => e !== undefined) ??
    EMPTY_NEW_EXERCISE.equipmentLabel;

  return {
    name: exercise.name,
    primaryMuscleLabel,
    secondaryMuscleLabels,
    equipmentLabel,
    level: DIFFICULTY_TO_LEVEL[exercise.difficulty],
    instructions: exercise.instructions ?? "",
    photoUrl: exercise.thumbnailUrl ?? undefined,
  };
}
