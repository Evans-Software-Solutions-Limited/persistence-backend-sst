/**
 * Resume-session command — reads the user's in-progress session from
 * SQLite. (M3, Story-008.)
 *
 * Wraps `storage.getActiveSession(userId)` so callers don't reach
 * into the storage port directly. Returns the session or null if no
 * in-progress row exists. No side-effects.
 *
 * The app-launch resume prompt (`useResumeSession` + `<ResumePrompt>`)
 * calls this on mount; if a row comes back the user is offered
 * Continue (route to `/(app)/session?sessionId=…`) or Discard (fires
 * `cancelSessionCommand`).
 *
 * Spec: specs/05-active-session/requirements.md STORY-008
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 9
 */

import type { WorkoutSession } from "@/domain/models/session";
import type { StoragePort } from "@/domain/ports/storage.port";

export type ResumeSessionCommandDeps = {
  storage: StoragePort;
  userId: string;
};

export function resumeSessionCommand(
  deps: ResumeSessionCommandDeps,
): WorkoutSession | null {
  return deps.storage.getActiveSession(deps.userId);
}
