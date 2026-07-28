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
  const queued = deps.storage.getQueuedEntriesForEntity("exercise", id);
  const creates = queued.filter((entry) => entry.operation === "create");

  // ⚠ An `in_flight` create is a request that may ALREADY have committed. It must
  // not take the purely-local path: `discardEntries` is an unconditional DELETE
  // (unlike the status-conditional `updateMutationPayload`), so discarding it
  // would drop the queue row while the POST still lands server-side — the drain's
  // `markMutationCompleted`/`swapLocalExerciseId` would then no-op against a row
  // that no longer exists, leaving an orphaned exercise that reappears on the next
  // library refresh while the user believes it was deleted. The window is real and
  // seconds wide now that an enqueue triggers an immediate drain.
  const inFlightCreate = creates.find((entry) => entry.status === "in_flight");

  if (inFlightCreate) {
    // Queue the delete instead of sending it: the id is still local, so an
    // immediate API call would 400. `swapLocalExerciseId` rewrites this endpoint
    // when the in-flight create's reply lands, so the DELETE then reaches the real
    // resource. Evict locally so the UI reflects the user's intent immediately.
    //
    // Sibling edits are dropped: they can't have committed (their create hasn't
    // returned yet), so applying them server-side is pure waste against a row the
    // very next queue entry deletes. The in-flight create itself is deliberately
    // left alone — see above.
    deps.storage.discardEntries(
      queued
        .filter((entry) => entry.id !== inFlightCreate.id)
        .map((entry) => entry.id),
    );
    deps.storage.enqueueMutation({
      entityType: "exercise",
      entityId: id,
      operation: "delete",
      payload: {},
      endpoint: `/exercises/${id}`,
      method: "DELETE",
    });
    deps.storage.removeCachedExercise(id);
    return ok(undefined);
  }

  if (creates.length > 0) {
    // Never sent (or terminally failed) — purely local. Discard EVERY queued
    // entry for this exercise, not just the creates: an edit made while the create
    // was blocked enqueues its own `PATCH /exercises/local-…`, and leaving that
    // behind would have it address a discarded id forever, burn its budget, and
    // surface in /sync-failed as an unexplainable error for an exercise the user
    // deleted.
    //
    // ⚠ `in_flight` siblings are discarded here TOO, which looks like it
    // contradicts the branch above but doesn't. What must be preserved is an
    // in-flight CREATE, because it may already have committed a row we'd then
    // orphan — and branch 1 has already claimed every such case. Everything that
    // can still be in flight at this point addresses `/exercises/local-…`, which
    // Postgres rejects with 22P02 before it can change anything, so there is no
    // server state to protect and nothing to reconcile: dropping the row while the
    // doomed request is airborne just means the drain's completion/failure update
    // no-ops, which is exactly right.
    //
    // Reachable, and it was: a create deferred behind a backoff window while an
    // edit's PATCH went in flight ahead of it (the drain skips not-yet-due rows and
    // takes the next entry). Excluding in-flight entries here stranded that PATCH
    // against a discarded local id, where no id swap would ever rewrite it — it
    // burnt all three retries and landed in /sync-failed as
    // "Invalid identifier format", the precise symptom this command exists to stop.
    deps.storage.discardEntries(queued.map((entry) => entry.id));
    deps.storage.removeCachedExercise(id);
    return ok(undefined);
  }

  const result = await deps.api.deleteExercise(id);
  if (!result.ok) return result;
  deps.storage.removeCachedExercise(id);
  return ok(undefined);
}
