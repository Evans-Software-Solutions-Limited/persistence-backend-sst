import { and, eq, isNull } from "drizzle-orm";
import { profiles, ptClientRelationships } from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * The trainer→client permission check: an ACTIVE, non-AI
 * `pt_client_relationships` row with the caller as trainer. Shared by the
 * programme assign/unassign and ad-hoc assignment handlers (same rule the
 * coach measurement-log handler applies inline).
 *
 * NOTE: this is the relationship HALF of cross-cuts § 1.3's
 * `assertTrainerCanActForClient` — when spec-10 Phase 10.2 lands the full
 * helper (with audit), migrate these call sites onto it.
 *
 * Cluster 2a: also requires the client's `profiles.deleted_at IS NULL` —
 * joined into the same query so a coach can't create a new programme/workout
 * assignment for a client mid-soft-delete (Brad's "hide from coach
 * immediately" call).
 */
export async function hasActiveRelationship(
  trainerId: string,
  clientId: string,
): Promise<boolean> {
  const db = getDb();
  const rel = await db
    .select({ id: ptClientRelationships.id })
    .from(ptClientRelationships)
    .innerJoin(profiles, eq(ptClientRelationships.clientId, profiles.id))
    .where(
      and(
        eq(ptClientRelationships.trainerId, trainerId),
        eq(ptClientRelationships.clientId, clientId),
        eq(ptClientRelationships.status, "active"),
        eq(ptClientRelationships.isAiTrainer, false),
        isNull(profiles.deletedAt),
      ),
    )
    .limit(1);
  return rel.length > 0;
}
