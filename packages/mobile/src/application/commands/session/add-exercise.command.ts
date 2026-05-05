/**
 * Add-exercise command — appends an exercise to the active session (M3).
 *
 * Used by Quick Start (+ Add exercise) and mid-session add. Persists
 * via the full-upsert `cacheActiveSession`.
 *
 * Spec: specs/05-active-session/requirements.md STORY-009
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 4
 */

import {
  addExerciseToSession,
  type IdFactory,
} from "@/domain/services/sessionService";
import type { Exercise } from "@/domain/models/exercise";
import type { WorkoutSession } from "@/domain/models/session";
import type { StoragePort } from "@/domain/ports/storage.port";
import { fail, ok, type Result } from "@/shared/errors";
import type { SessionNotFoundError } from "./log-set.command";

export type AddExerciseCommandDeps = {
  storage: StoragePort;
  generateId: IdFactory;
  userId: string;
};

export type AddExerciseInput = {
  exercise: Exercise;
};

export function addExerciseCommand(
  deps: AddExerciseCommandDeps,
  input: AddExerciseInput,
): Result<WorkoutSession, SessionNotFoundError> {
  const session = deps.storage.getActiveSession(deps.userId);
  if (!session) {
    return fail({
      kind: "session_not_found",
      code: "SESSION_NOT_FOUND",
      message: "No active session — cannot add an exercise.",
    });
  }

  const updated = addExerciseToSession(
    session,
    input.exercise,
    deps.generateId,
  );

  deps.storage.cacheActiveSession(deps.userId, updated);
  deps.storage.invalidateDashboard(deps.userId);

  return ok(updated);
}
