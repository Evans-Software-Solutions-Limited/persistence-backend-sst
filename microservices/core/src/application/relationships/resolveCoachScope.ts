import { and, eq } from "drizzle-orm";
import { ptClientRelationships } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  assertTrainerCanActForClient,
  type TrainerActionVerdict,
} from "./assertTrainerCanActForClient";
import {
  CoachClientSettingsRepository,
  settingsDto,
  type CoachClientSettingsDTO,
} from "../coaching/clientSettings";

/**
 * The several-coaches scoping helper (PER-108, design A D2 / PER-101).
 *
 * An athlete can have several coaches. Every NEW coach handler calls this
 * instead of `assertTrainerCanActForClient` alone: it runs that gate (role,
 * then an active relationship, then neither account deleted), then returns the
 * caller's own relationship and settings for this client.
 *
 * The rule for coach-owned rows (programmes, plans, forms, notes, settings,
 * chat): they carry `relationship_id` or `(trainer_id, client_id)`, and every
 * coach read filters by the caller's `trainer_id` AND the client. A valid
 * relationship with the same athlete never lets coach A read coach B's rows.
 */
export interface CoachScope {
  trainerId: string;
  clientId: string;
  relationshipId: string;
  /** When the relationship last became active (design B's start date). */
  activatedAt: string | null;
  settings: CoachClientSettingsDTO;
}

export type CoachScopeResult =
  | { allowed: true; scope: CoachScope }
  | Extract<TrainerActionVerdict, { allowed: false }>;

export async function resolveCoachScope(
  trainerId: string,
  clientId: string,
): Promise<CoachScopeResult> {
  const verdict = await assertTrainerCanActForClient(trainerId, clientId);
  if (!verdict.allowed) return verdict;

  const rows = await getDb()
    .select({
      id: ptClientRelationships.id,
      activatedAt: ptClientRelationships.activatedAt,
    })
    .from(ptClientRelationships)
    .where(
      and(
        eq(ptClientRelationships.trainerId, trainerId),
        eq(ptClientRelationships.clientId, clientId),
        eq(ptClientRelationships.status, "active"),
      ),
    )
    .limit(1);
  const rel = rows[0];
  if (!rel) {
    // Ended between the two reads.
    return {
      allowed: false,
      reason: "no_relationship",
      status: 403,
      body: {
        code: "not_your_client",
        message: "You can only act for your active clients",
      },
    };
  }

  const settingsRow = await new CoachClientSettingsRepository().find(
    trainerId,
    rel.id,
  );

  return {
    allowed: true,
    scope: {
      trainerId,
      clientId,
      relationshipId: rel.id,
      activatedAt: rel.activatedAt ? rel.activatedAt.toISOString() : null,
      settings: settingsDto(settingsRow, rel.id, clientId),
    },
  };
}
