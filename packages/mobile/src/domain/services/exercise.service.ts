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
 * Tokenise a free-text search term into lowercase alphanumeric tokens.
 * Reserved punctuation and tsquery-style operators are stripped (cheap
 * allowlist) so the result is safe to AND-match against an exercise's
 * name + description without surprises.
 *
 *   "press bench"        → ["press", "bench"]
 *   "  Bench   Press  "  → ["bench", "press"]
 *   ""                   → []
 *   "bench-press"        → ["bench", "press"]
 *
 * Exported for tests. Mirrors the backend's `toPrefixTsQuery` tokeniser
 * (microservices/core/.../exerciseRepository.ts) so server and offline
 * matching agree on what a "token" is.
 */
export function tokenizeSearch(term: string): string[] {
  return term
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Score an exercise against a search term for relevance ranking.
 *
 * Tokenises the term into lowercased alphanumeric tokens and AND-matches
 * every token against the exercise's name (and description as a tier-1
 * fallback). Out-of-order, partial-word, and multi-token searches all
 * work — "press bench" finds "Bench Press", "benc" finds "Bench Press".
 *
 * Scoring tiers (higher = more relevant):
 *   4 — exact name match (case-insensitive, raw term equals raw name)
 *   3 — every token is a prefix of a name token (start-of-word match)
 *   2 — every token appears anywhere inside the name (substring AND-match)
 *   1 — every token appears in name+description combined (description fallback)
 *   0 — at least one token doesn't match anywhere
 */
export function scoreExercise(exercise: Exercise, term: string): number {
  const termLower = term.toLowerCase().trim();
  if (termLower.length === 0) return 0;
  const nameLower = exercise.name.toLowerCase();
  if (nameLower === termLower) return 4;

  const tokens = tokenizeSearch(term);
  if (tokens.length === 0) return 0;

  // Tier 3: every token starts one of the name's whitespace-separated
  // word tokens. "press bench" → name word-tokens ["bench", "press"]
  // → both query tokens are prefixes of name word-tokens → score 3.
  const nameWords = nameLower.split(/\s+/).filter(Boolean);
  const allStartWord = tokens.every((t) =>
    nameWords.some((w) => w.startsWith(t)),
  );
  if (allStartWord) return 3;

  // Tier 2: every token appears as a substring of the name (in any
  // order, possibly mid-word). "benc" → name "bench press" → contains
  // "benc" → score 2.
  const allInName = tokens.every((t) => nameLower.includes(t));
  if (allInName) return 2;

  // Tier 1: every token appears in name + description combined. Final
  // fallback before "no match".
  const desc = exercise.description?.toLowerCase() ?? "";
  const combined = `${nameLower} ${desc}`;
  const allInCombined = tokens.every((t) => combined.includes(t));
  if (allInCombined) return 1;

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

  if (filters.difficulties && filters.difficulties.length > 0) {
    const diffs = filters.difficulties;
    result = result.filter((e) => diffs.includes(e.difficulty));
  }

  if (filters.createdBy) {
    const wantCustom = filters.createdBy === "mine";
    result = result.filter((e) => e.isCustom === wantCustom);
  }

  // Muscle / equipment filtering compares UUIDs on both sides. Exercise's
  // `primaryMuscleGroups` / `equipment` arrays are typed as enum unions
  // for historical parity but hold UUIDs at runtime (see Exercise model
  // docstring). Cast the arrays to `string[]` so the `.includes` call
  // sees the same shape the filter is actually passing.
  //
  // Primary-only by design — matches backend
  // (`exerciseRepository.targetedMusclesAny`) and legacy mobile. A
  // brief experiment widened this to primary + secondary, but
  // "selecting Abs returned ~1300 exercises" because nearly every
  // compound lift works the core as a secondary mover — broke the
  // user's mental model that the filter narrows to muscles the
  // exercise actually targets.
  //
  // Defensive: `(... ?? [])` guards against legacy cached rows whose
  // muscle / equipment columns were stored as null instead of `[]`.
  // Without this, `.includes()` throws on null and the entire list
  // silently empties (the symptom that masquerades as "the filter
  // doesn't work"). DB schema's `default([])` only protects fresh
  // rows — historical data in Supabase can still hold NULL.
  if (filters.muscleGroups && filters.muscleGroups.length > 0) {
    const groups = filters.muscleGroups;
    result = result.filter((e) => {
      const primary =
        (e.primaryMuscleGroups as unknown as string[] | null) ?? [];
      return groups.some((g) => primary.includes(g));
    });
  }

  if (filters.equipment && filters.equipment.length > 0) {
    const equip = filters.equipment;
    result = result.filter((e) => {
      const equipment = (e.equipment as unknown as string[] | null) ?? [];
      return equip.some((eq) => equipment.includes(eq));
    });
  }

  return result;
}

/**
 * Legacy-parity alphabetical ordering for the browse list
 * (`exerciseQueries.ts` → `.order('name', { ascending: true })`). V2's cache
 * read returns rows in SQLite insertion order, so without this a newly-created
 * custom lands at the BOTTOM of the ~2.3k-row library and reads as "vanished"
 * after the post-create flash. Applied by the list container ONLY to the
 * no-search browse path — search keeps its relevance-score order, and the
 * server-ranked search path keeps the server's order.
 */
export function sortExercisesByName(exercises: Exercise[]): Exercise[] {
  return [...exercises].sort((a, b) => a.name.localeCompare(b.name));
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
