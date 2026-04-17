import type { CreateExerciseInput, Exercise } from "@/domain/models/exercise";
import { validateExerciseInput } from "@/domain/services/exercise.service";
import type { StoragePort } from "@/domain/ports/storage.port";
import { ok, type Result, type ValidationError } from "@/shared/errors";

/**
 * Dependencies for `createExerciseCommand`. `generateId` is injected so
 * tests can produce deterministic ids and so the application layer stays
 * free of platform imports (crypto/uuid).
 */
export type CreateExerciseCommandDeps = {
  storage: StoragePort;
  generateId: () => string;
  /** User id of the creator — stored on the Exercise and used for audit. */
  userId: string;
};

/**
 * Create a custom exercise: validate → persist locally → enqueue API sync.
 *
 * Flow:
 *   1. Validate the input via the domain service. On failure, return the
 *      ValidationError unchanged (no side effects, no mutation queued).
 *   2. Build a full Exercise with a locally-generated id, isCustom=true,
 *      and the caller's userId. The id is prefixed "local-" so sync code
 *      can recognise locally-created records that still need server ids.
 *   3. Save to the local cache so the UI sees the exercise immediately.
 *   4. Enqueue a POST /exercises mutation so the sync engine pushes it
 *      to the backend on the next online window.
 *
 * The command is fully offline-capable: it never awaits a network call.
 */
export function createExerciseCommand(
  deps: CreateExerciseCommandDeps,
  input: CreateExerciseInput,
): Result<Exercise, ValidationError> {
  const validation = validateExerciseInput(input);
  if (!validation.ok) return validation;

  const exercise: Exercise = {
    id: `local-${deps.generateId()}`,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    instructions: input.instructions?.trim() || null,
    category: input.category,
    difficulty: input.difficulty,
    primaryMuscleGroups: input.primaryMuscleGroups,
    secondaryMuscleGroups: input.secondaryMuscleGroups ?? [],
    equipment: input.equipment,
    isCustom: true,
    createdBy: deps.userId,
  };

  deps.storage.saveCustomExercise(exercise);
  deps.storage.enqueueMutation({
    entityType: "exercise",
    entityId: exercise.id,
    operation: "create",
    payload: input,
    endpoint: "/exercises",
    method: "POST",
  });

  return ok(exercise);
}
