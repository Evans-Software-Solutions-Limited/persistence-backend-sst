import { reorderExercises } from "@/domain/services/workout.service";
import type { WorkoutSession } from "@/domain/models/session";
import type { StoragePort } from "@/domain/ports/storage.port";
import { fail, ok, type Result } from "@/shared/errors";
import type { SessionNotFoundError } from "./log-set.command";

export function reorderSessionExercisesCommand(
  deps: { storage: StoragePort; userId: string },
  input: { sessionExerciseId: string; direction: -1 | 1 },
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
  const blocks: (typeof ordered)[] = [];
  const used = new Set<number>();
  for (const exercise of ordered) {
    if (exercise.supersetGroup == null) blocks.push([exercise]);
    else if (!used.has(exercise.supersetGroup)) {
      used.add(exercise.supersetGroup);
      blocks.push(
        ordered.filter(
          (candidate) => candidate.supersetGroup === exercise.supersetGroup,
        ),
      );
    }
  }
  const sourceBlock = blocks.findIndex((block) => block.includes(source));
  const targetBlock = sourceBlock + input.direction;
  if (targetBlock < 0 || targetBlock >= blocks.length) return ok(session);
  const targetIndex = ordered.indexOf(blocks[targetBlock][0]);
  const updated = {
    ...session,
    exercises: reorderExercises(ordered, sourceIndex, targetIndex),
  };
  deps.storage.cacheActiveSession(deps.userId, updated);
  return ok(updated);
}
