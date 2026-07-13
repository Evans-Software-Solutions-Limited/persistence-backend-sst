import { and, eq } from "drizzle-orm";
import { profiles, ptClientRelationships } from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * The shared trainer-on-behalf authorization gate (cross-cuts § 1.3).
 *
 * Every `/trainers/me/clients/:clientId/...` handler calls this BEFORE it
 * writes anything. It enforces the two checks in the order cross-cuts § 1.3
 * mandates — role FIRST, then relationship — because misordering them is a
 * documented foot-gun:
 *
 *   1. **Role.** `profiles.role` must be `personal_trainer` / `physiotherapist`
 *      (admins may act as trainers). A trainer whose subscription lapsed has
 *      their role reverted by the subscription trigger, so a stale relationship
 *      row alone must NOT grant access — the role check is what closes that
 *      "lapsed-trainer with a dangling relationship" hole. Deny reason
 *      `wrong_role`.
 *   2. **Relationship.** An ACTIVE, non-AI `pt_client_relationships` row with
 *      the caller as `trainer_id` and `:clientId` as `client_id`. Deny reason
 *      `no_relationship`.
 *
 * Returns a discriminated verdict rather than throwing — matching the
 * `assertEntitlement` convention and the `coreErrorHandler` contract that
 * domain 4xx are returned via `ctx.set.status` + body, not thrown. Handlers do:
 *
 *   const v = await assertTrainerCanActForClient(trainerId, clientId);
 *   if (!v.allowed) { ctx.set.status = v.status; return v.body; }
 *
 * This supersedes the relationship-only `hasActiveRelationship` guard
 * (`trainers/relationships/activeRelationshipGuard.ts`) and the inline check
 * the #136 measurement handler shipped; both migrate onto this helper.
 *
 * Cluster 2a: also denies when the CLIENT is soft-deleted (`profiles
 * .deleted_at IS NOT NULL`, deny reason `client_deleted`) — Brad's "hide
 * from coach immediately" call, folded into the existing relationship query
 * (an added `innerJoin` + column, not a second round-trip) — AND when the
 * acting TRAINER is themselves soft-deleted (deny reason `trainer_deleted`),
 * read from the role query's own row (also free — that query already loads
 * the trainer's profile). Together these stop a coach reading/writing client
 * data during either party's 30-day cooling-off window even via a still-valid
 * JWT. (A fully general "block every authenticated request from a soft-
 * deleted user" guard is still deferred — it would need a profiles lookup on
 * routes in `packages/api-utils` that have zero DB dependency today; those
 * remain mitigated by the mobile app signing the caller out + the restore
 * gate. This on-behalf path just happened to already have the lookups.)
 */
export type TrainerActionDenyReason =
  | "wrong_role"
  | "trainer_deleted"
  | "no_relationship"
  | "client_deleted";

export type TrainerActionVerdict =
  | { allowed: true }
  | {
      allowed: false;
      reason: TrainerActionDenyReason;
      status: 403;
      body: { code: string; message: string };
    };

const TRAINER_ROLES = new Set(["personal_trainer", "physiotherapist", "admin"]);

const DENY: Record<TrainerActionDenyReason, { code: string; message: string }> =
  {
    wrong_role: {
      code: "not_a_trainer",
      message: "Coach actions require a trainer or physiotherapist role",
    },
    trainer_deleted: {
      code: "account_deleted",
      message:
        "Your account is scheduled for deletion. Restore it to continue coaching.",
    },
    no_relationship: {
      code: "not_your_client",
      message: "You can only act for your active clients",
    },
    client_deleted: {
      code: "not_your_client",
      message: "You can only act for your active clients",
    },
  };

function deny(
  reason: TrainerActionDenyReason,
): Extract<TrainerActionVerdict, { allowed: false }> {
  return { allowed: false, reason, status: 403, body: DENY[reason] };
}

export async function assertTrainerCanActForClient(
  trainerId: string,
  clientId: string,
): Promise<TrainerActionVerdict> {
  const db = getDb();

  // 1. Role check first (cross-cuts § 1.3 ordering). Fetch the caller's own
  //    `deleted_at` in the SAME row (this query already reads the trainer's
  //    profile) so a soft-deleted COACH acting via a still-valid JWT is
  //    denied too — closing the mirror of the client-deleted case at zero
  //    extra round-trip. (The global deferral noted below is about routes
  //    with NO existing profiles lookup; this on-behalf guard already has one.)
  const roleRows = await db
    .select({ role: profiles.role, deletedAt: profiles.deletedAt })
    .from(profiles)
    .where(eq(profiles.id, trainerId))
    .limit(1);
  const role = roleRows[0]?.role;
  if (!role || !TRAINER_ROLES.has(role)) {
    return deny("wrong_role");
  }
  if (roleRows[0]?.deletedAt != null) {
    return deny("trainer_deleted");
  }

  // 2. Active, non-AI relationship with this client — joined to the
  //    client's profile so a soft-deleted client is denied in the same
  //    round-trip (Cluster 2a).
  const rel = await db
    .select({
      id: ptClientRelationships.id,
      clientDeletedAt: profiles.deletedAt,
    })
    .from(ptClientRelationships)
    .innerJoin(profiles, eq(ptClientRelationships.clientId, profiles.id))
    .where(
      and(
        eq(ptClientRelationships.trainerId, trainerId),
        eq(ptClientRelationships.clientId, clientId),
        eq(ptClientRelationships.status, "active"),
        eq(ptClientRelationships.isAiTrainer, false),
      ),
    )
    .limit(1);
  if (!rel[0]) {
    return deny("no_relationship");
  }
  if (rel[0].clientDeletedAt != null) {
    return deny("client_deleted");
  }

  return { allowed: true };
}
