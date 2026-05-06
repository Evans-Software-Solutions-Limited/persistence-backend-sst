/**
 * Cancel-session command — finalizes the active session as cancelled
 * and queues the bulk-record flush. (M3, Story-007.)
 *
 * Same shape as `completeSessionCommand` — one bulk POST per session,
 * single transaction server-side. Logged sets are preserved per
 * Story-007 AC ("queryable but not counted for progress"); the
 * server's PR-detection skips cancelled sessions.
 *
 * Spec: specs/05-active-session/requirements.md STORY-007
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 8
 */

import {
  finalizeSessionCommand,
  type CompletedSessionResult,
  type CompleteSessionCommandDeps,
} from "./complete-session.command";
import type { Result } from "@/shared/errors";
import type { SessionNotFoundError } from "./log-set.command";

export type CancelSessionCommandDeps = CompleteSessionCommandDeps;

export type CancelSessionInput = {
  notes?: string | null;
};

export function cancelSessionCommand(
  deps: CancelSessionCommandDeps,
  input: CancelSessionInput = {},
): Result<CompletedSessionResult, SessionNotFoundError> {
  return finalizeSessionCommand(deps, "cancelled", input.notes ?? null);
}
