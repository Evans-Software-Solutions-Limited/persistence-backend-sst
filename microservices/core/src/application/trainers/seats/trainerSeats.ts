import { and, eq, inArray, sql } from "drizzle-orm";
import { ptClientRelationships, trainerInvitations } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  EntitlementError,
  buildTrainerClientsDenyVerdict,
  countActiveTrainerClients,
  evaluateTrainerClientsActiveSeat,
  resolveTrainerClientsEntitlement,
  type EntitlementVerdict,
} from "../../entitlement/assertEntitlement";
import { NotificationDispatcher } from "../../notifications/push/notificationDispatcher";

/**
 * Trainer client-slot seat accounting + gates (revenue-leak fix).
 *
 * The subscription catalog advertises per-tier client caps
 * (`subscription_tiers.trainer_client_limit`: individual_trainer 2,
 * small_business 30, medium_enterprise 500) but nothing enforced them at the
 * application layer. This module is the enforcement surface, layered over the
 * `trainer_clients` entitlement in `assertEntitlement.ts`:
 *
 *   - **Invite CREATION** (invite-code create, email-invite send) — the
 *     trainer is the actor, so an at-cap attempt throws `EntitlementError`
 *     (→ 402 upsell). Gated on COMMITTED seats so a trainer can't queue more
 *     outstanding invites than they have room for.
 *   - **Join / accept** (invite-code redeem, pending-request accept) — the
 *     CLIENT is the actor, so an at-cap attempt is a 409 conflict (NOT a 402
 *     upsell, which would target the wrong user) + a best-effort notification
 *     to the trainer. The accept path additionally takes a per-trainer row
 *     lock so concurrent accepts can't race past the cap.
 *
 * Seat definitions:
 *   - **active seats** = active, human (non-AI) relationships. The canonical
 *     "occupied" count; the accept-time hard backstop enforces active ≤ limit.
 *   - **committed seats** = (active + pending) non-AI relationships + pending
 *     email invitations. Used at invite creation so outstanding invites count
 *     against the cap. Invite CODES are deliberately NOT counted: they are
 *     bounded (at most one active code per trainer, 24h expiry) and counting
 *     the very code a client is redeeming would paradoxically block that
 *     redemption; the accept-time active-seat backstop is the guarantee.
 */

/**
 * Count a trainer's COMMITTED seats: active + pending human relationships plus
 * pending email invitations. Pass a `tx` executor inside a transaction.
 */
export async function countCommittedTrainerSeats(
  executor: Pick<ReturnType<typeof getDb>, "select">,
  trainerId: string,
): Promise<number> {
  const relRows = await executor
    .select({ total: sql<number>`count(*)::int` })
    .from(ptClientRelationships)
    .where(
      and(
        eq(ptClientRelationships.trainerId, trainerId),
        inArray(ptClientRelationships.status, ["active", "pending"]),
        eq(ptClientRelationships.isAiTrainer, false),
      ),
    );

  const inviteRows = await executor
    .select({ total: sql<number>`count(*)::int` })
    .from(trainerInvitations)
    .where(
      and(
        eq(trainerInvitations.trainerId, trainerId),
        eq(trainerInvitations.status, "pending"),
      ),
    );

  return (relRows[0]?.total ?? 0) + (inviteRows[0]?.total ?? 0);
}

/**
 * Gate invite CREATION (invite-code create / email-invite send). The trainer
 * is the actor, so an at-cap attempt throws `EntitlementError` — the shared
 * error handler maps it to HTTP 402 with the upgrade verdict, which is the
 * correct surface here (the trainer sees "upgrade to add more clients").
 *
 * Committed-seat based: a trainer at their cap (counting outstanding
 * invitations) cannot queue further invites. A trainer tier with a NULL limit
 * is unlimited; a non-trainer / reverted sub denies with `'tier'` /
 * `'cancelled'` / `'expired'`.
 */
export async function assertTrainerCanInvite(
  trainerId: string,
  executor: Pick<ReturnType<typeof getDb>, "select"> = getDb(),
): Promise<void> {
  const ctx = await resolveTrainerClientsEntitlement(trainerId, executor);

  if (!ctx.isTrainerTier) {
    throw new EntitlementError(
      await buildTrainerClientsDenyVerdict({
        reason: ctx.baseDenyReason,
        currentTier: ctx.currentTier,
        executor,
      }),
      "trainer_clients",
    );
  }

  if (ctx.limit === null) return; // unlimited trainer tier

  const committed = await countCommittedTrainerSeats(executor, trainerId);
  if (committed >= ctx.limit) {
    throw new EntitlementError(
      await buildTrainerClientsDenyVerdict({
        reason: "limit",
        currentTier: ctx.currentTier,
        executor,
      }),
      "trainer_clients",
    );
  }
}

/**
 * Evaluate whether a trainer has an OPEN committed seat for a NEW client join
 * (invite-code redeem, which creates a fresh pending relationship). The CLIENT
 * is the actor, so the caller surfaces a 409 conflict (not a 402 upsell) and
 * notifies the trainer. Returns `{ allowed: true }` or the deny verdict (whose
 * `upgradeTo` seeds the trainer notification). Committed-seat based; call
 * inside the accept transaction under the per-trainer lock.
 */
export async function evaluateTrainerJoinSeat(
  trainerId: string,
  executor: Pick<ReturnType<typeof getDb>, "select">,
): Promise<EntitlementVerdict> {
  const ctx = await resolveTrainerClientsEntitlement(trainerId, executor);

  if (!ctx.isTrainerTier) {
    return buildTrainerClientsDenyVerdict({
      reason: ctx.baseDenyReason,
      currentTier: ctx.currentTier,
      executor,
    });
  }

  if (ctx.limit === null) return { allowed: true };

  const committed = await countCommittedTrainerSeats(executor, trainerId);
  if (committed >= ctx.limit) {
    return buildTrainerClientsDenyVerdict({
      reason: "limit",
      currentTier: ctx.currentTier,
      executor,
    });
  }

  return { allowed: true };
}

/**
 * Best-effort, never-throws notification to a TRAINER that a client's join was
 * rejected because they are at their plan's client-slot cap (Brad v1 decision
 * 2026-07-11). Fired POST-COMMIT from the reject paths — a notification failure
 * must never fail (or resurrect) the already-decided request. Deep-links to the
 * coach Clients roster where the "no seats" warning + upgrade CTA live.
 */
export async function notifyTrainerClientLimitReached(
  trainerId: string,
  verdict: Extract<EntitlementVerdict, { allowed: false }> | null,
): Promise<void> {
  try {
    await new NotificationDispatcher().createAndDispatch(trainerId, {
      type: "trainer_client_limit_reached",
      title: "A client couldn't join",
      message:
        "Someone tried to join your client list, but your plan is full. Upgrade to add more clients.",
      data: {
        deepLink: "persistencemobile://clients",
        // Upgrade pointer for the mobile row's CTA (null when already on the
        // top trainer tier or on a reverted sub).
        upgrade_to: verdict?.upgradeTo ?? null,
      },
    });
  } catch (err) {
    console.error(
      "[trainer-seats] failed to emit client-limit-reached notification",
      err,
    );
  }
}

/**
 * Re-export the shared active-seat evaluator (the accept-time hard backstop),
 * so the accept handlers import all seat gates from one module. Used when a
 * pending relationship is activated (pending → active): enforces active ≤
 * limit under the per-trainer lock.
 */
export { evaluateTrainerClientsActiveSeat, countActiveTrainerClients };
