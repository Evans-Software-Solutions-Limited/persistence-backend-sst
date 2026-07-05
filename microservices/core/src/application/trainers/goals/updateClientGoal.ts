import type { UserGoal } from "@persistence/db";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import { GoalRepository } from "../../repositories/goalRepository";

/** Editable fields — mirrors the self `PATCH /goals/:id` validator. */
export interface UpdateClientGoalBody {
  priority?: number;
  isActive?: boolean;
  targetDate?: string;
  notes?: string;
}

export interface UpdateClientGoalArgs {
  trainerId: string;
  clientId: string;
  goalId: string;
  body: UpdateClientGoalBody;
}

export type UpdateClientGoalResult =
  | { ok: true; goal: UserGoal }
  | {
      ok: false;
      status: 400 | 403 | 404;
      body: { code: string; message: string };
    };

const EDITABLE_FIELDS = [
  "priority",
  "isActive",
  "targetDate",
  "notes",
] as const;

/**
 * Shared core for the coach on-behalf goal EDIT (cross-cuts § 2.2 — edit-own
 * only). A trainer may edit a goal ONLY when they are the goal's assigner
 * (`assigned_by_user_id = trainerId`). Editing a self-set goal (`NULL`
 * assigner) or another trainer's goal is forbidden (403 `not_assigner`).
 *
 *   1. `assertTrainerCanActForClient` gate (cross-cuts § 1.3).
 *   2. Load the goal scoped to the CLIENT; 404 if it doesn't exist for them.
 *   3. 403 `not_assigner` unless `assigned_by_user_id === trainerId`.
 *   4. Apply the whitelisted field update.
 *
 * No audit row: cross-cuts records CREATE actions (`goal_assigned`); an edit by
 * the same assigning trainer is not a new on-behalf action (per the Phase 3
 * brief — "no new audit if same trainer"). No transaction is needed since
 * there is no audit write to keep atomic.
 */
export async function updateClientGoalOnBehalf({
  trainerId,
  clientId,
  goalId,
  body,
}: UpdateClientGoalArgs): Promise<UpdateClientGoalResult> {
  const verdict = await assertTrainerCanActForClient(trainerId, clientId);
  if (!verdict.allowed) {
    return { ok: false, status: verdict.status, body: verdict.body };
  }

  const goalRepository = new GoalRepository();

  const existing = await goalRepository.getById(goalId, clientId);
  if (!existing) {
    return {
      ok: false,
      status: 404,
      body: { code: "goal_not_found", message: "Goal not found" },
    };
  }

  // Edit-own only (cross-cuts § 2.2): the caller must be the goal's assigner.
  if (existing.assignedByUserId !== trainerId) {
    return {
      ok: false,
      status: 403,
      body: {
        code: "not_assigner",
        message: "You can only edit goals you assigned",
      },
    };
  }

  const updateData: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body && body[field] !== undefined) {
      updateData[field] = body[field];
    }
  }

  if (Object.keys(updateData).length === 0) {
    return {
      ok: false,
      status: 400,
      body: { code: "no_fields", message: "No valid fields to update" },
    };
  }

  const updated = await goalRepository.update(goalId, clientId, updateData);
  if (!updated) {
    // Raced deletion between the load and the update.
    return {
      ok: false,
      status: 404,
      body: { code: "goal_not_found", message: "Goal not found" },
    };
  }

  return { ok: true, goal: updated };
}
