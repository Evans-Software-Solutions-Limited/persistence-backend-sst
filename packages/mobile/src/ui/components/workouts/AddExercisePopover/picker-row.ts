/**
 * Picker-row mapping for the workout / session exercise pickers.
 *
 * `AddExerciseList` + `AddExerciseListItem` + `ExerciseDetailsModal`
 * consume a snake_case row shape (`thumbnail_url`, `primary_muscles`,
 * `equipment_required`, ...). The domain `Exercise` type is camelCase
 * with enrichable labels — this module is the single bridge between
 * the two. Importing the mapper from here (instead of redefining it
 * inside each popover) keeps the row contract in one place so adding
 * a new field touches one site, not three.
 *
 * The picker mapping isn't an external wire format — it's purely the
 * input shape of the picker UI tree.
 */

import type { Exercise } from "@/domain/models/exercise";

/**
 * Shape consumed by `AddExerciseList` / `AddExerciseListItem` /
 * `ExerciseDetailsModal`. Snake-case keys + nested label objects;
 * `any` on the function return for now to match the existing list
 * components' loose typing — a future polish can tighten them in
 * lockstep.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toPickerExerciseRow(ex: Exercise): any {
  const muscleLabels = ex.primaryMuscleGroupLabels ?? [];
  const equipmentLabels = ex.equipmentLabels ?? [];
  return {
    id: ex.id,
    name: ex.name,
    description: ex.description,
    instructions: ex.instructions,
    thumbnail_url: ex.thumbnailUrl,
    video_url: ex.videoUrl,
    difficulty_level: ex.difficulty,
    primary_muscles: muscleLabels.map((label) => ({
      name: label,
      display_name: label,
    })),
    equipment_required: equipmentLabels.map((label) => ({ name: label })),
  };
}
