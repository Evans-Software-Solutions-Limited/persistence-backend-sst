/**
 * Remove-exercise command — drops an exercise from the active session.
 * (M3, legacy `useActiveWorkout.removeExercise` parity.)
 *
 * If the removed row was the only superset peer + one, the survivor
 * is ungrouped automatically (`removeExerciseFromSession` handles
 * that). Persists via the full-upsert `cacheActiveSession`.
 *
 * Spec: persistence-mobile/hooks/useActiveWorkout.tsx:1078
 */

import { removeExerciseFromSession } from "@/domain/services/sessionService";
import type { WorkoutSession } from "@/domain/models/session";
import type { StoragePort } from "@/domain/ports/storage.port";
import { fail, ok, type Result } from "@/shared/errors";
import type { SessionNotFoundError } from "./log-set.command";

export type RemoveExerciseCommandDeps = {
  storage: StoragePort;
  userId: string;
};

export type RemoveExerciseInput = {
  sessionExerciseId: string;
};

export function removeExerciseCommand(
  deps: RemoveExerciseCommandDeps,
  input: RemoveExerciseInput,
): Result<WorkoutSession, SessionNotFoundError> {
  const session = deps.storage.getActiveSession(deps.userId);
  if (!session) {
    return fail({
      kind: "session_not_found",
      code: "SESSION_NOT_FOUND",
      message: "No active session — cannot remove an exercise.",
    });
  }
  const updated = removeExerciseFromSession(session, input.sessionExerciseId);
  deps.storage.cacheActiveSession(deps.userId, updated);
  deps.storage.invalidateDashboard(deps.userId);
  return ok(updated);
}
