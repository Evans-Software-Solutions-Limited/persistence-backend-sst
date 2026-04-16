import {
  EXERCISE_CATEGORIES,
  EXERCISE_DIFFICULTIES,
  EQUIPMENT_TYPES,
  MUSCLE_GROUPS,
  type CreateExerciseInput,
  type EquipmentType,
  type Exercise,
  type ExerciseCategory,
  type ExerciseDifficulty,
  type ExerciseFilters,
  type MuscleGroup,
} from "@/domain/models/exercise";
import { fail, ok, type Result, type ValidationError } from "@/shared/errors";

/**
 * Score an exercise against a search term for relevance ranking.
 * Both the exercise name/description and the term are compared
 * case-insensitively.
 *
 * Scoring tiers (higher = more relevant):
 *   4 — exact name match (case-insensitive)
 *   3 — name starts with the search term
 *   2 — name contains the search term
 *   1 — description contains the search term
 *   0 — no match
 */
export function scoreExercise(exercise: Exercise, term: string): number {
  const termLower = term.toLowerCase();
  const nameLower = exercise.name.toLowerCase();
  if (nameLower === termLower) return 4;
  if (nameLower.startsWith(termLower)) return 3;
  if (nameLower.includes(termLower)) return 2;
  if (exercise.description?.toLowerCase().includes(termLower)) return 1;
  return 0;
}

/**
 * Filter and rank exercises by search text, muscle groups, equipment,
 * category, and difficulty. When a search term is provided, results
 * are sorted by relevance (exact > starts-with > contains name > contains description).
 *
 * Pure function — no side effects. Designed to run over a locally
 * cached library of a few thousand exercises with sub-10ms performance.
 */
export function filterExercises(
  exercises: Exercise[],
  filters: ExerciseFilters,
): Exercise[] {
  let result = exercises;
  let scored: { exercise: Exercise; score: number }[] | null = null;

  if (filters.search) {
    const term = filters.search.toLowerCase().trim();
    if (term.length > 0) {
      scored = [];
      for (const e of result) {
        const score = scoreExercise(e, term);
        if (score > 0) {
          scored.push({ exercise: e, score });
        }
      }
      // Sort by score descending, then alphabetically for ties
      scored.sort(
        (a, b) =>
          b.score - a.score || a.exercise.name.localeCompare(b.exercise.name),
      );
      result = scored.map((s) => s.exercise);
    }
  }

  if (filters.category) {
    const cat = filters.category;
    result = result.filter((e) => e.category === cat);
  }

  if (filters.difficulty) {
    const diff = filters.difficulty;
    result = result.filter((e) => e.difficulty === diff);
  }

  if (filters.muscleGroups && filters.muscleGroups.length > 0) {
    const groups = filters.muscleGroups;
    result = result.filter((e) =>
      groups.some(
        (g) =>
          e.primaryMuscleGroups.includes(g) ||
          e.secondaryMuscleGroups.includes(g),
      ),
    );
  }

  if (filters.equipment && filters.equipment.length > 0) {
    const equip = filters.equipment;
    result = result.filter((e) => equip.some((eq) => e.equipment.includes(eq)));
  }

  return result;
}

/**
 * Validate a CreateExerciseInput. Returns the input on success
 * or a ValidationError with per-field messages on failure.
 */
export function validateExerciseInput(
  input: CreateExerciseInput,
): Result<CreateExerciseInput, ValidationError> {
  const fields: Record<string, string> = {};

  // Name: required, min 2 chars
  const name = input.name.trim();
  if (name.length === 0) {
    fields.name = "Name is required";
  } else if (name.length < 2) {
    fields.name = "Name must be at least 2 characters";
  }

  // Category: must be valid enum
  if (!isValidCategory(input.category)) {
    fields.category = "Invalid category";
  }

  // Difficulty: must be valid enum
  if (!isValidDifficulty(input.difficulty)) {
    fields.difficulty = "Invalid difficulty level";
  }

  // Primary muscles: at least one required, all must be valid
  if (input.primaryMuscleGroups.length === 0) {
    fields.primaryMuscleGroups =
      "At least one primary muscle group is required";
  } else if (!input.primaryMuscleGroups.every(isValidMuscleGroup)) {
    fields.primaryMuscleGroups = "Invalid muscle group";
  }

  // Secondary muscles: all must be valid (optional)
  if (
    input.secondaryMuscleGroups &&
    input.secondaryMuscleGroups.length > 0 &&
    !input.secondaryMuscleGroups.every(isValidMuscleGroup)
  ) {
    fields.secondaryMuscleGroups = "Invalid muscle group";
  }

  // Equipment: at least one required, all must be valid
  if (input.equipment.length === 0) {
    fields.equipment = "At least one equipment type is required";
  } else if (!input.equipment.every(isValidEquipment)) {
    fields.equipment = "Invalid equipment type";
  }

  // Instructions: max 10000 chars
  if (input.instructions && input.instructions.length > 10000) {
    fields.instructions = "Instructions must be under 10,000 characters";
  }

  // Description: max 5000 chars
  if (input.description && input.description.length > 5000) {
    fields.description = "Description must be under 5,000 characters";
  }

  if (Object.keys(fields).length > 0) {
    return fail({ kind: "validation", fields });
  }

  return ok(input);
}

function isValidCategory(value: string): value is ExerciseCategory {
  return (EXERCISE_CATEGORIES as readonly string[]).includes(value);
}

function isValidDifficulty(value: string): value is ExerciseDifficulty {
  return (EXERCISE_DIFFICULTIES as readonly string[]).includes(value);
}

function isValidMuscleGroup(value: string): value is MuscleGroup {
  return (MUSCLE_GROUPS as readonly string[]).includes(value);
}

function isValidEquipment(value: string): value is EquipmentType {
  return (EQUIPMENT_TYPES as readonly string[]).includes(value);
}
