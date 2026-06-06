import { subscriptionStatusTransitions } from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * Append-only writer for the payment-status transition ledger (spec 17 /
 * Phase D, audit LOW-3). INSERT-only — there is deliberately no update/delete
 * method.
 *
 * Recording is BEST-EFFORT at every call site: the ledger is an audit aid, not
 * a correctness dependency, so a ledger write must never fail a webhook or a
 * subscription mutation. Callers wrap `record()` in `.catch()`.
 */
export interface TransitionRecord {
  userSubscriptionId: string;
  userId?: string | null;
  fromStatus?: string | null;
  toStatus: string;
  /** e.g. "webhook:customer.subscription.updated". */
  source: string;
  stripeEventId?: string | null;
  /** True when the state machine suppressed an illegal transition. */
  blocked?: boolean;
}

export class SubscriptionStatusTransitionsRepository {
  static readonly key = "SubscriptionStatusTransitionsRepository";

  async record(entry: TransitionRecord): Promise<void> {
    const db = getDb();
    await db.insert(subscriptionStatusTransitions).values({
      userSubscriptionId: entry.userSubscriptionId,
      userId: entry.userId ?? null,
      fromStatus: entry.fromStatus ?? null,
      toStatus: entry.toStatus,
      source: entry.source,
      stripeEventId: entry.stripeEventId ?? null,
      blocked: entry.blocked ?? false,
    });
  }
}
