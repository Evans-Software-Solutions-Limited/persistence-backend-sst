/**
 * Complete-session command — finalizes the active session and queues
 * the bulk-record flush. (M3, Story-006.)
 *
 * Single-intent flush per FRONTEND_BRIEF § Decision recap: one
 * `recordSession` POST carries the entire session payload (root +
 * all exercises + all sets). Server writes everything in one
 * transaction and runs PR detection inside it. The active-session
 * SQLite row is kept until the worker swaps in server IDs (commit 9
 * regression test pins the close-mid-session → restore path).
 *
 * Payload bound: largest realistic session ≈ 10 exercises × 10 sets ×
 * ~200 bytes/set ≈ 20KB — well below Lambda's 6MB sync-invoke ceiling
 * (EXECUTION_PLAN § 4 mitigation).
 *
 * Spec: specs/05-active-session/requirements.md STORY-006
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 8
 */

import {
  calculateSummary,
  markLoggedSetsCompleted,
} from "@/domain/services/sessionService";
import type { WorkoutSession } from "@/domain/models/session";
import type { RecordSessionInput } from "@/domain/ports/api.port";
import type { RecentSetEntry, StoragePort } from "@/domain/ports/storage.port";
import { fail, ok, type Result } from "@/shared/errors";
import type { SessionNotFoundError } from "./log-set.command";

export type CompleteSessionCommandDeps = {
  storage: StoragePort;
  userId: string;
  /** Override clock for deterministic tests. */
  now?: () => Date;
};

export type CompleteSessionInput = {
  /** Optional user-entered workout notes (captured on the rating screen). */
  notes?: string | null;
  /**
   * Optional 1-10 difficulty rating captured on the rating screen.
   * Maps to the bulk-record payload's `sessionRating` (and the
   * server's `difficulty_ranking`). Null when the user skips or the
   * session was cancelled.
   */
  rating?: number | null;
  /**
   * M18 coach Start-live. When set, this session is recorded ON BEHALF of the
   * given client: the bulk-record flush routes to
   * `POST /trainers/me/clients/:id/sessions/record` (the server stamps
   * `logged_by_user_id`) instead of the self `POST /sessions/record`.
   * Null/undefined = the athlete's own session.
   */
  onBehalfClientId?: string | null;
};

export type CompletedSessionResult = {
  session: WorkoutSession;
  /** Total seconds from `startedAt` → `completedAt`, ≥ 0. */
  totalDurationSeconds: number;
};

export function completeSessionCommand(
  deps: CompleteSessionCommandDeps,
  input: CompleteSessionInput = {},
): Result<CompletedSessionResult, SessionNotFoundError> {
  return finalizeSessionCommand(
    deps,
    "completed",
    input.notes ?? null,
    input.rating ?? null,
    input.onBehalfClientId ?? null,
  );
}

/**
 * Shared finalize path between complete + cancel. Both go through the
 * same enqueue + cache-update flow; only the `status` differs (and
 * downstream how the server treats it: completed flushes PR detection,
 * cancelled does not).
 *
 * Exported so cancel-session can call it with the same semantics
 * without re-implementing the bulk-record build.
 */
