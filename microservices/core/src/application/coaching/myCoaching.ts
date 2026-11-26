import { and, asc, eq, isNull } from "drizzle-orm";
import {
  coachClientSettings,
  profiles,
  ptClientRelationships,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { resolveFeatures, type Features } from "./clientSettings";
import { countAthleteResources } from "./resources/resourceRepository";

/**
 * `GET /users/me/coaching` (PER-108, design A D3): the athlete's coaches, one
 * entry per ACTIVE relationship, with what each has sent. Feeds the Coach tab
 * chips (C2e–f) and You → Coaching (Y1).
 *
 * Scoped to the caller as the CLIENT. `resources` counts that coach's
 * resources `GET /users/me/resources` shows the caller now, by the same rule
 * (PER-150), so it is 0 while the coach has the client's Resources switched
 * off. Forms due and new plans are still 0 here.
 */
export interface MyCoach {
  relationshipId: string;
  trainerId: string;
  name: string;
  avatarUrl: string | null;
  /** When coaching started (the relationship last became active). */
  since: string | null;
  features: Features;
  due: { forms: number };
  newPlans: number;
  resources: number;
}

export async function listMyCoaches(
  userId: string,
): Promise<{ coaches: MyCoach[]; asOf: string }> {
  const asOf = new Date().toISOString();
  const rows = await getDb()
    .select({
      relationshipId: ptClientRelationships.id,
      trainerId: ptClientRelationships.trainerId,
      activatedAt: ptClientRelationships.activatedAt,
      createdAt: ptClientRelationships.createdAt,
      name: profiles.fullName,
      avatarUrl: profiles.avatarUrl,
      features: coachClientSettings.features,
    })
    .from(ptClientRelationships)
    .innerJoin(profiles, eq(profiles.id, ptClientRelationships.trainerId))
    .leftJoin(
      coachClientSettings,
      and(
        eq(coachClientSettings.relationshipId, ptClientRelationships.id),
        eq(coachClientSettings.clientId, userId),
      ),
    )
    .where(
      and(
        eq(ptClientRelationships.clientId, userId),
        eq(ptClientRelationships.status, "active"),
        eq(ptClientRelationships.isAiTrainer, false),
        isNull(profiles.deletedAt),
      ),
    )
    .orderBy(asc(ptClientRelationships.activatedAt));

  const resources =
    rows.length > 0
      ? await countAthleteResources(userId)
      : new Map<string, number>();

  return {
    asOf,
    coaches: rows.map((r) => ({
      relationshipId: r.relationshipId,
      trainerId: r.trainerId,
      name: r.name ?? "Your coach",
      avatarUrl: r.avatarUrl,
      since: (r.activatedAt ?? r.createdAt)?.toISOString() ?? null,
      features: resolveFeatures(r.features),
      due: { forms: 0 },
      newPlans: 0,
      resources: resources.get(r.relationshipId) ?? 0,
    })),
  };
}
