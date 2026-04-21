import type { ApiPort } from "@/domain/ports/api.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import { ok, type Result, type ApiError } from "@/shared/errors";

/**
 * Delete a custom exercise.
 *
 * Online-first: awaits the API DELETE and only evicts the local cache
 * on success. Matches legacy `persistence-mobile` UX — if the server
 * rejects (non-owner, already deleted, network error), the exercise
 * stays visible and the container surfaces the error. The smoke-test
 * flow (AC 7.17) exercises the happy path; offline-queued delete is a
 * future concern (covered by a later milestone that extends the sync
 * queue for delete operations).
 *
 * Spec: specs/03-exercise-library/design.md § Hierarchical Filter Modal
 *       > Legacy reference paths · requirements.md AC 7.17
 */

export type DeleteExerciseCommandDeps = {
  api: ApiPort;
  storage: StoragePort;
};

export async function deleteExerciseCommand(
  deps: DeleteExerciseCommandDeps,
  id: string,
): Promise<Result<void, ApiError>> {
  const result = await deps.api.deleteExercise(id);
  if (!result.ok) return result;
  deps.storage.removeCachedExercise(id);
  return ok(undefined);
}
