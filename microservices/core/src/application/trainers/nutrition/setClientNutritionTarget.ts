import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../relationships/auditTrainerAction";
import {
  NutritionTargetRepository,
  type NutritionTargetDTO,
  type UpsertTargetInput,
} from "../../repositories/nutritionTargetRepository";
import { emitTrainerOnBehalfNotification } from "../onBehalfNotifications";

export interface SetClientNutritionTargetArgs {
  trainerId: string;
  clientId: string;
  body: UpsertTargetInput;
}

export type SetClientNutritionTargetResult =
  | { ok: true; target: NutritionTargetDTO }
  | { ok: false; status: 403; body: { code: string; message: string } };

/**
 * Shared core for the coach on-behalf nutrition-target write (cross-cuts
 * § 1.2 / § 1.5). Nutrition is otherwise OFF LIMITS for the coach surface —
 * this single target write is in scope because the mandate names it.
 *
 * Writes the client's `nutrition_targets` row with `set_by_user_id = trainerId`
 * (drives the client-side "Set by Coach X" attribution). Same Phase-2 pattern:
 *   1. `assertTrainerCanActForClient` gate (cross-cuts § 1.3).
 *   2. Target upsert + `trainer_actions_audit` insert (action
 *      `nutrition_target_set`) in ONE transaction (cross-cuts § 1.4.2). The
 *      audit `target_row_id` is the client's id — `nutrition_targets` is keyed
 *      by `user_id` (one row per user, no separate id column).
 *   3. `nutrition_target_set_by_trainer` client notification post-commit,
 *      best-effort (cross-cuts § 5).
 */
export async function setClientNutritionTargetOnBehalf({
  trainerId,
  clientId,
  body,
}: SetClientNutritionTargetArgs): Promise<SetClientNutritionTargetResult> {
  const verdict = await assertTrainerCanActForClient(trainerId, clientId);
  if (!verdict.allowed) {
    return { ok: false, status: verdict.status, body: verdict.body };
  }

  const repository = new NutritionTargetRepository();

  await getDb().transaction(async (tx) => {
    await repository.upsertForClient(clientId, body, trainerId, tx);

    await auditTrainerAction({
      trainerId,
      clientId,
      actionType: "nutrition_target_set",
      targetTable: "nutrition_targets",
      targetRowId: clientId,
      payload: { ...body },
      tx,
    });
  });

  // Re-read post-commit for the setByName-enriched DTO (cross-cuts § 1.5).
  const target = await repository.get(clientId);
  if (!target) throw new Error("nutrition_target_set_failed");

  await emitTrainerOnBehalfNotification({
    clientId,
    trainerId,
    type: "nutrition_target_set_by_trainer",
    title: "Nutrition target set by your coach",
    buildMessage: (coachName) => `${coachName} set your nutrition target`,
    deepLink: `/nutrition/targets`,
    relatedEntityType: "nutrition_target",
    relatedEntityId: clientId,
  });

  return { ok: true, target };
}
