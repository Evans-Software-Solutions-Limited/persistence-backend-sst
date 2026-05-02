/**
 * Delete-workout command — offline-capable.
 *
 * Drops the workout from local cache (detail + every list slice it
 * appears in) and enqueues a DELETE /workouts/:id mutation. The sync
 * engine flushes the DELETE on the next online window; the optimistic
 * UI sees the workout vanish immediately.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-005 ACs 5.1, 5.4
 */

import type { StoragePort } from "@/domain/ports/storage.port";
import { ok, type Result, type ApiError } from "@/shared/errors";

export type DeleteWorkoutCommandDeps = {
  storage: StoragePort;
  userId: string;
};

export function deleteWorkoutCommand(
  deps: DeleteWorkoutCommandDeps,
  workoutId: string,
): Result<void, ApiError> {
  deps.storage.removeCachedWorkout(deps.userId, workoutId);
  deps.storage.enqueueMutation({
    entityType: "workout",
    entityId: workoutId,
    operation: "delete",
    payload: {},
    endpoint: `/workouts/${workoutId}`,
    method: "DELETE",
  });
  // Dashboard's `recentWorkouts` slice depends on the workout list;
  // drop its cache so home doesn't keep showing the deleted row
  // until the dashboard TTL elapses.
  deps.storage.invalidateDashboard(deps.userId);
  return ok(undefined);
}
