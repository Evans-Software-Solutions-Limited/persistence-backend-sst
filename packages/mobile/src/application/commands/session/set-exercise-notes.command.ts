/**
 * Set-exercise-notes command — persists the per-exercise notes
 * captured by `ExerciseNotesPopover` mid-session. (M3, legacy
 * `useActiveWorkout.updateExerciseNote` parity.)
 *
 * Empty / whitespace-only input is normalised to null so the bulk-
 * record payload doesn't carry empty strings.
 *
 * Spec: persistence-mobile/hooks/useActiveWorkout.tsx (updateExerciseNote)
 */

import { setExerciseNotes } from "@/domain/services/sessionService";
import type { WorkoutSession } from "@/domain/models/session";
import type { StoragePort } from "@/domain/ports/storage.port";
import { fail, ok, type Result } from "@/shared/errors";
import type { SessionNotFoundError } from "./log-set.command";

export type SetExerciseNotesCommandDeps = {
  storage: StoragePort;
  userId: string;
};

export type SetExerciseNotesInput = {
  sessionExerciseId: string;
  notes: string;
};

export function setExerciseNotesCommand(
  deps: SetExerciseNotesCommandDeps,
  input: SetExerciseNotesInput,
): Result<WorkoutSession, SessionNotFoundError> {
  const session = deps.storage.getActiveSession(deps.userId);
  if (!session) {
    return fail({
      kind: "session_not_found",
      code: "SESSION_NOT_FOUND",
      message: "No active session — cannot update notes.",
    });
  }
  const trimmed = input.notes.trim();
  const next = setExerciseNotes(
    session,
    input.sessionExerciseId,
    trimmed.length > 0 ? trimmed : null,
  );
  deps.storage.cacheActiveSession(deps.userId, next);
  deps.storage.invalidateDashboard(deps.userId);
  return ok(next);
}
