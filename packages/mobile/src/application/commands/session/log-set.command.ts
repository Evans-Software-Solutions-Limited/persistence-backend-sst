/**
 * Log-set command — appends a set to a session exercise (M3).
 *
 * Pure local write. The bulk-record flush carries every set on
 * session complete; per-set network is by design absent
 * (FRONTEND_BRIEF § Decision recap).
 *
 * Spec: specs/05-active-session/requirements.md STORY-002
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 3
 */

import {
  addSetToExercise,
  type IdFactory,
} from "@/domain/services/sessionService";
import type { ExerciseSet, WorkoutSession } from "@/domain/models/session";
import type { StoragePort } from "@/domain/ports/storage.port";
import { fail, ok, type Result } from "@/shared/errors";

export type LogSetCommandDeps = {
  storage: StoragePort;
  generateId: IdFactory;
  userId: string;
};

export type LogSetInput = {
  sessionExerciseId: string;
  /** Field-level overrides for the new set; all fields optional. */
  weightKg?: number | null;
  reps?: number | null;
  rpe?: number | null;
  durationSeconds?: number | null;
  distanceMeters?: number | null;
};

export type SessionNotFoundError = {
  readonly kind: "session_not_found";
  readonly code: "SESSION_NOT_FOUND";
  readonly message: string;
};

export function logSetCommand(
  deps: LogSetCommandDeps,
  input: LogSetInput,
): Result<WorkoutSession, SessionNotFoundError> {
  const session = deps.storage.getActiveSession(deps.userId);
  if (!session) {
    return fail({
      kind: "session_not_found",
      code: "SESSION_NOT_FOUND",
      message: "No active session — cannot log a set.",
    });
  }

  const partial: Partial<ExerciseSet> = {};
  if (input.weightKg !== undefined) partial.weightKg = input.weightKg;
  if (input.reps !== undefined) partial.reps = input.reps;
  if (input.rpe !== undefined) partial.rpe = input.rpe;
  if (input.durationSeconds !== undefined)
    partial.durationSeconds = input.durationSeconds;
  if (input.distanceMeters !== undefined)
    partial.distanceMeters = input.distanceMeters;

  const updated = addSetToExercise(
    session,
    input.sessionExerciseId,
    partial,
    deps.generateId,
  );

  deps.storage.cacheActiveSession(deps.userId, updated);
  deps.storage.invalidateDashboard(deps.userId);

  return ok(updated);
}
