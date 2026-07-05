import type { ActionType, Db } from "@persistence/db";
import { trainerActionsAudit } from "@persistence/db";

/**
 * The transaction handle Drizzle hands to a `db.transaction(async (tx) => …)`
 * callback. Structural alias (same trick as `WorkoutRepository`'s `DbOrTx`)
 * so this helper stays free of Drizzle's deep generic types. Typing the param
 * as the tx handle — NOT the `Db` singleton — is deliberate: it signals at the
 * call site that this write MUST happen inside the caller's transaction.
 */
export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface AuditTrainerActionArgs {
  trainerId: string;
  clientId: string;
  actionType: ActionType;
  targetTable: string;
  targetRowId: string;
  payload: Record<string, unknown>;
  /**
   * MUST be the same transaction handle as the target-row write. Per
   * cross-cuts § 1.4.2, if this insert fails the whole action rolls back, so
   * we never have a row carrying `logged_by_user_id` / `assigned_by_user_id`
   * without a matching audit entry.
   */
  tx: DbTransaction;
}

/**
 * Write one `trainer_actions_audit` row inside the caller's transaction
 * (cross-cuts § 1.4.2). Call this as the final step of every trainer
 * on-behalf write, AFTER the target row is inserted/updated and BEFORE the
 * transaction commits, passing the freshly-written row's id as `targetRowId`.
 */
export async function auditTrainerAction(
  args: AuditTrainerActionArgs,
): Promise<void> {
  await args.tx.insert(trainerActionsAudit).values({
    trainerId: args.trainerId,
    clientId: args.clientId,
    actionType: args.actionType,
    targetTable: args.targetTable,
    targetRowId: args.targetRowId,
    payload: args.payload,
  });
}
