import { getDb } from "@persistence/db/client";
import type { UserGoal } from "@persistence/db";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../relationships/auditTrainerAction";
import { GoalRepository } from "../../repositories/goalRepository";
import { emitTrainerOnBehalfNotification } from "../onBehalfNotifications";

/**
 * Body shape for a coach assigning a goal to a client. Mirrors the self
 * `POST /goals` validator (cross-cuts § 1.2).
 */
export interface AssignClientGoalBody {
  goalTypeId: string;
  priority?: number;
  isActive?: boolean;
  targetDate?: string;
  notes?: string;
}

export interface AssignClientGoalArgs {
  trainerId: string;
  clientId: string;
  body: AssignClientGoalBody;
}

export type AssignClientGoalResult =
  | { ok: true; goal: UserGoal }
  | { ok: false; status: 403; body: { code: string; message: string } };

/**
 * Shared core for the coach on-behalf goal assignment (10-trainer-features +
 * 06-progress-goals, cross-cuts § 2.1). Writes a `user_goals` row for the
 * CLIENT with `assigned_by_user_id = trainerId`.
 *
 * Same Phase-2 pattern:
 *   1. `assertTrainerCanActForClient` gate (cross-cuts § 1.3).
 *   2. Goal insert + `trainer_actions_audit` insert (action `goal_assigned`)
 *      in ONE transaction (cross-cuts § 1.4.2 / § 2.1).
 *   3. `goal_assigned_by_trainer` client notification post-commit, best-effort
 *      (cross-cuts § 5).
 */
export async function assignClientGoalOnBehalf({
  trainerId,
  clientId,
  body,
}: AssignClientGoalArgs): Promise<AssignClientGoalResult> {
  const verdict = await assertTrainerCanActForClient(trainerId, clientId);
  if (!verdict.allowed) {
    return { ok: false, status: verdict.status, body: verdict.body };
  }

  const goalRepository = new GoalRepository();

  const goal = await getDb().transaction(async (tx) => {
    const created = await goalRepository.create(
      clientId,
      {
        goalTypeId: body.goalTypeId,
        assignedByUserId: trainerId,
        priority: body.priority ?? 1,
        isActive: body.isActive ?? true,
        targetDate: body.targetDate,
        notes: body.notes,
      },
      tx,
    );

    await auditTrainerAction({
      trainerId,
      clientId,
      actionType: "goal_assigned",
      targetTable: "user_goals",
      targetRowId: created.id,
      payload: { ...body },
      tx,
    });

    return created;
  });

  await emitTrainerOnBehalfNotification({
    clientId,
    trainerId,
    type: "goal_assigned_by_trainer",
    title: "New goal from your coach",
    buildMessage: (coachName) => `${coachName} set a new goal for you`,
    deepLink: `/progress/goals/${goal.id}`,
    relatedEntityType: "user_goal",
    relatedEntityId: goal.id,
  });

  return { ok: true, goal };
}
