import {
  reorderExercises,
  buildReorderBlocks,
} from "@/domain/services/workout.service";
import type { WorkoutSession } from "@/domain/models/session";
import type { StoragePort } from "@/domain/ports/storage.port";
import { fail, ok, type Result } from "@/shared/errors";
import type { SessionNotFoundError } from "./log-set.command";

export function reorderSessionExercisesCommand(
  deps: { storage: StoragePort; userId: string },
  input: { sessionExerciseId: string } & (
    | { direction: -1 | 1; toPosition?: never }
    | { toPosition: number; direction?: never }
  ),
): Result<WorkoutSession, SessionNotFoundError> {
  const session = deps.storage.getActiveSession(deps.userId);
  if (!session) {
    return fail({
      kind: "session_not_found",
      code: "SESSION_NOT_FOUND",
      message: "No active session — cannot reorder exercises.",
    });
  }
  const ordered = [...session.exercises].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  const sourceIndex = ordered.findIndex(
    (exercise) => exercise.id === input.sessionExerciseId,
  );
  if (sourceIndex < 0) return ok(session);
  const source = ordered[sourceIndex];
  const blocks = buildReorderBlocks(ordered);
  const sourceBlock = blocks.findIndex((block) => block.includes(source));
  const targetBlock =
    input.toPosition == null ? sourceBlock + input.direction : input.toPosition;
  if (targetBlock < 0 || targetBlock >= blocks.length) return ok(session);
  const targetIndex = ordered.indexOf(blocks[targetBlock][0]);
  const updated = {
    ...session,
    exercises: reorderExercises(ordered, sourceIndex, targetIndex),
  };
  deps.storage.cacheActiveSession(deps.userId, updated);
  return ok(updated);
}
