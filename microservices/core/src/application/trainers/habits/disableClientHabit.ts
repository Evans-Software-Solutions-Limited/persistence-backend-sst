import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../relationships/auditTrainerAction";
import { HabitConfigRepository } from "../../repositories/habitConfigRepository";
import {
  isHabitCategory,
  type HabitCategory,
} from "../../habits/habitCategories";

export interface DisableClientHabitArgs {
  trainerId: string;
  clientId: string;
  category: string;
}

export type DisableClientHabitResult =
  | { ok: true; goalId: string }
  | {
      ok: false;
      status: 403 | 404;
      body: { code?: string; message?: string; error?: string };
    };

/**
 * Shared core for a coach disabling a habit IT assigned (18-habit-setup, Phase
 * 18.3; design.md § 3.2 / § 5). A coach may disable ONLY a habit where
 * `assigned_by_user_id = self` (a self-set or another coach's habit → 403).
 * The soft-disable (deferred to next Monday, § 4.4) + the `goal_assigned` audit
 * row run in ONE transaction (cross-cuts § 1.4.2).
 */
export async function disableClientHabitOnBehalf({
  trainerId,
  clientId,
  category,
}: DisableClientHabitArgs): Promise<DisableClientHabitResult> {
  if (!isHabitCategory(category)) {
    return {
      ok: false,
      status: 404,
      body: { error: "Unknown habit category" },
    };
  }

  const verdict = await assertTrainerCanActForClient(trainerId, clientId);
  if (!verdict.allowed) {
    return { ok: false, status: verdict.status, body: verdict.body };
  }

  const cat = category as HabitCategory;
  const repo = new HabitConfigRepository();

  // A coach can disable ONLY a habit it assigned. Unassigned or another coach's
  // → 403.
  const assigner = await repo.getAssigner(clientId, cat);
  if (!assigner || assigner.assignedByUserId !== trainerId) {
    return {
      ok: false,
      status: 403,
      body: {
        code: "not_your_habit",
        message: "You can only disable a habit you assigned",
      },
    };
  }

  const goalId = await getDb().transaction(async (tx) => {
    const disabledGoalId = await repo.disable(clientId, cat, { tx });
    if (!disabledGoalId) return null;

    await auditTrainerAction({
      trainerId,
      clientId,
      actionType: "goal_assigned",
      targetTable: "user_goals",
      targetRowId: disabledGoalId,
      payload: { category: cat, enabled: false },
      tx,
    });

    return disabledGoalId;
  });

  if (!goalId) {
    return { ok: false, status: 404, body: { error: "Habit not enabled" } };
  }

  return { ok: true, goalId };
}
