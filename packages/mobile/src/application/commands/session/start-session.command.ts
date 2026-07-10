/**
 * Start-session command — opens a new active session in SQLite (M3).
 *
 * No enqueue here — the bulk-record flush only fires on session
 * complete/cancel (per BACKEND_BRIEF § 7 / FRONTEND_BRIEF § Decision
 * recap). Sets persist locally between Start and Finish.
 *
 * Idempotent guard: if an active session already exists for the user,
 * returns the existing session under an `ACTIVE_SESSION_EXISTS` error
 * so the caller can prompt resume-or-discard (FRONTEND_BRIEF § Group B).
 *
 * Spec: specs/05-active-session/requirements.md STORY-001 / STORY-009
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 3
 */

import {
  createEmptySession,
  createSessionFromWorkout,
  type IdFactory,
} from "@/domain/services/sessionService";
import type { SessionClientRef, WorkoutSession } from "@/domain/models/session";
import type { Workout } from "@/domain/models/workout";
import type { StoragePort } from "@/domain/ports/storage.port";
import { fail, ok, type Result } from "@/shared/errors";

export type StartSessionCommandDeps = {
  storage: StoragePort;
  generateId: IdFactory;
  userId: string;
  /** Override clock for deterministic tests; defaults to `new Date()`. */
  now?: () => Date;
};

export type StartSessionInput = {
  /** When set, seeds the session from this template; otherwise Quick Start. */
  workout?: Workout;
  /**
   * M18 coach Start-live — stamps the on-behalf client onto the session so it
   * persists in SQLite and survives a rehydrate (the coach context must NOT
   * live only on the AsyncStorage pointer).
   */
  withClient?: SessionClientRef | null;
};

export type ActiveSessionExistsError = {
  readonly kind: "active_session_exists";
  readonly code: "ACTIVE_SESSION_EXISTS";
  readonly message: string;
  readonly existing: WorkoutSession;
};

export function startSessionCommand(
  deps: StartSessionCommandDeps,
  input: StartSessionInput = {},
): Result<WorkoutSession, ActiveSessionExistsError> {
  const existing = deps.storage.getActiveSession(deps.userId);
  if (existing) {
    return fail({
      kind: "active_session_exists",
      code: "ACTIVE_SESSION_EXISTS",
      message: "An active session is already in progress for this user.",
      existing,
    });
  }

  const ctx = {
    userId: deps.userId,
    now: (deps.now?.() ?? new Date()).toISOString(),
    withClient: input.withClient ?? null,
  };

  const session = input.workout
    ? createSessionFromWorkout(input.workout, ctx, deps.generateId)
    : createEmptySession(ctx, deps.generateId);

  deps.storage.cacheActiveSession(deps.userId, session);
  // M2 learning #3: every session-mutating command invalidates the
  // dashboard. Recent Activity + progress tiles read this slice.
  deps.storage.invalidateDashboard(deps.userId);

  return ok(session);
}