export function finalizeSessionCommand(
  deps: CompleteSessionCommandDeps,
  status: "completed" | "cancelled",
  notes: string | null,
  rating: number | null = null,
  /**
   * M18 coach Start-live — when set, the flush is enqueued against the
   * on-behalf record endpoint for this client instead of the self endpoint.
   */
  onBehalfClientId: string | null = null,
): Result<CompletedSessionResult, SessionNotFoundError> {
  const session = deps.storage.getActiveSession(deps.userId);
  if (!session) {
    return fail({
      kind: "session_not_found",
      code: "SESSION_NOT_FOUND",
      message: `No active session — cannot ${status === "completed" ? "complete" : "cancel"}.`,
    });
  }

  const completedAt = (deps.now?.() ?? new Date()).toISOString();

  // Synthesize per-set completion at finalize time. Post-1A.1 the
  // Mark-Complete UI is gone (legacy parity) — no UI path flips
  // `set.isCompleted` true. But calculateSummary, detectPersonalRecords,
  // and the bulk-record payload still gate on it. `markLoggedSets-
  // Completed` flips it for every set with both `weightKg` and `reps`
  // non-null, which is the legacy "set has data → it's logged" rule.
  // Only applied on completion: cancelled sessions aren't real workouts
  // and shouldn't have their sets count toward stats / PRs / server
  // history.
  const sessionWithCompletion =
    status === "completed"
      ? markLoggedSetsCompleted(session, completedAt)
      : session;
  const summary = calculateSummary(
    { ...sessionWithCompletion, completedAt },
    completedAt,
  );

  const finalized: WorkoutSession = {
    ...sessionWithCompletion,
    status,
    completedAt,
    notes,
  };

  // Build the bulk-record payload from the (now-finalized) session.
  // Server-assigned UUIDs replace the local-… ids on the worker's
  // success path via `swapLocalSessionId` (commit 2). `sessionRating`
  // and `difficultyRanking` both carry the 1-10 rating — the server
  // accepts either; we send `sessionRating` as primary and
  // `difficultyRanking` as a back-compat alias mirroring legacy
  // `useActiveWorkout.recordWorkout` payload shape.
  const payload: RecordSessionInput = {
    workoutId: finalized.workoutId,
    name: finalized.name,
    startedAt: finalized.startedAt,
    completedAt,
    status,
    totalDurationSeconds: summary.duration,
    userNotes: notes,
    sessionRating: rating,
    difficultyRanking: rating,
    exercises: finalized.exercises.map((ex) => ({
      exerciseId: ex.exerciseId,
      sortOrder: ex.sortOrder,
      supersetGroup: ex.supersetGroup,
      isSubstituted: ex.isSubstituted,
      originalExerciseId: ex.originalExerciseId,
      notes: ex.notes,
      sets: ex.sets.map((set) => ({
        setNumber: set.setNumber,
        reps: set.reps,
        weightKg: set.weightKg,
        durationSeconds: set.durationSeconds,
        distanceMeters: set.distanceMeters,
        rpe: set.rpe,
        isCompleted: set.isCompleted,
        completedAt: set.completedAt,
      })),
    })),
  };

  // Persist the finalized state locally first, then enqueue. Order
  // matters: if the queue write throws, the SQLite row already
  // reflects the user's intent so a relaunch can re-enqueue.
  deps.storage.cacheActiveSession(deps.userId, finalized);

  // Snapshot the just-completed session's logged sets into the
  // recent-sets cache so the NEXT session's "Previous" hints surface
  // immediately. Mirrors legacy `user_history.recent_sets` but is
  // local-only — V2 has no equivalent server endpoint yet, and
  // offline-first means we must populate the chip from the device's
  // own history. Skipped for cancelled sessions: those aren't real
  // workouts and shouldn't shadow the user's last actual attempt.
  //
  // The filter is "weight + reps both non-null", NOT "isCompleted ===
  // true". Post-1A.1 the legacy port removed the per-set Mark-Complete
  // UI (legacy has no such concept — any set with data is "logged"),
  // so `set.isCompleted` is effectively dead — no UI or command path
  // flips it. Filtering by it would empty the cache on every session.
  // Both fields filled is the meaningful "user logged something
  // intentional" signal that matches legacy `previousSets[]`.
  if (status === "completed") {
    const recentSets: RecentSetEntry[] = [];
    for (const ex of finalized.exercises) {
      // Substituted rows are excluded — their sets belong to an
      // exercise the user moved away from. The new (non-substituted)
      // row carries the canonical attempt for that exerciseId.
      if (ex.isSubstituted) continue;
      for (const set of ex.sets) {
        if (set.weightKg == null || set.reps == null) continue;
        recentSets.push({
          exerciseId: ex.exerciseId,
          setNumber: set.setNumber,
          weightKg: set.weightKg,
          reps: set.reps,
          recordedAt: completedAt,
        });
      }
    }
    if (recentSets.length > 0) {
      deps.storage.upsertRecentSets(deps.userId, recentSets);
    }
  }

  // Coach Start-live routes the flush to the on-behalf record endpoint; the
  // sync worker POSTs `entry.endpoint` generically, and its athlete-summary
  // capture is gated on the self `/sessions/record` string so it NATURALLY
  // skips the coach case (that cache is keyed by the coach's own userId and
  // must not be polluted with the client's PRs).
  const endpoint = onBehalfClientId
    ? `/trainers/me/clients/${onBehalfClientId}/sessions/record`
    : "/sessions/record";

  deps.storage.enqueueMutation({
    entityType: "session",
    entityId: finalized.id,
    operation: "create",
    payload,
    endpoint,
    method: "POST",
  });

  // M2 learning #3 — Recent Activity + progress.* on the home tab.
  deps.storage.invalidateDashboard(deps.userId);

  return ok({ session: finalized, totalDurationSeconds: summary.duration });
}
