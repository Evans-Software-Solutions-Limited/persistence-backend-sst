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
 *   2. Sanitize the input once (trim name, drop whitespace-only optional
 *      fields). The SAME sanitized values are used for both the local
 *      Exercise and the enqueued sync payload — otherwise the server and
 *      local cache drift, and the next refreshExerciseCache silently
 *      replaces the local sanitized record with a less-sanitized one
 *      round-tripped through the server.
 *   3. Save to the local cache so the UI sees the exercise immediately
 *      with a locally-generated id (prefixed "local-" so sync code can
 *      recognise records still awaiting a server id).
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

  const sanitized = sanitizeInput(input);

  const exercise: Exercise = {
    id: `local-${deps.generateId()}`,
    name: sanitized.name,
    description: sanitized.description ?? null,
    instructions: sanitized.instructions ?? null,
    category: sanitized.category,
    difficulty: sanitized.difficulty,
    primaryMuscleGroups: sanitized.primaryMuscleGroups,
    secondaryMuscleGroups: sanitized.secondaryMuscleGroups ?? [],
    equipment: sanitized.equipment,
    videoUrl: sanitized.videoUrl ?? null,
    thumbnailUrl: sanitized.thumbnailUrl ?? null,
    isCustom: true,
    createdBy: deps.userId,
  };

  deps.storage.saveCustomExercise(exercise);
  deps.storage.enqueueMutation({
    entityType: "exercise",
    entityId: exercise.id,
    operation: "create",
    payload: sanitized,
    endpoint: "/exercises",
    method: "POST",
  });

  return ok(exercise);
}

/**
 * Trim free-text fields and drop whitespace-only optional fields so that
 * local cache and the sync-queue payload agree. Pure; returns a new object.
 */
function sanitizeInput(input: CreateExerciseInput): CreateExerciseInput {
  const sanitized: CreateExerciseInput = {
    name: input.name.trim(),
    category: input.category,
    difficulty: input.difficulty,
    primaryMuscleGroups: input.primaryMuscleGroups,
    equipment: input.equipment,
  };

  const description = input.description?.trim();
  if (description) sanitized.description = description;

  const instructions = input.instructions?.trim();
  if (instructions) sanitized.instructions = instructions;

  if (input.secondaryMuscleGroups && input.secondaryMuscleGroups.length > 0) {
    sanitized.secondaryMuscleGroups = input.secondaryMuscleGroups;
  }

  const videoUrl = input.videoUrl?.trim();
  if (videoUrl) sanitized.videoUrl = videoUrl;

  const thumbnailUrl = input.thumbnailUrl?.trim();
  if (thumbnailUrl) sanitized.thumbnailUrl = thumbnailUrl;

  return sanitized;
}
