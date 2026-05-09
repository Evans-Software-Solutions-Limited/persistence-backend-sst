/**
 * Complete-set command — marks a set complete (M3).
 *
 * Data-only. Rest-timer trigger is a UI-layer concern handled by
 * `useRestTimer` in commit 5.
 *
 * Spec: specs/05-active-session/requirements.md STORY-002 / STORY-003
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 3
 */

import { completeSet } from "@/domain/services/sessionService";
import type { WorkoutSession } from "@/domain/models/session";
import type { StoragePort } from "@/domain/ports/storage.port";
import { fail, ok, type Result } from "@/shared/errors";
import type { SessionNotFoundError } from "./log-set.command";

export type CompleteSetCommandDeps = {
  storage: StoragePort;
  userId: string;
  /** Override clock for deterministic tests. */
  now?: () => Date;
};

export type CompleteSetInput = {
  setId: string;
};

export function completeSetCommand(
  deps: CompleteSetCommandDeps,
  input: CompleteSetInput,
): Result<WorkoutSession, SessionNotFoundError> {
  const session = deps.storage.getActiveSession(deps.userId);
  if (!session) {
    return fail({
      kind: "session_not_found",
      code: "SESSION_NOT_FOUND",
      message: "No active session — cannot complete a set.",
    });
  }

  const completedAt = (deps.now?.() ?? new Date()).toISOString();
  const updated = completeSet(session, input.setId, completedAt);

  deps.storage.cacheActiveSession(deps.userId, updated);
  deps.storage.invalidateDashboard(deps.userId);

  return ok(updated);
}
