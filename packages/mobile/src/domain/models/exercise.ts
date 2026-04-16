/**
 * Exercise domain model and related types.
 *
 * Enums match the SST backend and old app's exerciseEnums.ts.
 * MuscleGroup is expanded beyond the old app to include specific
 * muscle sub-groups used by the API (forearms, traps, lats, etc.).
 */

// -- Enums --

export const EXERCISE_CATEGORIES = [
  "strength",
  "cardio",
  "flexibility",
  "balance",
  "plyometric",
  "olympic",
  "mobility",
] as const;

export type ExerciseCategory = (typeof EXERCISE_CATEGORIES)[number];

export const EXERCISE_DIFFICULTIES = [
  "beginner",
  "intermediate",
  "advanced",
  "expert",
] as const;

export type ExerciseDifficulty = (typeof EXERCISE_DIFFICULTIES)[number];

export const MUSCLE_GROUPS = [
  "chest",
  "back",
  "shoulders",
  "biceps",
  "triceps",
  "quadriceps",
  "hamstrings",
  "glutes",
  "calves",
  "core",
  "forearms",
  "traps",
  "lats",
  "hip_flexors",
  "abductors",
  "adductors",
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const EQUIPMENT_TYPES = [
  "barbell",
  "dumbbell",
  "machine",
  "cable",
  "bodyweight",
  "kettlebell",
  "resistance_band",
  "smith_machine",
  "ez_bar",
  "other",
] as const;

export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

// -- Display helpers --

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  quadriceps: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  core: "Core",
  forearms: "Forearms",
  traps: "Traps",
  lats: "Lats",
  hip_flexors: "Hip Flexors",
  abductors: "Abductors",
  adductors: "Adductors",
};

export const EQUIPMENT_LABELS: Record<EquipmentType, string> = {
  barbell: "Barbell",
  dumbbell: "Dumbbell",
  machine: "Machine",
  cable: "Cable",
  bodyweight: "Bodyweight",
  kettlebell: "Kettlebell",
  resistance_band: "Resistance Band",
  smith_machine: "Smith Machine",
  ez_bar: "EZ Bar",
  other: "Other",
};

export const CATEGORY_LABELS: Record<ExerciseCategory, string> = {
  strength: "Strength",
  cardio: "Cardio",
  flexibility: "Flexibility",
  balance: "Balance",
  plyometric: "Plyometric",
  olympic: "Olympic",
  mobility: "Mobility",
};

export const DIFFICULTY_LABELS: Record<ExerciseDifficulty, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  expert: "Expert",
};

// -- Domain entity --

export type Exercise = {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  category: ExerciseCategory;
  difficulty: ExerciseDifficulty;
  primaryMuscleGroups: MuscleGroup[];
  secondaryMuscleGroups: MuscleGroup[];
  equipment: EquipmentType[];
  isCustom: boolean;
  createdBy: string | null;
};

// -- Filter type --

export type ExerciseFilters = {
  search?: string;
  muscleGroups?: MuscleGroup[];
  equipment?: EquipmentType[];
  category?: ExerciseCategory;
  difficulty?: ExerciseDifficulty;
};

// -- Create input --

export type CreateExerciseInput = {
  name: string;
  description?: string;
  instructions?: string;
  category: ExerciseCategory;
  difficulty: ExerciseDifficulty;
  primaryMuscleGroups: MuscleGroup[];
  secondaryMuscleGroups?: MuscleGroup[];
  equipment: EquipmentType[];
};
