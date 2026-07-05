import { getDb } from "@persistence/db/client";
import type { WorkoutAssignment } from "@persistence/db";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../relationships/auditTrainerAction";
import { ProgramAssignmentRepository } from "../../repositories/programAssignmentRepository";
import { todayIso } from "../programs/shared";
import { emitTrainerOnBehalfNotification } from "../onBehalfNotifications";

/** Body shape — mirrors the workout-assignment create validator. */
export interface AssignClientWorkoutBody {
  workoutId: string;
  dueDate?: string | null;
  showInPlan?: boolean;
  showInLibrary?: boolean;
  trainerNotes?: string | null;
}

export interface AssignClientWorkoutArgs {
  trainerId: string;
  clientId: string;
  body: AssignClientWorkoutBody;
}

export type AssignClientWorkoutResult =
  | { ok: true; assignment: WorkoutAssignment }
  | {
      ok: false;
      status: 403 | 422;
      body: { code: string; message: string };
    };

/**
 * Shared core for the coach ad-hoc workout assignment (specs/19-programs
 * STORY-006, cross-cuts § 1.2). Re-homed in Phase 3 onto the shared audit
 * helpers — the pre-Phase-3 handler wrote the `workout_assignments` row with
 * NO audit trail; this core brings it in line with the other on-behalf writes.
 *
 *   1. `assertTrainerCanActForClient` gate (cross-cuts § 1.3), replacing the
 *      old inline `isTrainer` + `hasActiveRelationship` pair.
 *   2. Readability check + assignment insert + `trainer_actions_audit` insert
 *      (action `workout_assigned`) in ONE transaction (cross-cuts § 1.4.2).
 *      `invalid_workout` short-circuits before any write, so the transaction
 *      commits with no rows and no audit.
 *   3. `workout_assigned` client notification post-commit, best-effort
 *      (cross-cuts § 5 — `workout_assigned` already existed in the enum).
 */
export async function assignClientWorkoutOnBehalf({
  trainerId,
  clientId,
  body,
}: AssignClientWorkoutArgs): Promise<AssignClientWorkoutResult> {
  const verdict = await assertTrainerCanActForClient(trainerId, clientId);
  if (!verdict.allowed) {
    return { ok: false, status: verdict.status, body: verdict.body };
  }

  const repository = new ProgramAssignmentRepository();

  const outcome = await getDb().transaction(async (tx) => {
    const created = await repository.createAdHoc(
      trainerId,
      clientId,
      {
        workoutId: body.workoutId,
        dueDate: body.dueDate ?? null,
        showInPlan: body.showInPlan,
        showInLibrary: body.showInLibrary,
        trainerNotes: body.trainerNotes ?? null,
      },
      todayIso(),
      tx,
    );

    if ("error" in created) {
      // No write happened — nothing to audit; the tx commits empty.
      return created;
    }

    await auditTrainerAction({
      trainerId,
      clientId,
      actionType: "workout_assigned",
      targetTable: "workout_assignments",
      targetRowId: created.assignment.id,
      payload: { ...body },
      tx,
    });

    return created;
  });

  if ("error" in outcome) {
    return {
      ok: false,
      status: 422,
      body: {
        code: "invalid_workout",
        message: "The workout must be your own or public",
      },
    };
  }

  await emitTrainerOnBehalfNotification({
    clientId,
    trainerId,
    type: "workout_assigned",
    title: "New workout from your coach",
    buildMessage: (coachName) => `${coachName} assigned you a workout`,
    deepLink: `/workouts/${body.workoutId}`,
    relatedEntityType: "workout_assignment",
    relatedEntityId: outcome.assignment.id,
  });

  return { ok: true, assignment: outcome.assignment };
}
