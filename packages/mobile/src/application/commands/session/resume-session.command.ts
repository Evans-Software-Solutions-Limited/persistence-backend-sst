/**
 * Resume-session command — reads the user's in-progress session from
 * SQLite. (M3, Story-008.)
 *
 * Wraps `storage.getActiveSession(userId)` so callers don't reach
 * into the storage port directly. Returns the session or null if no
 * in-progress row exists. No side-effects.
 *
 * Used by the regression suite to pin "kill mid-session → relaunch
 * → state restored" semantics. The user-facing resume affordance is
 * the global `ActiveSessionBanner` (legacy parity), not a launch-time
 * prompt.
 *
 * Spec: specs/05-active-session/requirements.md STORY-008
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
