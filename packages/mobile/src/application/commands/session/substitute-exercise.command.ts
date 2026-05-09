/**
 * Substitute-exercise command — swaps an exercise mid-session (M3).
 *
 * Old row stays in place with `isSubstituted: true` (sets preserved
 * per Story-004 AC); new row inserted at `oldSortOrder + 1`,
 * downstream rows shift by +1 — all in-memory, persisted via the
 * full-upsert `cacheActiveSession` (EXECUTION_PLAN § 3.4).
 *
 * Spec: specs/05-active-session/requirements.md STORY-004
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 4
 */

import {
  substituteExercise,
  type IdFactory,
} from "@/domain/services/sessionService";
import type { Exercise } from "@/domain/models/exercise";
import type { WorkoutSession } from "@/domain/models/session";
import type { StoragePort } from "@/domain/ports/storage.port";
import { fail, ok, type Result } from "@/shared/errors";
import type { SessionNotFoundError } from "./log-set.command";

export type SubstituteExerciseCommandDeps = {
  storage: StoragePort;
  generateId: IdFactory;
  userId: string;
};

export type SubstituteExerciseInput = {
  /** id of the existing `session_exercise` row to mark as substituted. */
  oldSessionExerciseId: string;
  /** Replacement exercise from the library. */
  newExercise: Exercise;
};

export function substituteExerciseCommand(
  deps: SubstituteExerciseCommandDeps,
  input: SubstituteExerciseInput,
): Result<WorkoutSession, SessionNotFoundError> {
  const session = deps.storage.getActiveSession(deps.userId);
  if (!session) {
    return fail({
      kind: "session_not_found",
      code: "SESSION_NOT_FOUND",
      message: "No active session — cannot substitute an exercise.",
    });
  }

  const updated = substituteExercise(
    session,
    input.oldSessionExerciseId,
    input.newExercise,
    deps.generateId,
  );

  deps.storage.cacheActiveSession(deps.userId, updated);
  deps.storage.invalidateDashboard(deps.userId);

  return ok(updated);
}
