import { getDb } from "@persistence/db/client";
import type { WorkoutSession } from "@persistence/db";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../relationships/auditTrainerAction";
import { SessionRepository } from "../../repositories/sessionRepository";
import { emitTrainerOnBehalfNotification } from "../onBehalfNotifications";

/**
 * Body shape for a coach logging a session on behalf of a client. Mirrors the
 * self `POST /sessions` validator exactly (cross-cuts § 1.2) so the same
 * `t.Object` is reused by the handler.
 */
export interface LogClientSessionBody {
  workoutId?: string;
  name?: string;
  status?: "in_progress" | "completed" | "cancelled";
  userNotes?: string;
}

export interface LogClientSessionArgs {
  trainerId: string;
  clientId: string;
  body: LogClientSessionBody;
}

export type LogClientSessionResult =
  | { ok: true; session: WorkoutSession }
  | { ok: false; status: 403; body: { code: string; message: string } };

/**
 * Shared core for the coach on-behalf session write (10-trainer-features
 * STORY-010, cross-cuts § 1.1 / § 1.2). Mirrors the self `POST /sessions`
 * create but stamps `logged_by_user_id = trainerId` on the CLIENT's row.
 *
 * Follows the Phase-2 measurement pattern exactly:
 *   1. Authorization via the shared `assertTrainerCanActForClient` gate
 *      (role-first, then active relationship — cross-cuts § 1.3).
 *   2. The session insert and the `trainer_actions_audit` insert happen inside
 *      ONE transaction (cross-cuts § 1.4.2) — if the audit write fails the
 *      session write rolls back too, so we never have a `logged_by_user_id`
 *      row without a matching audit entry.
 *   3. The client notification (`workout_logged_on_behalf`, cross-cuts § 5) is
 *      emitted AFTER the transaction commits, best-effort — a notification
 *      hiccup must never fail an otherwise-successful log.
 *
 * Retroactive-vs-live is a client concern; the backend just records the row.
 */
export async function logClientSessionOnBehalf({
  trainerId,
  clientId,
  body,
}: LogClientSessionArgs): Promise<LogClientSessionResult> {
  const verdict = await assertTrainerCanActForClient(trainerId, clientId);
  if (!verdict.allowed) {
    return { ok: false, status: verdict.status, body: verdict.body };
  }

  const sessionRepository = new SessionRepository();

  const session = await getDb().transaction(async (tx) => {
    const created = await sessionRepository.create(
      clientId,
      {
        loggedByUserId: trainerId,
        workoutId: body.workoutId ?? null,
        name: body.name ?? null,
        // Deliberately defaults to "completed" (the self POST /sessions route
        // defaults to "in_progress"): a coach logging on behalf is almost
        // always recording a session that already happened, not opening a live
        // one. The request VALIDATOR mirrors the self route; this default value
        // is the one intentional on-behalf divergence — do NOT "fix" it back to
        // parity. Retroactive-vs-live is a client concern; the client sends an
        // explicit status when it needs one.
        status: body.status ?? "completed",
        userNotes: body.userNotes ?? null,
      },
      tx,
    );

    await auditTrainerAction({
      trainerId,
      clientId,
      actionType: "workout_logged_on_behalf",
      targetTable: "workout_sessions",
      targetRowId: created.id,
      payload: { ...body },
      tx,
    });

    return created;
  });

  await emitTrainerOnBehalfNotification({
    clientId,
    trainerId,
    type: "workout_logged_on_behalf",
    title: "Workout logged by your coach",
    buildMessage: (coachName) => `${coachName} logged a workout for you`,
    deepLink: `/sessions/${session.id}`,
    relatedEntityType: "workout_session",
    relatedEntityId: session.id,
  });

  return { ok: true, session };
}
