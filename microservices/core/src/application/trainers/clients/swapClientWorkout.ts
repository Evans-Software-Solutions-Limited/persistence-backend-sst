import { getDb } from "@persistence/db/client";
import type { WorkoutAssignment } from "@persistence/db";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../relationships/auditTrainerAction";
import { ProgramAssignmentRepository } from "../../repositories/programAssignmentRepository";
import { emitTrainerOnBehalfNotification } from "../onBehalfNotifications";

/** Body shape — the replacement workout for the swap. */
export interface SwapClientWorkoutBody {
  workoutId: string;
}

export interface SwapClientWorkoutArgs {
  trainerId: string;
  clientId: string;
  assignmentId: string;
  body: SwapClientWorkoutBody;
}

export type SwapClientWorkoutResult =
  | { ok: true; assignment: WorkoutAssignment }
  | {
      ok: false;
      status: 403 | 404 | 409 | 422;
      body: { code: string; message: string };
    };

/**
 * Shared core for the coach in-place workout swap (M18). Replaces the workout
 * on an OPEN assignment — ad-hoc OR a programme occurrence (delete can't touch
 * occurrences; swap is the in-place edit).
 *
 *   1. `assertTrainerCanActForClient` gate (cross-cuts § 1.3).
 *   2. `swapAssignment` (readability check + update + original preservation) +
 *      `trainer_actions_audit` (action `workout_swapped`) in ONE transaction
 *      (cross-cuts § 1.4.2). 404/409/422 short-circuit before the audit, so
 *      those paths commit with no rows and no audit.
 *   3. Best-effort client notification post-commit — reuses the existing
 *      `workout_assigned` type (the Workouts opt-out bucket) with swap copy.
 */
export async function swapClientWorkoutOnBehalf({
  trainerId,
  clientId,
  assignmentId,
  body,
}: SwapClientWorkoutArgs): Promise<SwapClientWorkoutResult> {
  const verdict = await assertTrainerCanActForClient(trainerId, clientId);
  if (!verdict.allowed) {
    return { ok: false, status: verdict.status, body: verdict.body };
  }

  const repository = new ProgramAssignmentRepository();

  const outcome = await getDb().transaction(async (tx) => {
    const swap = await repository.swapAssignment(
      trainerId,
      clientId,
      assignmentId,
      body.workoutId,
      tx,
    );
    if (swap.result !== "swapped") return swap;

    await auditTrainerAction({
      trainerId,
      clientId,
      actionType: "workout_swapped",
      targetTable: "workout_assignments",
      targetRowId: swap.assignment.id,
      payload: {
        fromWorkoutId: swap.fromWorkoutId,
        toWorkoutId: body.workoutId,
      },
      tx,
    });

    return swap;
  });

  if (outcome.result !== "swapped") {
    const errors: Record<
      Exclude<typeof outcome.result, "swapped">,
      { status: 404 | 409 | 422; code: string; message: string }
    > = {
      not_found: {
        status: 404,
        code: "not_found",
        message: "Assignment not found",
      },
      not_swappable: {
        status: 409,
        code: "not_swappable",
        message: "Only open (not started/completed) assignments can be swapped",
      },
      invalid_workout: {
        status: 422,
        code: "invalid_workout",
        message: "The replacement workout must be your own or public",
      },
      same_workout: {
        status: 422,
        code: "same_workout",
        message: "The replacement is the same workout already assigned",
      },
    };
    const e = errors[outcome.result];
    return {
      ok: false,
      status: e.status,
      body: { code: e.code, message: e.message },
    };
  }

  await emitTrainerOnBehalfNotification({
    clientId,
    trainerId,
    type: "workout_assigned",
    title: "Your coach swapped a workout",
    buildMessage: (coachName) => `${coachName} swapped one of your workouts`,
    deepLink: `/workouts/${body.workoutId}`,
    relatedEntityType: "workout_assignment",
    relatedEntityId: outcome.assignment.id,
  });

  return { ok: true, assignment: outcome.assignment };
}
