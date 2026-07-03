import { and, eq } from "drizzle-orm";
import { ptClientRelationships } from "@persistence/db";
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
 */
export async function hasActiveRelationship(
  trainerId: string,
  clientId: string,
): Promise<boolean> {
  const db = getDb();
  const rel = await db
    .select({ id: ptClientRelationships.id })
    .from(ptClientRelationships)
    .where(
      and(
        eq(ptClientRelationships.trainerId, trainerId),
        eq(ptClientRelationships.clientId, clientId),
        eq(ptClientRelationships.status, "active"),
        eq(ptClientRelationships.isAiTrainer, false),
      ),
    )
    .limit(1);
  return rel.length > 0;
}
