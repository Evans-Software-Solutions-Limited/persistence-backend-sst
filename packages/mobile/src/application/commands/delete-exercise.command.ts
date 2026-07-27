import type { ApiPort } from "@/domain/ports/api.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import { ok, type Result, type ApiError } from "@/shared/errors";

/**
 * Delete a custom exercise.
 *
 * Two paths, chosen by whether the server has ever accepted this exercise:
 *
 * 1. **Never synced** — an outstanding (non-completed) create is still queued.
 *    Purely local: discard the queued create and evict the cached row, with NO
 *    API call. `DELETE /exercises/local-…` hits the uuid `exercises.id` column,
 *    raises Postgres 22P02 and returns 400 "Invalid identifier format", so this
 *    command used to return an error, the row stayed on screen, and the user saw
 *    a delete fail on an exercise they had just created. Discarding the create is
 *    also what makes the delete *correct* rather than merely quiet — otherwise
 *    that create would flush later and the exercise would reappear.
 *
 * 2. **Synced** — unchanged: online-first, await the API DELETE and only evict
 *    the cache on success. Matches legacy `persistence-mobile` UX; if the server
 *    rejects (non-owner, already deleted, offline) the exercise stays visible and
 *    the container surfaces the error.
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
  // The QUEUE is the authority, not the id's prefix. A `local-` prefix alone
  // doesn't prove the server hasn't seen it (a completed create may have swapped
  // the id, leaving a stale cache row), and conversely an id without the prefix
  // can't have an outstanding create. Asking for outstanding creates answers the
  // real question: has anything been accepted for this row?
  const outstandingCreates = deps.storage
    .getQueuedEntriesForEntity("exercise", id)
    .filter((entry) => entry.operation === "create");

  if (outstandingCreates.length > 0) {
    deps.storage.discardEntries(outstandingCreates.map((entry) => entry.id));
    deps.storage.removeCachedExercise(id);
    return ok(undefined);
  }

  const result = await deps.api.deleteExercise(id);
  if (!result.ok) return result;
  deps.storage.removeCachedExercise(id);
  return ok(undefined);
}
