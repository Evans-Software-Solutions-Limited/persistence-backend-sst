import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../relationships/auditTrainerAction";
import {
  SessionRepository,
  type RecordSessionInput,
  type RecordedSession,
} from "../../repositories/sessionRepository";
import { PersonalRecordsRepository } from "../../repositories/personalRecordsRepository";
import { ProgramAssignmentRepository } from "../../repositories/programAssignmentRepository";
import { safeEvaluateStreaks, resolveEventTs } from "../../streaks/evaluate";
import { safeRecomputeVolume } from "../../progress/recompute";
import { emitTrainerOnBehalfNotification } from "../onBehalfNotifications";

export interface RecordClientSessionArgs {
  trainerId: string;
  clientId: string;
  payload: RecordSessionInput;
}

export type RecordClientSessionResult =
  | { ok: true; session: RecordedSession }
  | { ok: false; status: 403; body: { code: string; message: string } };

/**
 * Shared core for a coach RECORDING A FULL SESSION on behalf of a client —
 * the M18 Start-live path (a coach-run in-person PT session logged on the
 * coach's device and recorded as the CLIENT's completed workout).
 *
 * This is the sets-carrying sibling of `logClientSessionOnBehalf`, which only
 * writes a session HEADER (`SessionRepository.create`). Start-live logs full
 * exercises + sets live, so it reuses `SessionRepository.recordSession` — the
 * same atomic bulk-record path the self `POST /sessions/record` uses — with two
 * on-behalf extras threaded in:
 *
 *   1. `logged_by_user_id = trainerId` stamped on the CLIENT's session row.
 *   2. The `trainer_actions_audit` row written INSIDE the same transaction via
 *      the unconditional `afterRecord` hook — so a `logged_by_user_id` write is
 *      never left un-audited, for a completed OR a cancelled (discarded) session
 *      (cross-cuts § 1.4.2).
 *
 * Authorization: the shared `assertTrainerCanActForClient` gate (role-first,
 * then active relationship). NO entitlement gate — mirrors
 * `logClientSessionOnBehalf`: the relationship IS the authorization, and the
 * client already "owns" the workout being logged for them. This is the
 * user-data-isolation dangerous area (repo CLAUDE.md): every write is scoped to
 * `clientId`, gated on an ACTIVE trainer↔client relationship.
 *
 * Post-commit side effects (completed sessions only, all best-effort, all
 * scoped to the CLIENT — mirroring the self `/sessions/record` handler):
 * streak advance, weekly-volume recompute, and a `workout_logged_on_behalf`
 * client notification. A cancelled (discarded) session records + audits but
 * fires none of these — a discarded workout isn't progress, and the client
 * shouldn't be pinged that their coach "logged" an abandoned session.
 */
export async function recordClientSessionOnBehalf({
  trainerId,
  clientId,
  payload,
}: RecordClientSessionArgs): Promise<RecordClientSessionResult> {
  const verdict = await assertTrainerCanActForClient(trainerId, clientId);
  if (!verdict.allowed) {
    return { ok: false, status: verdict.status, body: verdict.body };
  }

  const sessionRepository = new SessionRepository();
  const personalRecordsRepository = new PersonalRecordsRepository();
  const programAssignmentRepository = new ProgramAssignmentRepository();

  const recorded = await sessionRepository.recordSession(
    clientId,
    payload,
    // PR detection — inside the tx, scoped to the CLIENT (the records are the
    // client's, not the coach's).
    (uid, sessionId, tx) =>
      personalRecordsRepository.recordPRsForSession(uid, sessionId, tx),
    // Completed-only hook — link the session to the client's open
    // workout_assignments occurrence (adherence). Only wired when the session
    // references a workout template, exactly like the self handler.
    payload.workoutId
      ? (uid, sessionId, tx) =>
          programAssignmentRepository.linkCompletedSession(
            uid,
            payload.workoutId!,
            sessionId,
            tx,
          )
      : undefined,
    {
      loggedByUserId: trainerId,
      // Unconditional in-tx audit — runs for completed AND cancelled records so
      // no on-behalf `logged_by_user_id` write escapes the audit trail.
      afterRecord: async (uid, sessionId, tx) => {
        await auditTrainerAction({
          trainerId,
          clientId: uid,
          actionType: "workout_logged_on_behalf",
          targetTable: "workout_sessions",
          targetRowId: sessionId,
          // A summary, NOT the full sets payload — audit rows shouldn't carry
          // the whole session body.
          payload: {
            workoutId: payload.workoutId ?? null,
            name: payload.name ?? null,
            status: payload.status,
            exerciseCount: payload.exercises.length,
            completedAt: payload.completedAt ?? null,
          },
          tx,
        });
      },
    },
  );

  // Post-commit, completed only: mirror the self handler's streak + volume
  // freshening (scoped to the CLIENT), then a best-effort client notification.
  //
  // `!recorded.wasReplay` guard (M13): a retried on-behalf record (same
  // clientSessionId, lost ack) short-circuits to the already-committed session
  // — its status is still "completed", so without this guard the sync queue's
  // retries would re-fire the client notification/push ("your coach logged a
  // workout") on EVERY attempt. `emitTrainerOnBehalfNotification` is not
  // idempotent (it inserts a fresh notification row + dispatches a new push),
  // so it must run only for a genuinely-new record. Streaks/volume are
  // idempotent, but skip them too — a replay changes nothing to re-freshen.
  if (recorded.status === "completed" && !recorded.wasReplay) {
    await safeEvaluateStreaks(
      clientId,
      "workout_logged",
      resolveEventTs(payload.completedAt),
    );
    await safeRecomputeVolume(clientId);

    await emitTrainerOnBehalfNotification({
      clientId,
      trainerId,
      type: "workout_logged_on_behalf",
      title: "Workout logged by your coach",
      buildMessage: (coachName) => `${coachName} logged a workout for you`,
      deepLink: `/sessions/${recorded.id}`,
      relatedEntityType: "workout_session",
      relatedEntityId: recorded.id,
    });
  }

  return { ok: true, session: recorded };
}
