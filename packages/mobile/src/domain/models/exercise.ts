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
  /**
   * UUID arrays as returned by the backend. Typed as the historical enum
   * union for source compatibility with the legacy port — the actual
   * runtime values are DB UUIDs (e.g. `"15f7ddb6-..."`), not enum keys
   * (`"shoulders"`). Use `*Labels` below for display; resolve UUIDs via
   * the reference-list cache when you need the enum surface.
   */
  primaryMuscleGroups: MuscleGroup[];
  secondaryMuscleGroups: MuscleGroup[];
  equipment: EquipmentType[];
  /**
   * Display labels resolved at the adapter boundary via the reference-list
   * cache (`muscle_groups` / `equipment_types` tables). Parallel-indexed
   * with `primaryMuscleGroups` / `equipment`. Undefined before the first
   * reference-list fetch completes; the card falls back to a placeholder
   * label rather than rendering an empty chip.
   *
   * This shape is how the card and any other display surface should read
   * muscle / equipment names — the legacy `MUSCLE_GROUP_LABELS[key]` map
   * only works for enum keys, and returns `undefined` against UUIDs
   * (which is why pre-M0 cards rendered empty circles).
   */
  primaryMuscleGroupLabels?: string[];
  secondaryMuscleGroupLabels?: string[];
  equipmentLabels?: string[];
  /**
   * Legacy-parity fields added in M0 (AC 7.16). Nullable — not every
   * row has media. `thumbnailUrl` is rendered on the ported list card;
   * `videoUrl` is rendered on the ported detail screen.
   */
  videoUrl: string | null;
  thumbnailUrl: string | null;
  /**
   * Client-derived from `createdBy !== null`. The V2 backend uses
   * `created_by IS NULL` for system exercises; there's no
   * `is_custom` column. Adapter computes this on the way into
   * the domain layer.
   */
  isCustom: boolean;
  createdBy: string | null;
};

/**
 * Sentinel owner id for the stock/system exercise catalogue. The backend's
 * Supabase rows tag system exercises with `created_by = SYSTEM_USER_ID`
 * (an all-zeros UUID) — NOT `NULL`. A naive `createdBy !== null` check marks
 * the ENTIRE stock catalogue as custom (the System filter empties, Mine
 * shows everything). Mirrors the backend constant in
 * `microservices/core/src/application/repositories/exerciseRepository.ts`.
 */
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Re-derive `isCustom` and normalise `createdBy`, treating the system
 * sentinel owner the same as a null owner. Pure and idempotent.
 *
 * Applied at the API boundary (write-time) AND on the way out of the local
 * exercise cache (read-time). The read-time pass matters because blobs were
 * persisted before the write-time fix existed and carry `isCustom: true` for
 * every system exercise — so the cache read must NOT trust the stored value
 * and instead re-derives ownership from the (authoritative) `createdBy`.
 */
export function deriveExerciseOwnership(exercise: Exercise): Exercise {
  const isSystem =
    exercise.createdBy == null || exercise.createdBy === SYSTEM_USER_ID;
  return {
    ...exercise,
    isCustom: !isSystem,
    createdBy: isSystem ? null : exercise.createdBy,
  };
}

// -- Filter type --

/**
 * Who created the exercise — used for the "My Exercises" / "System"
 * quick-filter pills. Maps to `isCustom` on Exercise:
 *   "mine"   → isCustom === true
 *   "system" → isCustom === false
 *
 * `pt` and `physio` variants from the legacy app are intentionally omitted
 * until user-relationship data lands. Add them here then, so filter state
 * can stay a simple discriminated union.
 */
export type CreatedByFilter = "mine" | "system";

export type ExerciseFilters = {
  search?: string;
  /**
   * Muscle-group UUIDs. Matches the id column on Supabase's `muscle_groups`
   * table (and the UUIDs stored in `exercises.primary_muscles`). Filter
   * state holds UUIDs directly — NOT the legacy `MuscleGroup` enum —
   * because the cached exercises hold UUIDs and in-memory filtering needs
   * the two sides to match. The filter modal reads the available list
   * from `referenceLists.muscle_groups` and keys selection by `entry.id`.
   */
  muscleGroups?: string[];
  /**
   * Equipment UUIDs — same rationale as `muscleGroups`.
   */
  equipment?: string[];
  /**
   * Category is retained on the filter type for API/query compatibility
   * but is not surfaced in the current UI. The old mobile app never exposed
   * a category quick-filter; we keep the field to avoid churning the
   * storage/API layer when/if the feature returns.
   */
  category?: ExerciseCategory;
  /**
   * Multi-select by difficulty — OR-matched. The legacy app allows a lifter
   * to see e.g. "Beginner + Intermediate" in one pass, so the V2 surface is
   * an array rather than a single value.
   */
  difficulties?: ExerciseDifficulty[];
  /**
   * "Mine" / "System" quick-filter. AND-matched with other axes.
   */
  createdBy?: CreatedByFilter;
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
  /** Optional media URLs. Passed through to backend POST /exercises. */
  videoUrl?: string;
  thumbnailUrl?: string;
};
