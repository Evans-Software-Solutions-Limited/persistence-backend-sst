import type { Exercise } from "../../domain/models/exercise";
import type { TogetherSharedExerciseDefinition } from "../../domain/ports/togetherShared.port";

/**
 * The definitions a host shares for its own custom exercises among `ids`
 * (PER-60): only exercises `ownerId` created, never system or others' ones.
 */
export function ownCustomExercises(
  library: readonly Exercise[],
  ownerId: string,
  ids: readonly string[],
): Record<string, TogetherSharedExerciseDefinition> {
  const wanted = new Set(ids);
  const result: Record<string, TogetherSharedExerciseDefinition> = {};
  for (const exercise of library)
    if (wanted.has(exercise.id) && exercise.createdBy === ownerId)
      result[exercise.id] = {
        name: exercise.name,
        category: exercise.category ?? null,
        primaryMuscles: [...(exercise.primaryMuscleGroups ?? [])],
      };
  return result;
}
